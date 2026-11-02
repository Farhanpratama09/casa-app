use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct SystemTelemetry {
    // Power
    pub battery_percentage: u8,
    pub is_charging: bool,
    pub has_battery: bool,

    // Keyboard
    pub is_caps_locked: bool,

    // Display
    pub brightness_percent: u8,
    pub is_brightness_supported: bool,

    // Audio Endpoint
    pub master_volume: u8,
    pub is_muted: bool,
    pub audio_device_name: String,
    pub audio_device_type: AudioDeviceType,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AudioDeviceType {
    Speaker,
    HeadphoneWired,
    HeadphoneBluetooth,
    Unknown,
}

impl Default for SystemTelemetry {
    fn default() -> Self {
        Self {
            battery_percentage: 100,
            is_charging: true,
            has_battery: false,
            is_caps_locked: false,
            brightness_percent: 50,
            is_brightness_supported: false,
            master_volume: 50,
            is_muted: false,
            audio_device_name: "Default Audio Device".to_string(),
            audio_device_type: AudioDeviceType::Speaker,
        }
    }
}

pub struct AudioEndpointInfo {
    pub master_volume: u8,
    pub is_muted: bool,
    pub audio_device_name: String,
    pub audio_device_type: AudioDeviceType,
}

/// Global cached state for instant non-blocking command reads
static TELEMETRY_CACHE: Mutex<Option<SystemTelemetry>> = Mutex::new(None);

pub fn get_cached_telemetry() -> SystemTelemetry {
    if let Ok(guard) = TELEMETRY_CACHE.lock() {
        if let Some(t) = &*guard {
            return t.clone();
        }
    }
    SystemTelemetry::default()
}

pub fn update_cached_telemetry(t: SystemTelemetry) {
    if let Ok(mut guard) = TELEMETRY_CACHE.lock() {
        *guard = Some(t);
    }
}

// =========================================================================
// 1. Power Status (GetSystemPowerStatus)
// =========================================================================
pub fn read_power_status() -> (u8, bool, bool) {
    #[cfg(windows)]
    {
        use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
        let mut sps = SYSTEM_POWER_STATUS::default();
        unsafe {
            if GetSystemPowerStatus(&mut sps).is_ok() {
                // BatteryFlag: 128 = No system battery, 255 = Unknown status
                let has_battery = sps.BatteryFlag != 128 && sps.BatteryLifePercent != 255;
                let battery_percentage = if has_battery {
                    sps.BatteryLifePercent.min(100)
                } else {
                    100
                };
                let is_charging = (sps.BatteryFlag & 8) != 0 || sps.ACLineStatus == 1;
                return (battery_percentage, is_charging, has_battery);
            }
        }
    }
    (100, true, false)
}

// =========================================================================
// 2. Keyboard State (VK_CAPITAL / GetKeyState)
// =========================================================================
pub fn read_caps_lock_status() -> bool {
    #[cfg(windows)]
    {
        // VK_CAPITAL = 0x14
        let state = unsafe { windows_sys::Win32::UI::Input::KeyboardAndMouse::GetKeyState(0x14) };
        (state & 1) != 0
    }
    #[cfg(not(windows))]
    false
}

// =========================================================================
// 3. Display Brightness (WMI root\wmi)
// =========================================================================
#[cfg(windows)]
unsafe fn extract_u8_from_variant(val: &windows::Win32::System::Variant::VARIANT) -> Option<u8> {
    let inner = &val.Anonymous.Anonymous;
    let vt = inner.vt.0;
    // VT_UI1 = 17, VT_I4 = 3, VT_UI4 = 19, VT_I2 = 2, VT_UI2 = 18
    match vt {
        17 => Some(inner.Anonymous.bVal),
        3 => Some((inner.Anonymous.lVal as u8).min(100)),
        2 => Some((inner.Anonymous.iVal as u8).min(100)),
        _ => None,
    }
}

pub fn read_display_brightness_wmi() -> (u8, bool) {
    #[cfg(windows)]
    unsafe {
        use windows::core::{w, BSTR};
        use windows::Win32::System::Com::{
            CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED,
        };
        use windows::Win32::System::Variant::VARIANT;
        use windows::Win32::System::Wmi::{
            IWbemLocator, WbemLocator, WBEM_FLAG_FORWARD_ONLY, WBEM_FLAG_RETURN_IMMEDIATELY,
            WBEM_INFINITE,
        };

        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        if let Ok(locator) =
            CoCreateInstance::<_, IWbemLocator>(&WbemLocator, None, CLSCTX_INPROC_SERVER)
        {
            let namespace = BSTR::from("root\\wmi");
            let empty = BSTR::new();
            if let Ok(services) =
                locator.ConnectServer(&namespace, &empty, &empty, &empty, 0, &empty, None)
            {
                let query = BSTR::from("SELECT CurrentBrightness FROM WmiMonitorBrightness");
                let lang = BSTR::from("WQL");
                if let Ok(enumerator) = services.ExecQuery(
                    &lang,
                    &query,
                    WBEM_FLAG_FORWARD_ONLY | WBEM_FLAG_RETURN_IMMEDIATELY,
                    None,
                ) {
                    let mut count = 0u32;
                    let mut class_obj = [None];
                    let hr = enumerator.Next(WBEM_INFINITE, &mut class_obj, &mut count);
                    if hr.is_ok() && count > 0 {
                        if let Some(obj) = &class_obj[0] {
                            let mut val = VARIANT::default();
                            if obj
                                .Get(w!("CurrentBrightness"), 0, &mut val, None, None)
                                .is_ok()
                            {
                                if let Some(b) = extract_u8_from_variant(&val) {
                                    return (b.min(100), true);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    (0, false)
}

pub fn set_display_brightness_native(val: u8) {
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let clamped = val.min(100);
        tokio::task::spawn_blocking(move || {
            let cmd = format!(
                "(Get-WmiObject -Namespace root/wmi -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1, {})",
                clamped
            );
            let _ = std::process::Command::new("powershell")
                .args(["-NoProfile", "-NonInteractive", "-Command", &cmd])
                .creation_flags(CREATE_NO_WINDOW)
                .status();
        });
    }
}

// =========================================================================
// 4. WASAPI Audio Endpoint & Master Volume
// =========================================================================
pub fn classify_audio_device(name: &str, form_factor: u32) -> AudioDeviceType {
    let lower_name = name.to_lowercase();

    // 1. Bluetooth indicators in device friendly name
    let is_bluetooth = lower_name.contains("bluetooth")
        || lower_name.contains("hands-free")
        || lower_name.contains("airpods")
        || lower_name.contains("galaxy buds")
        || lower_name.contains("pixel buds")
        || lower_name.contains("wh-1000")
        || lower_name.contains("wf-1000")
        || lower_name.contains("bose")
        || lower_name.contains("freebuds")
        || lower_name.contains("tws")
        || lower_name.contains("bt ");

    if is_bluetooth {
        return AudioDeviceType::HeadphoneBluetooth;
    }

    // 2. FormFactor classification:
    // 1 = Speakers, 2 = LineLevel, 3 = Headphones, 5 = Headset, 6 = Handset, 9 = DigitalAudioDisplayDevice
    match form_factor {
        3 | 5 | 6 => AudioDeviceType::HeadphoneWired,
        1 | 2 | 9 => AudioDeviceType::Speaker,
        _ => {
            if lower_name.contains("headphone")
                || lower_name.contains("headset")
                || lower_name.contains("earphone")
                || lower_name.contains("in-ear")
            {
                AudioDeviceType::HeadphoneWired
            } else if lower_name.contains("speaker")
                || lower_name.contains("lautsprecher")
                || lower_name.contains("realtek")
                || lower_name.contains("nvidia")
            {
                AudioDeviceType::Speaker
            } else {
                AudioDeviceType::Unknown
            }
        }
    }
}

pub fn read_audio_endpoint_status() -> AudioEndpointInfo {
    #[cfg(windows)]
    unsafe {
        use windows::core::GUID;
        use windows::Win32::Foundation::PROPERTYKEY;
        use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
        use windows::Win32::Media::Audio::{
            eMultimedia, eRender, IMMDeviceEnumerator, MMDeviceEnumerator,
        };
        use windows::Win32::System::Com::StructuredStorage::{
            PropVariantToStringAlloc, PropVariantToUInt32,
        };
        use windows::Win32::System::Com::{
            CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED, STGM_READ,
        };

        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        if let Ok(enumerator) =
            CoCreateInstance::<_, IMMDeviceEnumerator>(&MMDeviceEnumerator, None, CLSCTX_ALL)
        {
            if let Ok(device) = enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia) {
                let (master_volume, is_muted) = if let Ok(vol_ctl) =
                    device.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None)
                {
                    let vol_scalar = vol_ctl.GetMasterVolumeLevelScalar().unwrap_or(0.5);
                    let muted = vol_ctl.GetMute().unwrap_or(windows::core::BOOL(0));
                    (
                        (vol_scalar * 100.0).round().clamp(0.0, 100.0) as u8,
                        muted.as_bool(),
                    )
                } else {
                    (50, false)
                };

                let mut device_name = "Speakers".to_string();
                let mut form_factor = 1u32; // Default Speakers

                if let Ok(store) = device.OpenPropertyStore(STGM_READ) {
                    let pkey_name = PROPERTYKEY {
                        fmtid: GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0),
                        pid: 14,
                    };
                    if let Ok(prop_val) = store.GetValue(&pkey_name) {
                        if let Ok(pwstr) = PropVariantToStringAlloc(&prop_val) {
                            let name_str = pwstr.to_string().unwrap_or_default();
                            if !name_str.trim().is_empty() {
                                device_name = name_str.trim().to_string();
                            }
                            windows::Win32::System::Com::CoTaskMemFree(Some(pwstr.as_ptr() as _));
                        }
                    }

                    let pkey_form = PROPERTYKEY {
                        fmtid: GUID::from_u128(0x1da5d803_d492_4edd_8c23_e0c0ffee7f0e),
                        pid: 0,
                    };
                    if let Ok(prop_val) = store.GetValue(&pkey_form) {
                        if let Ok(ff) = PropVariantToUInt32(&prop_val) {
                            form_factor = ff;
                        }
                    }
                }

                let audio_device_type = classify_audio_device(&device_name, form_factor);

                return AudioEndpointInfo {
                    master_volume,
                    is_muted,
                    audio_device_name: device_name,
                    audio_device_type,
                };
            }
        }
    }

    AudioEndpointInfo {
        master_volume: 50,
        is_muted: false,
        audio_device_name: "Default Audio Device".to_string(),
        audio_device_type: AudioDeviceType::Speaker,
    }
}

pub fn set_master_volume_native(level_percent: u8) -> Result<(), String> {
    #[cfg(windows)]
    unsafe {
        use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
        use windows::Win32::Media::Audio::{
            eMultimedia, eRender, IMMDeviceEnumerator, MMDeviceEnumerator,
        };
        use windows::Win32::System::Com::{
            CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED,
        };

        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|e| format!("CoCreateInstance failed: {e}"))?;
        let device = enumerator
            .GetDefaultAudioEndpoint(eRender, eMultimedia)
            .map_err(|e| format!("GetDefaultAudioEndpoint failed: {e}"))?;
        let vol_ctl: IAudioEndpointVolume = device
            .Activate(CLSCTX_ALL, None)
            .map_err(|e| format!("Activate IAudioEndpointVolume failed: {e}"))?;

        let scalar = (level_percent.min(100) as f32) / 100.0;
        vol_ctl
            .SetMasterVolumeLevelScalar(scalar, std::ptr::null())
            .map_err(|e| format!("SetMasterVolumeLevelScalar failed: {e}"))?;

        Ok(())
    }
    #[cfg(not(windows))]
    Ok(())
}

pub fn toggle_audio_mute_native() -> Result<bool, String> {
    #[cfg(windows)]
    unsafe {
        use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
        use windows::Win32::Media::Audio::{
            eMultimedia, eRender, IMMDeviceEnumerator, MMDeviceEnumerator,
        };
        use windows::Win32::System::Com::{
            CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED,
        };

        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|e| format!("CoCreateInstance failed: {e}"))?;
        let device = enumerator
            .GetDefaultAudioEndpoint(eRender, eMultimedia)
            .map_err(|e| format!("GetDefaultAudioEndpoint failed: {e}"))?;
        let vol_ctl: IAudioEndpointVolume = device
            .Activate(CLSCTX_ALL, None)
            .map_err(|e| format!("Activate IAudioEndpointVolume failed: {e}"))?;

        let is_muted = vol_ctl.GetMute().map_err(|e| format!("GetMute failed: {e}"))?;
        let new_mute_state = !is_muted.as_bool();
        vol_ctl
            .SetMute(
                new_mute_state,
                std::ptr::null(),
            )
            .map_err(|e| format!("SetMute failed: {e}"))?;

        Ok(new_mute_state)
    }
    #[cfg(not(windows))]
    Ok(false)
}

// =========================================================================
// 5. Background Poller & Event Emission
// =========================================================================
pub fn start_hardware_telemetry_daemon(app: AppHandle) {
    tokio::spawn(async move {
        let mut tick_counter: u64 = 0;
        let mut last_telemetry = SystemTelemetry::default();
        let mut last_battery = (100u8, true, false);
        let mut last_brightness = (50u8, false);

        loop {
            tokio::time::sleep(Duration::from_millis(500)).await;
            tick_counter = tick_counter.wrapping_add(1);

            // Fast loop (500ms): Caps Lock & Audio Endpoint Volume/State
            let is_caps_locked = read_caps_lock_status();
            let audio_info = read_audio_endpoint_status();

            // Slower loop (2000ms = every 4 ticks): Battery & Brightness
            if tick_counter % 4 == 1 || tick_counter == 1 {
                last_battery = read_power_status();
                last_brightness = read_display_brightness_wmi();
            }

            let current_telemetry = SystemTelemetry {
                battery_percentage: last_battery.0,
                is_charging: last_battery.1,
                has_battery: last_battery.2,
                is_caps_locked,
                brightness_percent: last_brightness.0,
                is_brightness_supported: last_brightness.1,
                master_volume: audio_info.master_volume,
                is_muted: audio_info.is_muted,
                audio_device_name: audio_info.audio_device_name,
                audio_device_type: audio_info.audio_device_type,
            };

            // Emit if changed or every 10 ticks (5s) as a heartbeat
            let changed = current_telemetry != last_telemetry;
            if changed || tick_counter % 10 == 0 {
                update_cached_telemetry(current_telemetry.clone());
                let _ = app.emit("system-telemetry-update", &current_telemetry);
                last_telemetry = current_telemetry;
            }
        }
    });
}

// =========================================================================
// 6. Tauri Commands
// =========================================================================
#[tauri::command]
pub fn get_system_telemetry() -> Result<SystemTelemetry, String> {
    Ok(get_cached_telemetry())
}

#[tauri::command]
pub fn set_master_volume(volume: u8) -> Result<(), String> {
    set_master_volume_native(volume)?;
    if let Ok(mut guard) = TELEMETRY_CACHE.lock() {
        if let Some(t) = guard.as_mut() {
            t.master_volume = volume.min(100);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn toggle_audio_mute() -> Result<bool, String> {
    let muted = toggle_audio_mute_native()?;
    if let Ok(mut guard) = TELEMETRY_CACHE.lock() {
        if let Some(t) = guard.as_mut() {
            t.is_muted = muted;
        }
    }
    Ok(muted)
}

#[tauri::command]
pub fn set_display_brightness(brightness: u8) -> Result<(), String> {
    set_display_brightness_native(brightness);
    if let Ok(mut guard) = TELEMETRY_CACHE.lock() {
        if let Some(t) = guard.as_mut() {
            t.brightness_percent = brightness.min(100);
        }
    }
    Ok(())
}
