use std::sync::{
    atomic::{AtomicBool, Ordering},
    Condvar, Mutex, OnceLock,
};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct ConnectedBluetoothDevice {
    pub name: String,
    pub address: String,
    pub battery_percent: Option<u8>,
}

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AudioOutputKind {
    Bluetooth,
    Wired,
    Speaker,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct SystemTelemetry {
    pub is_fullscreen_active: bool,
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
    pub audio_output_kind: AudioOutputKind,
    pub audio_output_battery: Option<u8>,

    // Connectivity & Power Wake Lock
    pub wifi_enabled: bool,
    pub wifi_supported: bool,
    pub wifi_ssid: Option<String>,
    pub bluetooth_enabled: bool,
    pub bluetooth_supported: bool,
    pub bluetooth_device_name: Option<String>,
    pub connected_bluetooth_devices: Vec<ConnectedBluetoothDevice>,
    pub stay_awake: bool,
}

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
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
            audio_output_kind: AudioOutputKind::Speaker,
            audio_output_battery: None,
            wifi_enabled: false,
            wifi_supported: false,
            wifi_ssid: None,
            bluetooth_enabled: false,
            bluetooth_supported: false,
            bluetooth_device_name: None,
            connected_bluetooth_devices: Vec::new(),
            stay_awake: false,
            is_fullscreen_active: false,
        }
    }
}

pub struct AudioEndpointInfo {
    pub master_volume: u8,
    pub is_muted: bool,
    pub audio_device_name: String,
    pub audio_device_type: AudioDeviceType,
    pub audio_output_kind: AudioOutputKind,
    pub audio_output_battery: Option<u8>,
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
            CoCreateInstance, CoInitializeSecurity, CoSetProxyBlanket, CLSCTX_INPROC_SERVER,
            EOAC_NONE, RPC_C_AUTHN_LEVEL_CALL, RPC_C_AUTHN_LEVEL_DEFAULT,
            RPC_C_IMP_LEVEL_IMPERSONATE,
        };
        use windows::Win32::System::Variant::VARIANT;
        use windows::Win32::System::Wmi::{
            IWbemLocator, WbemLocator, WBEM_FLAG_FORWARD_ONLY, WBEM_FLAG_RETURN_IMMEDIATELY,
            WBEM_INFINITE,
        };

        const RPC_C_AUTHN_WINNT: u32 = 10;
        const RPC_C_AUTHZ_NONE: u32 = 0;

        let _com = crate::security_utils::ComGuard::init_mta();
        let _ = CoInitializeSecurity(
            None,
            -1,
            None,
            None,
            RPC_C_AUTHN_LEVEL_DEFAULT,
            RPC_C_IMP_LEVEL_IMPERSONATE,
            None,
            EOAC_NONE,
            None,
        );

        let locator = match CoCreateInstance::<_, IWbemLocator>(&WbemLocator, None, CLSCTX_INPROC_SERVER) {
            Ok(loc) => loc,
            Err(_) => return (0, false),
        };

        let namespace = BSTR::from("root\\wmi");
        let empty = BSTR::new();
        let services = match locator.ConnectServer(&namespace, &empty, &empty, &empty, 0, &empty, None) {
            Ok(s) => s,
            Err(_) => return (0, false),
        };

        let _ = CoSetProxyBlanket(
            &services,
            RPC_C_AUTHN_WINNT,
            RPC_C_AUTHZ_NONE,
            None,
            RPC_C_AUTHN_LEVEL_CALL,
            RPC_C_IMP_LEVEL_IMPERSONATE,
            None,
            EOAC_NONE,
        );

        let query = BSTR::from("SELECT CurrentBrightness FROM WmiMonitorBrightness");
        let lang = BSTR::from("WQL");
        let enumerator = match services.ExecQuery(
            &lang,
            &query,
            WBEM_FLAG_FORWARD_ONLY | WBEM_FLAG_RETURN_IMMEDIATELY,
            None,
        ) {
            Ok(en) => en,
            Err(_) => return (0, false),
        };

        let _ = CoSetProxyBlanket(
            &enumerator,
            RPC_C_AUTHN_WINNT,
            RPC_C_AUTHZ_NONE,
            None,
            RPC_C_AUTHN_LEVEL_CALL,
            RPC_C_IMP_LEVEL_IMPERSONATE,
            None,
            EOAC_NONE,
        );

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
    (0, false)
}

#[cfg(windows)]
static BRIGHTNESS_WORKER: OnceLock<(Mutex<Option<u8>>, Condvar)> = OnceLock::new();

#[cfg(windows)]
unsafe fn connect_wmi_root() -> Option<windows::Win32::System::Wmi::IWbemServices> {
    use windows::core::BSTR;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoSetProxyBlanket, CLSCTX_INPROC_SERVER, EOAC_NONE,
        RPC_C_AUTHN_LEVEL_CALL, RPC_C_IMP_LEVEL_IMPERSONATE,
    };
    use windows::Win32::System::Wmi::{IWbemLocator, WbemLocator};

    const RPC_C_AUTHN_WINNT: u32 = 10;
    const RPC_C_AUTHZ_NONE: u32 = 0;

    let _com = crate::security_utils::ComGuard::init_mta();
    let locator = CoCreateInstance::<_, IWbemLocator>(&WbemLocator, None, CLSCTX_INPROC_SERVER).ok()?;
    let namespace = BSTR::from("root\\wmi");
    let empty = BSTR::new();
    let services = locator
        .ConnectServer(&namespace, &empty, &empty, &empty, 0, &empty, None)
        .ok()?;
    let _ = CoSetProxyBlanket(
        &services,
        RPC_C_AUTHN_WINNT,
        RPC_C_AUTHZ_NONE,
        None,
        RPC_C_AUTHN_LEVEL_CALL,
        RPC_C_IMP_LEVEL_IMPERSONATE,
        None,
        EOAC_NONE,
    );
    Some(services)
}

#[cfg(windows)]
unsafe fn exec_wmi_set_brightness(
    services: &windows::Win32::System::Wmi::IWbemServices,
    brightness: u8,
) -> Result<(), ()> {
    use windows::core::{w, BSTR};
    use windows::Win32::System::Com::{
        CoSetProxyBlanket, EOAC_NONE, RPC_C_AUTHN_LEVEL_CALL, RPC_C_IMP_LEVEL_IMPERSONATE,
    };
    use windows::Win32::System::Variant::VARIANT;
    use windows::Win32::System::Wmi::{
        IWbemClassObject, WBEM_FLAG_FORWARD_ONLY, WBEM_FLAG_RETURN_IMMEDIATELY, WBEM_INFINITE,
    };

    const RPC_C_AUTHN_WINNT: u32 = 10;
    const RPC_C_AUTHZ_NONE: u32 = 0;

    let mut class_obj: Option<IWbemClassObject> = None;
    services
        .GetObject(
            &BSTR::from("WmiMonitorBrightnessMethods"),
            Default::default(),
            None,
            Some(&mut class_obj),
            None,
        )
        .map_err(|_| ())?;
    let class_def = class_obj.ok_or(())?;

    let mut in_sig: Option<IWbemClassObject> = None;
    class_def
        .GetMethod(w!("WmiSetBrightness"), 0, &mut in_sig, std::ptr::null_mut())
        .map_err(|_| ())?;
    let in_sig_obj = in_sig.ok_or(())?;
    let in_params = in_sig_obj.SpawnInstance(0).map_err(|_| ())?;

    let timeout_var = VARIANT::from(1i32);
    let brightness_var = VARIANT::from(brightness);
    in_params
        .Put(w!("Timeout"), 0, &timeout_var, 0)
        .map_err(|_| ())?;
    in_params
        .Put(w!("Brightness"), 0, &brightness_var, 0)
        .map_err(|_| ())?;

    let query = BSTR::from("SELECT __RELPATH FROM WmiMonitorBrightnessMethods");
    let lang = BSTR::from("WQL");
    let enumerator = services
        .ExecQuery(
            &lang,
            &query,
            WBEM_FLAG_FORWARD_ONLY | WBEM_FLAG_RETURN_IMMEDIATELY,
            None,
        )
        .map_err(|_| ())?;
    let _ = CoSetProxyBlanket(
        &enumerator,
        RPC_C_AUTHN_WINNT,
        RPC_C_AUTHZ_NONE,
        None,
        RPC_C_AUTHN_LEVEL_CALL,
        RPC_C_IMP_LEVEL_IMPERSONATE,
        None,
        EOAC_NONE,
    );

    let method_name = BSTR::from("WmiSetBrightness");
    let mut updated_any = false;

    loop {
        let mut count = 0u32;
        let mut objs = [None];
        let hr = enumerator.Next(WBEM_INFINITE, &mut objs, &mut count);
        if hr.is_err() || count == 0 {
            break;
        }
        if let Some(inst) = &objs[0] {
            let mut relpath_var = VARIANT::default();
            if inst
                .Get(w!("__RELPATH"), 0, &mut relpath_var, None, None)
                .is_ok()
            {
                let inner = &relpath_var.Anonymous.Anonymous;
                if inner.vt.0 == 8 {
                    let relpath = (*inner.Anonymous.bstrVal).clone();
                    if services
                        .ExecMethod(
                            &relpath,
                            &method_name,
                            Default::default(),
                            None,
                            Some(&in_params),
                            None,
                            None,
                        )
                        .is_ok()
                    {
                        updated_any = true;
                    }
                }
            }
        }
    }

    if updated_any {
        Ok(())
    } else {
        Err(())
    }
}

pub fn set_display_brightness_native(val: u8) {
    #[cfg(windows)]
    {
        let clamped = val.min(100);
        let (lock, cvar) = BRIGHTNESS_WORKER.get_or_init(|| {
            let pair_lock = Mutex::new(None);
            let pair_cvar = Condvar::new();
            let _ = std::thread::Builder::new()
                .name("casa-brightness-wmi".into())
                .spawn(|| unsafe {
                    let _com = crate::security_utils::ComGuard::init_mta();

                    let mut cached_services = connect_wmi_root();
                    let (lock, cvar) = BRIGHTNESS_WORKER
                        .get()
                        .expect("BRIGHTNESS_WORKER initialized");

                    loop {
                        let target_val = {
                            let mut pending = match lock.lock() {
                                Ok(g) => g,
                                Err(_) => break,
                            };
                            while pending.is_none() {
                                pending = match cvar.wait(pending) {
                                    Ok(g) => g,
                                    Err(_) => return,
                                };
                            }
                            match pending.take() {
                                Some(val) => val,
                                None => continue,
                            }
                        };

                        let mut applied = false;
                        if let Some(ref services) = cached_services {
                            applied = exec_wmi_set_brightness(services, target_val).is_ok();
                        }
                        if !applied {
                            cached_services = connect_wmi_root();
                            if let Some(ref services) = cached_services {
                                let _ = exec_wmi_set_brightness(services, target_val);
                            }
                        }
                    }
                });
            (pair_lock, pair_cvar)
        });

        if let Ok(mut pending) = lock.lock() {
            *pending = Some(clamped);
            cvar.notify_one();
        }
    }
}

// =========================================================================
// 4. WASAPI Audio Endpoint & Master Volume + Bluetooth Name Normalization
// =========================================================================
pub fn canonical_bt_name(raw: &str) -> String {
    let mut name = raw.trim().to_string();
    let suffixes = [
        " avrcp transport",
        " hands-free ag audio",
        " hands-free hf audio",
        " hands-free audio",
        " hands-free ag",
        " hands-free",
        " a2dp sink",
        " a2dp",
        " stereo",
    ];
    loop {
        let lower = name.to_lowercase();
        let mut trimmed_any = false;
        for suf in suffixes {
            if lower.ends_with(suf) && name.len() > suf.len() {
                let cut_len = name.len() - suf.len();
                name = name[..cut_len].trim_end_matches(&[' ', '-', '_', '('][..]).to_string();
                trimmed_any = true;
                break;
            }
        }
        if !trimmed_any {
            break;
        }
    }
    name.trim().to_string()
}

fn extract_audio_endpoint_core_name(endpoint_name: &str) -> String {
    let trimmed = endpoint_name.trim();
    let lower = trimmed.to_lowercase();
    let prefixes = ["headphones (", "headset (", "earphones (", "speakers (", "headphone ("];
    for p in prefixes {
        if lower.starts_with(p) && trimmed.ends_with(')') && trimmed.len() > p.len() + 1 {
            let inner = &trimmed[p.len()..trimmed.len() - 1];
            return canonical_bt_name(inner);
        }
    }
    canonical_bt_name(trimmed)
}

fn match_connected_bt_for_audio<'a>(
    endpoint_name: &str,
    connected_bt: &'a [ConnectedBluetoothDevice],
) -> Option<&'a ConnectedBluetoothDevice> {
    let lower_full = endpoint_name.to_lowercase();
    let lower_core = extract_audio_endpoint_core_name(endpoint_name).to_lowercase();

    let mut best_match: Option<(&'a ConnectedBluetoothDevice, usize)> = None;
    for dev in connected_bt {
        let dev_canon = canonical_bt_name(&dev.name).to_lowercase();
        if dev_canon.len() < 3 {
            continue;
        }
        let exact = lower_core == dev_canon || lower_full == dev_canon;
        let contains = lower_core.contains(&dev_canon)
            || lower_full.contains(&dev_canon)
            || (lower_core.len() >= 3 && dev_canon.contains(&lower_core));
        if exact || contains {
            let score = if exact { 10_000 + dev_canon.len() } else { dev_canon.len() };
            if best_match.map(|(_, s)| score > s).unwrap_or(true) {
                best_match = Some((dev, score));
            }
        }
    }
    best_match.map(|(dev, _)| dev)
}

pub fn classify_audio_output(
    name: &str,
    enumerator: &str,
    form_factor: u32,
    connected_bt: &[ConnectedBluetoothDevice],
) -> (AudioOutputKind, AudioDeviceType, Option<u8>) {
    let lower_name = name.to_lowercase();
    let upper_enum = enumerator.to_uppercase();
    let matched_bt = match_connected_bt_for_audio(name, connected_bt);

    let is_bt_keyword = lower_name.contains("bluetooth")
        || lower_name.contains("hands-free")
        || lower_name.contains("airpods")
        || lower_name.contains("galaxy buds")
        || lower_name.contains("pixel buds")
        || lower_name.contains("wh-1000")
        || lower_name.contains("wf-1000")
        || lower_name.contains("freebuds")
        || lower_name.contains("tws")
        || lower_name.contains("bt ");

    if upper_enum.contains("BTH") || matched_bt.is_some() || is_bt_keyword {
        let bt_battery = matched_bt.and_then(|d| d.battery_percent);
        return (
            AudioOutputKind::Bluetooth,
            AudioDeviceType::HeadphoneBluetooth,
            bt_battery,
        );
    }

    // FormFactor classification (EndpointFormFactor enum in Windows Core Audio):
    // 1 = Speakers, 2 = LineLevel, 3 = Headphones, 5 = Headset, 6 = Handset, 9 = DigitalAudioDisplayDevice
    let is_wired_keyword = lower_name.contains("headphone")
        || lower_name.contains("headset")
        || lower_name.contains("earphone")
        || lower_name.contains("earbud")
        || lower_name.contains("in-ear")
        || lower_name.contains("jack")
        || lower_name.contains("usb audio")
        || lower_name.contains("usb-c audio")
        || lower_name.contains("type-c audio");

    if form_factor == 3 || form_factor == 5 || form_factor == 6 || is_wired_keyword {
        return (AudioOutputKind::Wired, AudioDeviceType::HeadphoneWired, None);
    }

    if form_factor == 1 || form_factor == 2 || form_factor == 9 {
        return (AudioOutputKind::Speaker, AudioDeviceType::Speaker, None);
    }

    (AudioOutputKind::Speaker, AudioDeviceType::Speaker, None)
}

#[cfg(windows)]
unsafe fn read_store_string_prop(
    store: &windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore,
    key: &windows::Win32::Foundation::PROPERTYKEY,
) -> Option<String> {
    use windows::Win32::System::Com::StructuredStorage::PropVariantToStringAlloc;
    if let Ok(prop_val) = store.GetValue(key) {
        if let Ok(pwstr) = PropVariantToStringAlloc(&prop_val) {
            let s = pwstr.to_string().unwrap_or_default().trim().to_string();
            windows::Win32::System::Com::CoTaskMemFree(Some(pwstr.as_ptr() as _));
            if !s.is_empty() {
                return Some(s);
            }
        }
    }
    None
}

pub fn read_audio_endpoint_status_with_bt(connected_bt: &[ConnectedBluetoothDevice]) -> AudioEndpointInfo {
    #[cfg(windows)]
    unsafe {
        use windows::core::GUID;
        use windows::Win32::Foundation::PROPERTYKEY;
        use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
        use windows::Win32::Media::Audio::{
            eMultimedia, eRender, IMMDeviceEnumerator, MMDeviceEnumerator,
        };
        use windows::Win32::System::Com::StructuredStorage::PropVariantToUInt32;
        use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL, STGM_READ};

        let _com = crate::security_utils::ComGuard::init_mta();
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
                let mut enumerator_name = String::new();
                let mut form_factor = 1u32; // Default Speakers

                if let Ok(store) = device.OpenPropertyStore(STGM_READ) {
                    // PKEY_Device_FriendlyName
                    let pkey_name = PROPERTYKEY {
                        fmtid: GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0),
                        pid: 14,
                    };
                    if let Some(s) = read_store_string_prop(&store, &pkey_name) {
                        device_name = s;
                    }

                    // PKEY_Device_EnumeratorName
                    let pkey_enum = PROPERTYKEY {
                        fmtid: GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0),
                        pid: 24,
                    };
                    if let Some(s) = read_store_string_prop(&store, &pkey_enum) {
                        enumerator_name = s;
                    }

                    // PKEY_AudioEndpoint_FormFactor
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

                let (audio_output_kind, audio_device_type, audio_output_battery) =
                    classify_audio_output(&device_name, &enumerator_name, form_factor, connected_bt);

                return AudioEndpointInfo {
                    master_volume,
                    is_muted,
                    audio_device_name: device_name,
                    audio_device_type,
                    audio_output_kind,
                    audio_output_battery,
                };
            }
        }
    }

    AudioEndpointInfo {
        master_volume: 50,
        is_muted: false,
        audio_device_name: "Default Audio Device".to_string(),
        audio_device_type: AudioDeviceType::Speaker,
        audio_output_kind: AudioOutputKind::Speaker,
        audio_output_battery: None,
    }
}

#[cfg_attr(not(test), allow(dead_code))]
pub fn read_audio_endpoint_status() -> AudioEndpointInfo {
    let cached_bt = get_cached_telemetry().connected_bluetooth_devices;
    read_audio_endpoint_status_with_bt(&cached_bt)
}

pub fn set_master_volume_native(level_percent: u8) -> Result<(), String> {
    #[cfg(windows)]
    unsafe {
        use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
        use windows::Win32::Media::Audio::{
            eMultimedia, eRender, IMMDeviceEnumerator, MMDeviceEnumerator,
        };
        use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};

        let _com = crate::security_utils::ComGuard::init_mta();
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
        use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};

        let _com = crate::security_utils::ComGuard::init_mta();
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
// 4B. Stay Awake Execution State & Windows Radio Controls (Wi-Fi / Bluetooth)
// =========================================================================
static STAY_AWAKE_STATE: AtomicBool = AtomicBool::new(false);

#[cfg(windows)]
static STAY_AWAKE_WORKER: OnceLock<(Mutex<bool>, Condvar)> = OnceLock::new();

pub fn get_stay_awake_state() -> bool {
    STAY_AWAKE_STATE.load(Ordering::Relaxed)
}

pub fn set_stay_awake_native(enabled: bool) -> bool {
    STAY_AWAKE_STATE.store(enabled, Ordering::Relaxed);
    #[cfg(windows)]
    {
        let (lock, cvar) = STAY_AWAKE_WORKER.get_or_init(|| {
            let pair_lock = Mutex::new(enabled);
            let pair_cvar = Condvar::new();
            let _ = std::thread::Builder::new()
                .name("casa-stay-awake".into())
                .spawn(|| unsafe {
                    use windows_sys::Win32::System::Power::{
                        SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED,
                        ES_SYSTEM_REQUIRED,
                    };

                    let (lock, cvar) = STAY_AWAKE_WORKER
                        .get()
                        .expect("STAY_AWAKE_WORKER initialized");
                    let mut last_applied: Option<bool> = None;

                    loop {
                        let current_target = {
                            let mut guard = match lock.lock() {
                                Ok(g) => g,
                                Err(_) => break,
                            };
                            while last_applied == Some(*guard) {
                                guard = match cvar.wait(guard) {
                                    Ok(g) => g,
                                    Err(_) => return,
                                };
                            }
                            *guard
                        };

                        let flags = if current_target {
                            ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED
                        } else {
                            ES_CONTINUOUS
                        };
                        SetThreadExecutionState(flags);
                        last_applied = Some(current_target);
                    }
                });
            (pair_lock, pair_cvar)
        });

        if let Ok(mut guard) = lock.lock() {
            *guard = enabled;
            cvar.notify_one();
        }
    }
    enabled
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq, Default)]
pub struct RadioStates {
    pub wifi_enabled: bool,
    pub wifi_supported: bool,
    pub wifi_ssid: Option<String>,
    pub bluetooth_enabled: bool,
    pub bluetooth_supported: bool,
    pub bluetooth_device_name: Option<String>,
    pub connected_bluetooth_devices: Vec<ConnectedBluetoothDevice>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct WifiNetworkItem {
    pub ssid: String,
    pub signal_quality: u8,
    pub is_secured: bool,
    pub is_connected: bool,
    pub has_profile: bool,
    pub auth_label: String,
    pub cipher_label: String,
    pub is_enterprise: bool,
    pub is_captive_portal: bool,
    pub internet_connectivity: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ExchangeRatesResponse {
    pub base: String,
    pub rates: std::collections::HashMap<String, f64>,
    pub updated_at: String,
    pub source: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct BluetoothDeviceItem {
    pub id: String,
    pub name: String,
    pub address: String,
    pub is_connected: bool,
    pub device_type: String,
    pub battery_percent: Option<u8>,
}

#[cfg(windows)]
fn decode_dot11_ssid(ssid: &windows::Win32::NetworkManagement::WiFi::DOT11_SSID) -> Option<String> {
    let len = (ssid.uSSIDLength as usize).min(ssid.ucSSID.len());
    if len == 0 {
        return None;
    }
    let raw = String::from_utf8_lossy(&ssid.ucSSID[..len]).trim().to_string();
    if raw.is_empty() {
        None
    } else {
        Some(raw)
    }
}

#[cfg(windows)]
fn wide_buf_to_string(buf: &[u16]) -> String {
    let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..end]).trim().to_string()
}

pub fn has_forbidden_xml_control_chars(input: &str) -> bool {
    input.chars().any(|c| c == '\0' || c.is_control())
}

pub fn xml_escape(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for ch in input.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            c if c == '\0' || c.is_control() => {}
            _ => out.push(ch),
        }
    }
    out
}

pub fn classify_dot11_auth(raw_algo: i32, security_enabled: bool) -> (&'static str, bool) {
    if !security_enabled {
        return ("Open", false);
    }
    match raw_algo {
        1 | 11 => ("Open", false),                 // OPEN | OWE
        2 => ("WEP", false),                       // SHARED_KEY
        3 | 6 | 8 | 10 => ("Enterprise", true),    // WPA | RSNA | WPA3_ENT_192 | WPA3_ENT
        4 => ("WPA", false),                       // WPA_PSK
        7 => ("WPA2", false),                      // RSNA_PSK
        9 => ("WPA3", false),                      // WPA3_SAE
        _ => ("WPA2", false),
    }
}

pub fn classify_dot11_cipher(raw_cipher: i32, security_enabled: bool) -> &'static str {
    if !security_enabled {
        return "None";
    }
    match raw_cipher {
        0x00 => "None",
        0x02 => "TKIP",
        0x04 => "AES",
        0x08 | 0x09 => "GCMP",
        0x01 | 0x05 | 0x101 => "WEP",
        _ => "AES",
    }
}

pub fn validate_wifi_ssid(ssid: &str) -> Result<String, String> {
    let clean = ssid.trim();
    if clean.is_empty() {
        return Err("SSID Wi-Fi tidak boleh kosong.".to_string());
    }
    if clean.len() > 32 {
        return Err("SSID Wi-Fi melebihi batas maksimum 32 byte.".to_string());
    }
    if has_forbidden_xml_control_chars(clean) {
        return Err("SSID Wi-Fi mengandung karakter kontrol yang tidak diizinkan.".to_string());
    }
    Ok(clean.to_string())
}

pub fn validate_wifi_passphrase(passphrase: &str) -> Result<bool, String> {
    if has_forbidden_xml_control_chars(passphrase) {
        return Err("Password Wi-Fi mengandung karakter kontrol yang tidak valid.".to_string());
    }
    let len = passphrase.len();
    if len == 64 && passphrase.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Ok(true); // 64-char hex raw networkKey
    }
    if !(8..=63).contains(&len) {
        return Err("Password Wi-Fi harus 8–63 karakter (atau 64 karakter hex).".to_string());
    }
    if !passphrase.bytes().all(|b| (0x20..=0x7E).contains(&b)) {
        return Err("Password Wi-Fi harus menggunakan karakter ASCII standar.".to_string());
    }
    Ok(false)
}

pub fn build_wlan_profile_xml(
    ssid: &str,
    auth_label: &str,
    cipher_label: &str,
    passphrase: Option<&str>,
) -> Result<String, String> {
    let clean_ssid = validate_wifi_ssid(ssid)?;
    if auth_label == "Enterprise" {
        return Err("Jaringan Enterprise (802.1X) memerlukan dialog login Windows.".to_string());
    }
    let escaped_ssid = xml_escape(&clean_ssid);

    if auth_label == "Open" {
        return Ok(format!(
            "<?xml version=\"1.0\"?>\
<WLANProfile xmlns=\"http://www.microsoft.com/networking/WLAN/profile/v1\">\
<name>{escaped_ssid}</name>\
<SSIDConfig><SSID><name>{escaped_ssid}</name></SSID></SSIDConfig>\
<connectionType>ESS</connectionType>\
<connectionMode>manual</connectionMode>\
<MSM><security><authEncryption><authentication>open</authentication><encryption>none</encryption><useOneX>false</useOneX></authEncryption></security></MSM></WLANProfile>"
        ));
    }

    let pwd = passphrase
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Password Wi-Fi diperlukan untuk jaringan terenkripsi.".to_string())?;
    let is_raw_hex_key = validate_wifi_passphrase(pwd)?;
    let key_type = if is_raw_hex_key {
        "networkKey"
    } else {
        "passPhrase"
    };
    let escaped_pwd = xml_escape(pwd);

    let (xml_auth, xml_enc) = match auth_label {
        "WPA3" => ("WPA3SAE", "AES"),
        "WPA" => (
            "WPAPSK",
            if cipher_label == "AES" { "AES" } else { "TKIP" },
        ),
        _ => (
            "WPA2PSK",
            if cipher_label == "TKIP" { "TKIP" } else { "AES" },
        ),
    };

    Ok(format!(
        "<?xml version=\"1.0\"?>\
<WLANProfile xmlns=\"http://www.microsoft.com/networking/WLAN/profile/v1\">\
<name>{escaped_ssid}</name>\
<SSIDConfig><SSID><name>{escaped_ssid}</name></SSID></SSIDConfig>\
<connectionType>ESS</connectionType>\
<connectionMode>auto</connectionMode>\
<MSM><security><authEncryption><authentication>{xml_auth}</authentication><encryption>{xml_enc}</encryption><useOneX>false</useOneX></authEncryption>\
<sharedKey><keyType>{key_type}</keyType><protected>false</protected><keyMaterial>{escaped_pwd}</keyMaterial></sharedKey>\
</security></MSM></WLANProfile>"
    ))
}

#[cfg(windows)]
fn format_bt_address(addr: u64) -> String {
    format!("{:012X}", addr)
}

#[cfg(windows)]
pub fn read_active_wifi_ssid_native() -> Option<String> {
    use std::ffi::c_void;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::NetworkManagement::WiFi::{
        wlan_interface_state_connected, wlan_intf_opcode_current_connection, WlanCloseHandle,
        WlanEnumInterfaces, WlanFreeMemory, WlanOpenHandle, WlanQueryInterface,
        WLAN_CONNECTION_ATTRIBUTES, WLAN_INTERFACE_INFO_LIST,
    };

    unsafe {
        let mut negotiated_version = 0u32;
        let mut client_handle = HANDLE::default();
        if WlanOpenHandle(2, None, &mut negotiated_version, &mut client_handle) != 0 {
            return None;
        }

        let mut iface_list_ptr: *mut WLAN_INTERFACE_INFO_LIST = std::ptr::null_mut();
        let mut connected_ssid: Option<String> = None;

        if WlanEnumInterfaces(client_handle, None, &mut iface_list_ptr) == 0 && !iface_list_ptr.is_null() {
            let count = (*iface_list_ptr).dwNumberOfItems as usize;
            let ifaces = std::slice::from_raw_parts((*iface_list_ptr).InterfaceInfo.as_ptr(), count);

            for iface in ifaces {
                let mut data_size = 0u32;
                let mut data_ptr: *mut c_void = std::ptr::null_mut();
                if WlanQueryInterface(
                    client_handle,
                    &iface.InterfaceGuid,
                    wlan_intf_opcode_current_connection,
                    None,
                    &mut data_size,
                    &mut data_ptr,
                    None,
                ) == 0
                    && !data_ptr.is_null()
                {
                    let attrs = &*(data_ptr as *const WLAN_CONNECTION_ATTRIBUTES);
                    if attrs.isState == wlan_interface_state_connected {
                        if let Some(ssid) = decode_dot11_ssid(&attrs.wlanAssociationAttributes.dot11Ssid) {
                            connected_ssid = Some(ssid);
                        } else {
                            let prof = wide_buf_to_string(&attrs.strProfileName);
                            if !prof.is_empty() {
                                connected_ssid = Some(prof);
                            }
                        }
                    }
                    WlanFreeMemory(data_ptr);
                    if connected_ssid.is_some() {
                        break;
                    }
                }
            }
            WlanFreeMemory(iface_list_ptr as *const c_void);
        }

        let _ = WlanCloseHandle(client_handle, None);
        connected_ssid
    }
}

#[cfg(windows)]
pub fn read_connected_bluetooth_device_name_native() -> Option<String> {
    use windows::Devices::Bluetooth::{
        BluetoothConnectionStatus, BluetoothDevice, BluetoothLEDevice, BluetoothMajorClass,
    };
    use windows::Devices::Enumeration::DeviceInformation;

    let _com = crate::security_utils::ComGuard::init_mta();

    // 1. Check Classic Bluetooth connected devices via WinRT DeviceInformation + BluetoothDevice
    let mut fallback_name: Option<String> = None;
    if let Ok(selector) =
        BluetoothDevice::GetDeviceSelectorFromConnectionStatus(BluetoothConnectionStatus::Connected)
    {
        if let Ok(op) = DeviceInformation::FindAllAsyncAqsFilter(&selector) {
            if let Ok(infos) = op.join() {
                let count = infos.Size().unwrap_or(0);
                for i in 0..count {
                    if let Ok(info) = infos.GetAt(i) {
                        let name = info.Name().map(|s| s.to_string_lossy()).unwrap_or_default();
                        let clean_name = name.trim().to_string();
                        if clean_name.is_empty() {
                            continue;
                        }
                        // Prioritize Audio/Video headphones/speakers over peripherals
                        if let Ok(id) = info.Id() {
                            if let Ok(dev_op) = BluetoothDevice::FromIdAsync(&id) {
                                if let Ok(dev) = dev_op.join() {
                                    if let Ok(cod) = dev.ClassOfDevice() {
                                        if cod.MajorClass().ok() == Some(BluetoothMajorClass::AudioVideo) {
                                            return Some(clean_name);
                                        }
                                    }
                                }
                            }
                        }
                        if fallback_name.is_none() {
                            fallback_name = Some(clean_name);
                        }
                    }
                }
            }
        }
    }

    if fallback_name.is_some() {
        return fallback_name;
    }

    // 2. Fallback to connected BLE devices via WinRT BluetoothLEDevice
    if let Ok(selector) =
        BluetoothLEDevice::GetDeviceSelectorFromConnectionStatus(BluetoothConnectionStatus::Connected)
    {
        if let Ok(op) = DeviceInformation::FindAllAsyncAqsFilter(&selector) {
            if let Ok(infos) = op.join() {
                let count = infos.Size().unwrap_or(0);
                for i in 0..count {
                    if let Ok(info) = infos.GetAt(i) {
                        let name = info.Name().map(|s| s.to_string_lossy()).unwrap_or_default();
                        let clean_name = name.trim().to_string();
                        if !clean_name.is_empty() {
                            return Some(clean_name);
                        }
                    }
                }
            }
        }
    }

    None
}

#[cfg(windows)]
fn open_windows_settings_uri(uri: &str) {
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let op: Vec<u16> = "open\0".encode_utf16().collect();
    let target: Vec<u16> = uri.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            op.as_ptr(),
            target.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        );
    }
}

#[cfg(windows)]
fn is_bt_transport_only_name(name: &str) -> bool {
    let lower = name.trim().to_lowercase();
    if lower.is_empty() {
        return true;
    }
    lower.starts_with("microsoft bluetooth")
        || lower.starts_with("bluetooth device (")
        || lower.starts_with("standard serial over bluetooth")
        || lower.contains("rfcomm protocol")
        || lower.contains("personal area network")
        || lower == "avrcp transport"
        || lower == "jl_spp"
        || lower == "bluetooth"
        || lower == "hands-free ag"
        || lower == "hands-free"
}

#[cfg(windows)]
fn normalize_bt_mac_str(raw: &str) -> Option<String> {
    let hex: String = raw.chars().filter(|c| c.is_ascii_hexdigit()).collect();
    if hex.len() != 12 {
        return None;
    }
    let upper = hex.to_ascii_uppercase();
    Some(format!(
        "{}:{}:{}:{}:{}:{}",
        &upper[0..2],
        &upper[2..4],
        &upper[4..6],
        &upper[6..8],
        &upper[8..10],
        &upper[10..12]
    ))
}

#[cfg(windows)]
fn extract_bt_address_from_instance_id(instance_id: &str) -> Option<String> {
    let upper = instance_id.to_ascii_uppercase();
    for marker in ["BLUETOOTHDEVICE_", "DEV_"] {
        if let Some(pos) = upper.find(marker) {
            let start = pos + marker.len();
            if upper.len() >= start + 12 {
                if let Some(mac) = normalize_bt_mac_str(&upper[start..start + 12]) {
                    return Some(mac);
                }
            }
        }
    }
    None
}

#[cfg(windows)]
struct SetupDiInfoSetGuard(windows::Win32::Devices::DeviceAndDriverInstallation::HDEVINFO);

#[cfg(windows)]
impl Drop for SetupDiInfoSetGuard {
    fn drop(&mut self) {
        unsafe {
            let _ = windows::Win32::Devices::DeviceAndDriverInstallation::SetupDiDestroyDeviceInfoList(self.0);
        }
    }
}

#[cfg(windows)]
unsafe fn pnp_get_bool_prop(
    hdev: windows::Win32::Devices::DeviceAndDriverInstallation::HDEVINFO,
    dev_data: &windows::Win32::Devices::DeviceAndDriverInstallation::SP_DEVINFO_DATA,
    key: &windows::Win32::Foundation::DEVPROPKEY,
) -> Option<bool> {
    use windows::Win32::Devices::DeviceAndDriverInstallation::SetupDiGetDevicePropertyW;
    use windows::Win32::Devices::Properties::{DEVPROPTYPE, DEVPROP_TYPE_BOOLEAN};

    let mut prop_type = DEVPROPTYPE(0);
    let mut req_size = 0u32;
    let mut buf = [0u8; 4];
    if SetupDiGetDevicePropertyW(
        hdev,
        dev_data,
        key,
        &mut prop_type,
        Some(&mut buf),
        Some(&mut req_size),
        0,
    )
    .is_ok()
        && prop_type == DEVPROP_TYPE_BOOLEAN
        && req_size >= 1
    {
        return Some(buf[0] != 0);
    }
    None
}

#[cfg(windows)]
unsafe fn pnp_get_battery_prop(
    hdev: windows::Win32::Devices::DeviceAndDriverInstallation::HDEVINFO,
    dev_data: &windows::Win32::Devices::DeviceAndDriverInstallation::SP_DEVINFO_DATA,
    key: &windows::Win32::Foundation::DEVPROPKEY,
) -> Option<u8> {
    use windows::Win32::Devices::DeviceAndDriverInstallation::SetupDiGetDevicePropertyW;
    use windows::Win32::Devices::Properties::{
        DEVPROPTYPE, DEVPROP_TYPE_BYTE, DEVPROP_TYPE_INT32, DEVPROP_TYPE_UINT32,
    };

    let mut prop_type = DEVPROPTYPE(0);
    let mut req_size = 0u32;
    let mut buf = [0u8; 8];
    if SetupDiGetDevicePropertyW(
        hdev,
        dev_data,
        key,
        &mut prop_type,
        Some(&mut buf),
        Some(&mut req_size),
        0,
    )
    .is_ok()
    {
        if prop_type == DEVPROP_TYPE_BYTE && req_size >= 1 {
            let val = buf[0];
            if val <= 100 {
                return Some(val);
            }
        } else if (prop_type == DEVPROP_TYPE_UINT32 || prop_type == DEVPROP_TYPE_INT32)
            && req_size >= 4
        {
            let val = u32::from_le_bytes([buf[0], buf[1], buf[2], buf[3]]);
            if val <= 100 {
                return Some(val as u8);
            }
        }
    }
    None
}

#[cfg(windows)]
unsafe fn pnp_get_string_prop(
    hdev: windows::Win32::Devices::DeviceAndDriverInstallation::HDEVINFO,
    dev_data: &windows::Win32::Devices::DeviceAndDriverInstallation::SP_DEVINFO_DATA,
    key: &windows::Win32::Foundation::DEVPROPKEY,
) -> Option<String> {
    use windows::Win32::Devices::DeviceAndDriverInstallation::SetupDiGetDevicePropertyW;
    use windows::Win32::Devices::Properties::{DEVPROPTYPE, DEVPROP_TYPE_STRING};

    let mut prop_type = DEVPROPTYPE(0);
    let mut req_size = 0u32;
    let _ = SetupDiGetDevicePropertyW(
        hdev,
        dev_data,
        key,
        &mut prop_type,
        None,
        Some(&mut req_size),
        0,
    );
    if prop_type != DEVPROP_TYPE_STRING || req_size < 2 || req_size > 8192 {
        return None;
    }

    let mut buf = vec![0u8; req_size as usize];
    if SetupDiGetDevicePropertyW(
        hdev,
        dev_data,
        key,
        &mut prop_type,
        Some(&mut buf),
        Some(&mut req_size),
        0,
    )
    .is_err()
    {
        return None;
    }

    let u16s: Vec<u16> = buf
        .chunks_exact(2)
        .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
        .collect();
    let s = wide_buf_to_string(&u16s);
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

#[cfg(windows)]
unsafe fn pnp_get_guid_prop(
    hdev: windows::Win32::Devices::DeviceAndDriverInstallation::HDEVINFO,
    dev_data: &windows::Win32::Devices::DeviceAndDriverInstallation::SP_DEVINFO_DATA,
    key: &windows::Win32::Foundation::DEVPROPKEY,
) -> Option<String> {
    use windows::Win32::Devices::DeviceAndDriverInstallation::SetupDiGetDevicePropertyW;
    use windows::Win32::Devices::Properties::{DEVPROPTYPE, DEVPROP_TYPE_GUID};

    let mut prop_type = DEVPROPTYPE(0);
    let mut req_size = 0u32;
    let mut buf = [0u8; 16];
    if SetupDiGetDevicePropertyW(
        hdev,
        dev_data,
        key,
        &mut prop_type,
        Some(&mut buf),
        Some(&mut req_size),
        0,
    )
    .is_ok()
        && prop_type == DEVPROP_TYPE_GUID
        && req_size >= 16
    {
        return Some(buf.iter().map(|b| format!("{b:02x}")).collect());
    }
    None
}

#[cfg(windows)]
unsafe fn pnp_get_instance_id(
    hdev: windows::Win32::Devices::DeviceAndDriverInstallation::HDEVINFO,
    dev_data: &windows::Win32::Devices::DeviceAndDriverInstallation::SP_DEVINFO_DATA,
) -> String {
    use windows::Win32::Devices::DeviceAndDriverInstallation::SetupDiGetDeviceInstanceIdW;

    let mut buf = [0u16; 512];
    let mut req_size = 0u32;
    if SetupDiGetDeviceInstanceIdW(hdev, dev_data, Some(&mut buf), Some(&mut req_size)).is_ok() {
        return wide_buf_to_string(&buf);
    }
    String::new()
}

/// Scans connected Windows Bluetooth PnP devices across BTHENUM / BTHLE / BTHHFENUM
/// using SetupDiGetClassDevsW + SetupDiEnumDeviceInfo + SetupDiGetDevicePropertyW.
/// Reads DEVPKEY_Device_IsConnected and DEVPKEY_Bluetooth_Battery without panicking
/// or guessing missing battery values.
#[cfg(windows)]
pub fn scan_connected_bluetooth_pnp_native() -> Vec<ConnectedBluetoothDevice> {
    use std::collections::HashMap;
    use windows::core::{GUID, PCWSTR};
    use windows::Win32::Devices::DeviceAndDriverInstallation::{
        SetupDiEnumDeviceInfo, SetupDiGetClassDevsW, DIGCF_ALLCLASSES, DIGCF_PRESENT,
        SP_DEVINFO_DATA,
    };
    use windows::Win32::Foundation::DEVPROPKEY;

    // DEVPKEY_Device_IsConnected {83DA6326-97A6-4088-9453-A1923F573B29}, pid 15
    const DEVPKEY_IS_CONNECTED: DEVPROPKEY = DEVPROPKEY {
        fmtid: GUID::from_u128(0x83da6326_97a6_4088_9453_a1923f573b29),
        pid: 15,
    };
    // DEVPKEY_Bluetooth_Battery {104EA319-6EE2-4701-BD47-8DDBF425BBE5}, pid 2
    const DEVPKEY_BT_BATTERY: DEVPROPKEY = DEVPROPKEY {
        fmtid: GUID::from_u128(0x104ea319_6ee2_4701_bd47_8ddbf425bbe5),
        pid: 2,
    };
    // DEVPKEY_Device_FriendlyName
    const DEVPKEY_FRIENDLY_NAME: DEVPROPKEY = DEVPROPKEY {
        fmtid: GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0),
        pid: 14,
    };
    // DEVPKEY_NAME
    const DEVPKEY_NAME_FALLBACK: DEVPROPKEY = DEVPROPKEY {
        fmtid: GUID::from_u128(0xb725f130_47ef_101a_a5f1_02608c9eebac),
        pid: 10,
    };
    // DEVPKEY_Device_ContainerId {8C7ED206-3F8A-4827-B3AB-AE9E1FAEFC6C}, pid 2
    const DEVPKEY_CONTAINER_ID: DEVPROPKEY = DEVPROPKEY {
        fmtid: GUID::from_u128(0x8c7ed206_3f8a_4827_b3ab_ae9e1faefc6c),
        pid: 2,
    };
    // DEVPKEY_Bluetooth_DeviceAddress {2BD67D8B-8BEB-48D5-87E0-6CDA3428040A}, pid 1
    const DEVPKEY_BT_ADDRESS: DEVPROPKEY = DEVPROPKEY {
        fmtid: GUID::from_u128(0x2bd67d8b_8beb_48d5_87e0_6cda3428040a),
        pid: 1,
    };

    #[derive(Clone)]
    struct MergedBtEntry {
        name: String,
        address: String,
        battery_percent: Option<u8>,
        container_id: Option<String>,
        is_exact_base_name: bool,
    }

    let mut entries: Vec<MergedBtEntry> = Vec::new();
    let mut container_batteries: HashMap<String, u8> = HashMap::new();

    unsafe {
        for enumerator in ["BTHENUM", "BTHLE", "BTHHFENUM", "BTHLEDEVICE"] {
            let enum_w: Vec<u16> = enumerator.encode_utf16().chain(std::iter::once(0)).collect();
            let hdev = match SetupDiGetClassDevsW(
                None,
                PCWSTR(enum_w.as_ptr()),
                None,
                DIGCF_PRESENT | DIGCF_ALLCLASSES,
            ) {
                Ok(h) if !h.is_invalid() => h,
                _ => continue,
            };
            let _guard = SetupDiInfoSetGuard(hdev);

            let mut idx = 0u32;
            loop {
                let mut dev_data = SP_DEVINFO_DATA {
                    cbSize: std::mem::size_of::<SP_DEVINFO_DATA>() as u32,
                    ..Default::default()
                };
                if SetupDiEnumDeviceInfo(hdev, idx, &mut dev_data).is_err() {
                    break;
                }
                idx = idx.saturating_add(1);

                let is_connected = pnp_get_bool_prop(hdev, &dev_data, &DEVPKEY_IS_CONNECTED).unwrap_or(false);
                if !is_connected {
                    continue;
                }

                let container_id = pnp_get_guid_prop(hdev, &dev_data, &DEVPKEY_CONTAINER_ID);
                let battery_percent = pnp_get_battery_prop(hdev, &dev_data, &DEVPKEY_BT_BATTERY);

                if let (Some(cid), Some(pct)) = (&container_id, battery_percent) {
                    container_batteries
                        .entry(cid.clone())
                        .and_modify(|existing| {
                            if pct > *existing {
                                *existing = pct;
                            }
                        })
                        .or_insert(pct);
                }

                // Child GATT nodes under BTHLEDEVICE only contribute container battery above
                // so service descriptors do not pollute the connected device list.
                if enumerator == "BTHLEDEVICE" {
                    continue;
                }

                let raw_name = pnp_get_string_prop(hdev, &dev_data, &DEVPKEY_FRIENDLY_NAME)
                    .or_else(|| pnp_get_string_prop(hdev, &dev_data, &DEVPKEY_NAME_FALLBACK))
                    .unwrap_or_default();

                if is_bt_transport_only_name(&raw_name) {
                    continue;
                }

                let clean_name = canonical_bt_name(&raw_name);
                if is_bt_transport_only_name(&clean_name) {
                    continue;
                }

                let instance_id = pnp_get_instance_id(hdev, &dev_data);
                let address = pnp_get_string_prop(hdev, &dev_data, &DEVPKEY_BT_ADDRESS)
                    .and_then(|s| normalize_bt_mac_str(&s))
                    .or_else(|| extract_bt_address_from_instance_id(&instance_id))
                    .unwrap_or_default();

                let is_exact_base_name = raw_name.trim().eq_ignore_ascii_case(&clean_name);
                let canon_key = clean_name.to_lowercase();

                if let Some(existing) = entries.iter_mut().find(|e| {
                    let same_container = container_id.is_some() && e.container_id == container_id;
                    let same_addr = !address.is_empty() && !e.address.is_empty() && e.address == address;
                    let same_name = e.name.to_lowercase() == canon_key;
                    same_container || same_addr || same_name
                }) {
                    if is_exact_base_name && !existing.is_exact_base_name {
                        existing.name = clean_name;
                        existing.is_exact_base_name = true;
                    }
                    if existing.address.is_empty() && !address.is_empty() {
                        existing.address = address;
                    }
                    if existing.container_id.is_none() && container_id.is_some() {
                        existing.container_id = container_id;
                    }
                    existing.battery_percent = existing.battery_percent.or(battery_percent);
                } else {
                    entries.push(MergedBtEntry {
                        name: clean_name,
                        address,
                        battery_percent,
                        container_id,
                        is_exact_base_name,
                    });
                }
            }
        }
    }

    let mut out: Vec<ConnectedBluetoothDevice> = entries
        .into_iter()
        .map(|e| {
            let cid_batt = e
                .container_id
                .as_ref()
                .and_then(|cid| container_batteries.get(cid).copied());
            ConnectedBluetoothDevice {
                name: e.name,
                address: e.address,
                battery_percent: e.battery_percent.or(cid_batt),
            }
        })
        .collect();

    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

#[cfg(not(windows))]
pub fn scan_connected_bluetooth_pnp_native() -> Vec<ConnectedBluetoothDevice> {
    Vec::new()
}

pub fn read_radio_states_native() -> RadioStates {
    #[cfg(windows)]
    {
        use windows::Devices::Radios::{Radio, RadioKind, RadioState};

        let _com = crate::security_utils::ComGuard::init_mta();

        let mut states = RadioStates::default();
        if let Ok(async_op) = Radio::GetRadiosAsync() {
            if let Ok(radios) = async_op.join() {
                let count = radios.Size().unwrap_or(0);
                for i in 0..count {
                    if let Ok(radio) = radios.GetAt(i) {
                        if let Ok(kind) = radio.Kind() {
                            let is_on = radio.State().map(|s| s == RadioState::On).unwrap_or(false);
                            if kind == RadioKind::WiFi {
                                states.wifi_supported = true;
                                if is_on {
                                    states.wifi_enabled = true;
                                }
                            } else if kind == RadioKind::Bluetooth {
                                states.bluetooth_supported = true;
                                if is_on {
                                    states.bluetooth_enabled = true;
                                }
                            }
                        }
                    }
                }
            }
        }
        if states.wifi_enabled {
            states.wifi_ssid = read_active_wifi_ssid_native();
        }
        if states.bluetooth_enabled {
            let pnp_connected = scan_connected_bluetooth_pnp_native();
            states.connected_bluetooth_devices = pnp_connected;
            states.bluetooth_device_name = states
                .connected_bluetooth_devices
                .first()
                .map(|d| d.name.clone())
                .or_else(read_connected_bluetooth_device_name_native);
        }
        return states;
    }
    #[cfg(not(windows))]
    RadioStates::default()
}

#[cfg(windows)]
fn sync_radio_cache_and_emit(app: &AppHandle) -> RadioStates {
    let states = read_radio_states_native();
    if let Ok(mut guard) = TELEMETRY_CACHE.lock() {
        if let Some(t) = guard.as_mut() {
            t.wifi_supported = states.wifi_supported;
            t.wifi_enabled = states.wifi_enabled;
            t.wifi_ssid = states.wifi_ssid.clone();
            t.bluetooth_supported = states.bluetooth_supported;
            t.bluetooth_enabled = states.bluetooth_enabled;
            t.bluetooth_device_name = states.bluetooth_device_name.clone();
            t.connected_bluetooth_devices = states.connected_bluetooth_devices.clone();
            let audio_info = read_audio_endpoint_status_with_bt(&t.connected_bluetooth_devices);
            t.audio_device_name = audio_info.audio_device_name;
            t.audio_device_type = audio_info.audio_device_type;
            t.audio_output_kind = audio_info.audio_output_kind;
            t.audio_output_battery = audio_info.audio_output_battery;
            t.master_volume = audio_info.master_volume;
            t.is_muted = audio_info.is_muted;
            let _ = app.emit("system-telemetry-update", t.clone());
        }
    }
    states
}

#[cfg(windows)]
fn set_radio_kind_native(
    target_kind: windows::Devices::Radios::RadioKind,
    desired_on: Option<bool>,
    settings_fallback_uri: &str,
) -> Result<bool, String> {
    use windows::Devices::Radios::{Radio, RadioAccessStatus, RadioState};

    let uri = settings_fallback_uri.to_string();
    let handle = std::thread::spawn(move || -> Result<bool, String> {
        let _com = crate::security_utils::ComGuard::init_mta();

        let access = Radio::RequestAccessAsync()
            .map_err(|e| format!("Radio access request failed: {e}"))?
            .join()
            .map_err(|e| format!("Radio access await failed: {e}"))?;

        if access != RadioAccessStatus::Allowed {
            open_windows_settings_uri(&uri);
            return Err("Radio access denied by Windows; opened Windows Settings.".into());
        }

        let radios = Radio::GetRadiosAsync()
            .map_err(|e| format!("GetRadiosAsync failed: {e}"))?
            .join()
            .map_err(|e| format!("GetRadiosAsync await failed: {e}"))?;

        let count = radios.Size().unwrap_or(0);
        let mut matched = Vec::new();
        for i in 0..count {
            if let Ok(radio) = radios.GetAt(i) {
                if radio.Kind() == Ok(target_kind) {
                    matched.push(radio);
                }
            }
        }

        if matched.is_empty() {
            open_windows_settings_uri(&uri);
            return Err("No matching hardware radio found; opened Windows Settings.".into());
        }

        let currently_on = matched
            .iter()
            .any(|r| r.State().map(|s| s == RadioState::On).unwrap_or(false));
        let next_on = desired_on.unwrap_or(!currently_on);
        let next_state = if next_on {
            RadioState::On
        } else {
            RadioState::Off
        };

        let mut any_allowed = false;
        for radio in &matched {
            if let Ok(op) = radio.SetStateAsync(next_state) {
                if let Ok(status) = op.join() {
                    if status == RadioAccessStatus::Allowed {
                        any_allowed = true;
                    }
                }
            }
        }

        if !any_allowed {
            open_windows_settings_uri(&uri);
            return Err("Windows denied radio state change; opened Windows Settings.".into());
        }

        // Verify actual OS hardware radio transition (Bluetooth/Wi-Fi adapters can take ~150-350ms to power ON)
        let mut verified_on = matched
            .iter()
            .any(|r| r.State().map(|s| s == RadioState::On).unwrap_or(false));
        for _ in 0..4 {
            if verified_on == next_on {
                break;
            }
            std::thread::sleep(Duration::from_millis(90));
            let live = read_radio_states_native();
            verified_on = if target_kind == windows::Devices::Radios::RadioKind::Bluetooth {
                live.bluetooth_enabled
            } else {
                live.wifi_enabled
            };
        }

        if verified_on != next_on {
            open_windows_settings_uri(&uri);
            return Err("Hardware radio did not reach requested state; opened Windows Settings.".into());
        }

        Ok(verified_on)
    });

    handle
        .join()
        .map_err(|_| "Radio worker thread panicked".to_string())?
}

// =========================================================================
// 5. Background Poller & Event Emission
// =========================================================================
#[cfg(windows)]
fn read_fullscreen_active() -> bool {
    use windows::Win32::UI::Shell::{
        SHQueryUserNotificationState, QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN,
    };
    use windows_sys::Win32::Foundation::RECT;
    use windows_sys::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetClassNameW, GetForegroundWindow, GetWindowLongW, GetWindowRect,
        GetWindowThreadProcessId, IsIconic, IsWindowVisible, GWL_STYLE, WS_CAPTION,
    };

    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() || IsWindowVisible(hwnd) == 0 || IsIconic(hwnd) != 0 {
            return false;
        }

        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid == 0 || pid == std::process::id() {
            return false;
        }

        let mut class_buf = [0u16; 128];
        let len = GetClassNameW(hwnd, class_buf.as_mut_ptr(), class_buf.len() as i32);
        if len > 0 {
            let class_name = String::from_utf16_lossy(&class_buf[..len as usize]);
            if matches!(
                class_name.as_str(),
                "Progman"
                    | "WorkerW"
                    | "Shell_TrayWnd"
                    | "Shell_SecondaryTrayWnd"
                    | "NotifyIconOverflowWindow"
                    | "MultitaskingViewFrame"
                    | "TopLevelWindowForOverflowXamlIsland"
            ) {
                return false;
            }
        }

        if let Ok(state) = SHQueryUserNotificationState() {
            if state == QUNS_RUNNING_D3D_FULL_SCREEN || state == QUNS_PRESENTATION_MODE {
                return true;
            }
        }

        let mut win_rect = RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        if GetWindowRect(hwnd, &mut win_rect) == 0 {
            return false;
        }

        let hmon = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        if hmon.is_null() {
            return false;
        }

        let mut mi: MONITORINFO = std::mem::zeroed();
        mi.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        if GetMonitorInfoW(hmon, &mut mi) == 0 {
            return false;
        }

        let covers_monitor = win_rect.left <= mi.rcMonitor.left + 2
            && win_rect.top <= mi.rcMonitor.top + 2
            && win_rect.right >= mi.rcMonitor.right - 2
            && win_rect.bottom >= mi.rcMonitor.bottom - 2;
        if !covers_monitor {
            return false;
        }

        let taskbar_hidden = mi.rcWork.left <= mi.rcMonitor.left
            && mi.rcWork.top <= mi.rcMonitor.top
            && mi.rcWork.right >= mi.rcMonitor.right
            && mi.rcWork.bottom >= mi.rcMonitor.bottom;
        if taskbar_hidden {
            let style = GetWindowLongW(hwnd, GWL_STYLE) as u32;
            if (style & WS_CAPTION) == WS_CAPTION {
                return false;
            }
        }

        true
    }
}

#[cfg(not(windows))]
fn read_fullscreen_active() -> bool {
    false
}

pub fn start_hardware_telemetry_daemon(app: AppHandle) {
    std::thread::Builder::new()
        .name("casa-hardware-telemetry".into())
        .spawn(move || {
            // Inisialisasi COM untuk dedicated thread ini (MTA) dengan guard RAII
            #[cfg(windows)]
            let _com = crate::security_utils::ComGuard::init_mta();

            let mut tick_counter: u64 = 0;
            let mut last_telemetry = SystemTelemetry::default();
            let mut last_battery = (100u8, true, false);
            let mut last_brightness = (50u8, false);
            let mut last_radios = RadioStates::default();
            let mut last_audio_name = String::new();

            loop {
                tick_counter = tick_counter.wrapping_add(1);

                // Fast loop (500ms): Caps Lock, Stay Awake & Audio Endpoint Volume/State
                let is_caps_locked = read_caps_lock_status();
                let stay_awake = get_stay_awake_state();
                let mut audio_info = read_audio_endpoint_status_with_bt(&last_radios.connected_bluetooth_devices);

                // Slower loop (2000ms = every 4 ticks), OR immediate refresh if audio endpoint switched
                let audio_endpoint_switched = !last_audio_name.is_empty() && last_audio_name != audio_info.audio_device_name;
                if tick_counter % 4 == 1 || tick_counter == 1 {
                    last_battery = read_power_status();
                    last_brightness = read_display_brightness_wmi();
                    last_radios = read_radio_states_native();
                    audio_info = read_audio_endpoint_status_with_bt(&last_radios.connected_bluetooth_devices);
                } else if audio_endpoint_switched {
                    if last_radios.bluetooth_enabled {
                        last_radios.connected_bluetooth_devices = scan_connected_bluetooth_pnp_native();
                        last_radios.bluetooth_device_name = last_radios
                            .connected_bluetooth_devices
                            .first()
                            .map(|d| d.name.clone())
                            .or(last_radios.bluetooth_device_name);
                    }
                    audio_info = read_audio_endpoint_status_with_bt(&last_radios.connected_bluetooth_devices);
                }
                last_audio_name = audio_info.audio_device_name.clone();

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
                    audio_output_kind: audio_info.audio_output_kind,
                    audio_output_battery: audio_info.audio_output_battery,
                    wifi_enabled: last_radios.wifi_enabled,
                    wifi_supported: last_radios.wifi_supported,
                    wifi_ssid: last_radios.wifi_ssid.clone(),
                    bluetooth_enabled: last_radios.bluetooth_enabled,
                    bluetooth_supported: last_radios.bluetooth_supported,
                    bluetooth_device_name: last_radios.bluetooth_device_name.clone(),
                    connected_bluetooth_devices: last_radios.connected_bluetooth_devices.clone(),
                    stay_awake,
                    is_fullscreen_active: read_fullscreen_active(),
                };

                // Emit if changed, on tick 1 (immediate startup sync), or every 10 ticks (5s) as a heartbeat
                let changed = current_telemetry != last_telemetry;
                if tick_counter == 1 || changed || tick_counter % 10 == 0 {
                    update_cached_telemetry(current_telemetry.clone());
                    let _ = app.emit("system-telemetry-update", &current_telemetry);
                    last_telemetry = current_telemetry;
                }

                std::thread::sleep(Duration::from_millis(500));
            }
        })
        .expect("Failed to spawn hardware telemetry thread");
}

// =========================================================================
// 6. Tauri Commands
// =========================================================================
#[tauri::command]
pub fn get_hardware_telemetry() -> Result<SystemTelemetry, String> {
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

#[tauri::command]
pub fn set_stay_awake(app: AppHandle, enabled: bool) -> Result<bool, String> {
    let state = set_stay_awake_native(enabled);
    if let Ok(mut guard) = TELEMETRY_CACHE.lock() {
        if let Some(t) = guard.as_mut() {
            t.stay_awake = state;
            let _ = app.emit("system-telemetry-update", t.clone());
        }
    }
    Ok(state)
}

#[tauri::command]
pub fn get_stay_awake() -> Result<bool, String> {
    Ok(get_stay_awake_state())
}

#[tauri::command]
pub fn get_radio_states() -> Result<RadioStates, String> {
    Ok(read_radio_states_native())
}

#[tauri::command]
pub fn toggle_wifi(app: AppHandle, enabled: Option<bool>) -> Result<bool, String> {
    #[cfg(windows)]
    {
        let res = set_radio_kind_native(
            windows::Devices::Radios::RadioKind::WiFi,
            enabled,
            "ms-settings:network-wifi",
        );
        let states = sync_radio_cache_and_emit(&app);
        match res {
            Ok(next) => return Ok(next),
            Err(err) => return Err(format!("{err} (actual_wifi={})", states.wifi_enabled)),
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (app, enabled);
        Ok(false)
    }
}

#[tauri::command]
pub fn toggle_bluetooth(app: AppHandle, enabled: Option<bool>) -> Result<bool, String> {
    #[cfg(windows)]
    {
        let res = set_radio_kind_native(
            windows::Devices::Radios::RadioKind::Bluetooth,
            enabled,
            "ms-settings:bluetooth",
        );
        let states = sync_radio_cache_and_emit(&app);
        match res {
            Ok(next) => return Ok(next),
            Err(err) => return Err(format!("{err} (actual_bluetooth={})", states.bluetooth_enabled)),
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (app, enabled);
        Ok(false)
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct AudioDeviceItem {
    pub id: String,
    pub name: String,
    pub device_type: AudioDeviceType,
    pub output_kind: AudioOutputKind,
    pub battery_percent: Option<u8>,
    pub is_default: bool,
}

pub fn enumerate_audio_output_devices() -> Result<Vec<AudioDeviceItem>, String> {
    #[cfg(windows)]
    unsafe {
        use windows::Win32::Media::Audio::{
            eMultimedia, eRender, IMMDeviceCollection, IMMDeviceEnumerator,
            MMDeviceEnumerator, DEVICE_STATE_ACTIVE,
        };
        use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL, STGM_READ};
        use windows::Win32::Foundation::PROPERTYKEY;
        use windows::Win32::System::Com::StructuredStorage::PropVariantToUInt32;
        use windows::core::GUID;

        let _com = crate::security_utils::ComGuard::init_mta();
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|e| format!("CoCreateInstance MMDeviceEnumerator failed: {e}"))?;

        let default_id = if let Ok(def_dev) = enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia) {
            if let Ok(pwstr) = def_dev.GetId() {
                let id_str = pwstr.to_string().unwrap_or_default();
                windows::Win32::System::Com::CoTaskMemFree(Some(pwstr.as_ptr() as _));
                id_str
            } else {
                String::new()
            }
        } else {
            String::new()
        };

        let connected_bt = {
            let cached = get_cached_telemetry().connected_bluetooth_devices;
            if cached.is_empty() {
                scan_connected_bluetooth_pnp_native()
            } else {
                cached
            }
        };

        let collection: IMMDeviceCollection = enumerator
            .EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)
            .map_err(|e| format!("EnumAudioEndpoints failed: {e}"))?;

        let count = collection
            .GetCount()
            .map_err(|e| format!("GetCount failed: {e}"))?;

        let mut items = Vec::new();

        for i in 0..count {
            if let Ok(device) = collection.Item(i) {
                let id = if let Ok(pwstr) = device.GetId() {
                    let id_str = pwstr.to_string().unwrap_or_default();
                    windows::Win32::System::Com::CoTaskMemFree(Some(pwstr.as_ptr() as _));
                    id_str
                } else {
                    continue;
                };

                let mut name = "Speakers".to_string();
                let mut enumerator_name = String::new();
                let mut form_factor = 1u32;

                if let Ok(store) = device.OpenPropertyStore(STGM_READ) {
                    let pkey_name = PROPERTYKEY {
                        fmtid: GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0),
                        pid: 14,
                    };
                    if let Some(s) = read_store_string_prop(&store, &pkey_name) {
                        name = s;
                    }

                    let pkey_enum = PROPERTYKEY {
                        fmtid: GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0),
                        pid: 24,
                    };
                    if let Some(s) = read_store_string_prop(&store, &pkey_enum) {
                        enumerator_name = s;
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

                let (output_kind, device_type, battery_percent) = classify_audio_output(
                    &name,
                    &enumerator_name,
                    form_factor,
                    &connected_bt,
                );
                let is_default = !default_id.is_empty() && id == default_id;

                items.push(AudioDeviceItem {
                    id,
                    name,
                    device_type,
                    output_kind,
                    battery_percent,
                    is_default,
                });
            }
        }

        return Ok(items);
    }
    #[cfg(not(windows))]
    Ok(vec![])
}

#[cfg(windows)]
#[allow(non_snake_case)]
mod policy_config_com {
    use std::ffi::c_void;
    use windows_core::{interface, HRESULT, IUnknown, IUnknown_Vtbl, PCWSTR};

    #[interface("f8679f50-850a-41cf-9c72-430f290290c8")]
    pub unsafe trait IPolicyConfig: IUnknown {
        pub fn GetMixFormat(&self, device_name: PCWSTR, format: *mut *mut c_void) -> HRESULT;
        pub fn GetDeviceFormat(&self, device_name: PCWSTR, default: i32, format: *mut *mut c_void) -> HRESULT;
        pub fn ResetDeviceFormat(&self, device_name: PCWSTR) -> HRESULT;
        pub fn SetDeviceFormat(&self, device_name: PCWSTR, ep_format: *const c_void, mix_format: *const c_void) -> HRESULT;
        pub fn GetProcessingPeriod(&self, device_name: PCWSTR, default: i32, default_period: *mut i64, min_period: *mut i64) -> HRESULT;
        pub fn SetProcessingPeriod(&self, device_name: PCWSTR, period: *const i64) -> HRESULT;
        pub fn GetShareMode(&self, device_name: PCWSTR, mode: *mut c_void) -> HRESULT;
        pub fn SetShareMode(&self, device_name: PCWSTR, mode: *const c_void) -> HRESULT;
        pub fn GetPropertyValue(&self, device_name: PCWSTR, fx_store: i32, key: *const c_void, pv: *mut c_void) -> HRESULT;
        pub fn SetPropertyValue(&self, device_name: PCWSTR, fx_store: i32, key: *const c_void, pv: *const c_void) -> HRESULT;
        pub fn SetDefaultEndpoint(&self, wsz_device_id: PCWSTR, role: u32) -> HRESULT;
        pub fn SetEndpointVisibility(&self, device_name: PCWSTR, visible: i32) -> HRESULT;
    }

    #[interface("568b9108-44bf-40b4-9006-86afe5b5a620")]
    pub unsafe trait IPolicyConfigVista: IUnknown {
        pub fn GetMixFormat(&self, device_name: PCWSTR, format: *mut *mut c_void) -> HRESULT;
        pub fn GetDeviceFormat(&self, device_name: PCWSTR, default: i32, format: *mut *mut c_void) -> HRESULT;
        pub fn SetDeviceFormat(&self, device_name: PCWSTR, ep_format: *const c_void, mix_format: *const c_void) -> HRESULT;
        pub fn GetProcessingPeriod(&self, device_name: PCWSTR, default: i32, default_period: *mut i64, min_period: *mut i64) -> HRESULT;
        pub fn SetProcessingPeriod(&self, device_name: PCWSTR, period: *const i64) -> HRESULT;
        pub fn GetShareMode(&self, device_name: PCWSTR, mode: *mut c_void) -> HRESULT;
        pub fn SetShareMode(&self, device_name: PCWSTR, mode: *const c_void) -> HRESULT;
        pub fn GetPropertyValue(&self, device_name: PCWSTR, fx_store: i32, key: *const c_void, pv: *mut c_void) -> HRESULT;
        pub fn SetPropertyValue(&self, device_name: PCWSTR, fx_store: i32, key: *const c_void, pv: *const c_void) -> HRESULT;
        pub fn SetDefaultEndpoint(&self, wsz_device_id: PCWSTR, role: u32) -> HRESULT;
        pub fn SetEndpointVisibility(&self, device_name: PCWSTR, visible: i32) -> HRESULT;
    }
}

pub fn set_default_audio_endpoint_native(device_id: &str) -> Result<(), String> {
    let trimmed_id = device_id.trim();
    if trimmed_id.is_empty()
        || trimmed_id.len() > 512
        || trimmed_id.chars().any(|c| c == '\0' || c.is_control())
    {
        return Err("ID endpoint audio tidak valid.".to_string());
    }

    let active_devices = enumerate_audio_output_devices()?;
    if !active_devices.iter().any(|dev| dev.id == trimmed_id) {
        return Err("Endpoint audio tidak ditemukan pada daftar perangkat aktif.".to_string());
    }

    #[cfg(windows)]
    unsafe {
        use policy_config_com::{IPolicyConfig, IPolicyConfigVista};
        use windows::core::{GUID, PCWSTR};
        use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};

        let _com = crate::security_utils::ComGuard::init_mta();

        const CLSID_POLICY_CONFIG_CLIENT: GUID =
            GUID::from_u128(0x870af99c_171d_4f9e_af0d_e63df40c2bc9);
        const CLSID_POLICY_CONFIG_FALLBACK: GUID =
            GUID::from_u128(0x294612b3_f092_4633_8a07_889b1ee9ee87);

        let wide_id: Vec<u16> = trimmed_id.encode_utf16().chain(std::iter::once(0)).collect();
        let dev_pcwstr = PCWSTR(wide_id.as_ptr());

        let (res0, res1, res2) = if let Ok(cfg) =
            CoCreateInstance::<_, IPolicyConfig>(&CLSID_POLICY_CONFIG_CLIENT, None, CLSCTX_ALL)
        {
            (
                cfg.SetDefaultEndpoint(dev_pcwstr, 0),
                cfg.SetDefaultEndpoint(dev_pcwstr, 1),
                cfg.SetDefaultEndpoint(dev_pcwstr, 2),
            )
        } else {
            let cfg_vista: IPolicyConfigVista =
                CoCreateInstance(&CLSID_POLICY_CONFIG_FALLBACK, None, CLSCTX_ALL)
                    .map_err(|e| format!("Failed to CoCreateInstance IPolicyConfig: {e}"))?;
            (
                cfg_vista.SetDefaultEndpoint(dev_pcwstr, 0),
                cfg_vista.SetDefaultEndpoint(dev_pcwstr, 1),
                cfg_vista.SetDefaultEndpoint(dev_pcwstr, 2),
            )
        };

        if res0.is_err() && res1.is_err() && res2.is_err() {
            return Err(format!("SetDefaultEndpoint failed: hr={:?}", res0));
        }

        Ok(())
    }
    #[cfg(not(windows))]
    Ok(())
}

#[tauri::command]
pub fn get_audio_output_devices() -> Result<Vec<AudioDeviceItem>, String> {
    enumerate_audio_output_devices()
}

#[tauri::command]
pub fn set_default_audio_endpoint(app: AppHandle, device_id: String) -> Result<(), String> {
    set_default_audio_endpoint_native(&device_id)?;
    // Trigger instant refresh of cached telemetry audio endpoint + connected BT battery match
    let connected_bt = {
        let cached = get_cached_telemetry().connected_bluetooth_devices;
        if cached.is_empty() {
            scan_connected_bluetooth_pnp_native()
        } else {
            cached
        }
    };
    let audio_info = read_audio_endpoint_status_with_bt(&connected_bt);
    if let Ok(mut guard) = TELEMETRY_CACHE.lock() {
        if let Some(t) = guard.as_mut() {
            t.audio_device_name = audio_info.audio_device_name;
            t.audio_device_type = audio_info.audio_device_type;
            t.audio_output_kind = audio_info.audio_output_kind;
            t.audio_output_battery = audio_info.audio_output_battery;
            t.master_volume = audio_info.master_volume;
            t.is_muted = audio_info.is_muted;
            let _ = app.emit("system-telemetry-update", t.clone());
        }
    }
    Ok(())
}

// =========================================================================
// 7. Native Wi-Fi Scanner, Captive Portal & Adaptive Connector (Win32 WLAN API)
// =========================================================================

#[cfg(windows)]
pub fn read_internet_connectivity_native() -> (String, bool) {
    use windows::Networking::Connectivity::{NetworkConnectivityLevel, NetworkInformation};

    let _com = crate::security_utils::ComGuard::init_mta();
    let Ok(profile) = NetworkInformation::GetInternetConnectionProfile() else {
        return ("None".to_string(), false);
    };
    match profile.GetNetworkConnectivityLevel() {
        Ok(NetworkConnectivityLevel::InternetAccess) => ("InternetAccess".to_string(), false),
        Ok(NetworkConnectivityLevel::ConstrainedInternetAccess) => {
            ("ConstrainedInternetAccess".to_string(), true)
        }
        Ok(NetworkConnectivityLevel::LocalAccess) => ("LocalAccess".to_string(), false),
        Ok(NetworkConnectivityLevel::None) => ("None".to_string(), false),
        _ => ("Unknown".to_string(), false),
    }
}

#[cfg(windows)]
pub fn scan_wifi_networks_native() -> Result<Vec<WifiNetworkItem>, String> {
    use std::collections::HashMap;
    use std::ffi::c_void;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::NetworkManagement::WiFi::{
        wlan_interface_state_connected, wlan_intf_opcode_current_connection, WlanCloseHandle,
        WlanEnumInterfaces, WlanFreeMemory, WlanGetAvailableNetworkList, WlanGetProfileList,
        WlanOpenHandle, WlanQueryInterface, WlanScan, WLAN_AVAILABLE_NETWORK_CONNECTED,
        WLAN_AVAILABLE_NETWORK_HAS_PROFILE, WLAN_AVAILABLE_NETWORK_LIST,
        WLAN_CONNECTION_ATTRIBUTES, WLAN_INTERFACE_INFO_LIST, WLAN_PROFILE_INFO_LIST,
    };

    let (internet_connectivity, is_captive_portal) = read_internet_connectivity_native();

    unsafe {
        let mut negotiated_version = 0u32;
        let mut client_handle = HANDLE::default();
        let open_err = WlanOpenHandle(2, None, &mut negotiated_version, &mut client_handle);
        if open_err != 0 {
            return Err(format!("WlanOpenHandle gagal (code={open_err})"));
        }

        let mut iface_list_ptr: *mut WLAN_INTERFACE_INFO_LIST = std::ptr::null_mut();
        let enum_err = WlanEnumInterfaces(client_handle, None, &mut iface_list_ptr);
        if enum_err != 0 || iface_list_ptr.is_null() {
            let _ = WlanCloseHandle(client_handle, None);
            return Err("Adapter Wi-Fi tidak ditemukan.".to_string());
        }

        let iface_count = (*iface_list_ptr).dwNumberOfItems as usize;
        if iface_count == 0 {
            WlanFreeMemory(iface_list_ptr as *const c_void);
            let _ = WlanCloseHandle(client_handle, None);
            return Ok(Vec::new());
        }

        let ifaces =
            std::slice::from_raw_parts((*iface_list_ptr).InterfaceInfo.as_ptr(), iface_count);
        let iface_guid = ifaces[0].InterfaceGuid;

        // Read currently connected SSID on this adapter
        let mut connected_ssid: Option<String> = None;
        let mut data_size = 0u32;
        let mut data_ptr: *mut c_void = std::ptr::null_mut();
        if WlanQueryInterface(
            client_handle,
            &iface_guid,
            wlan_intf_opcode_current_connection,
            None,
            &mut data_size,
            &mut data_ptr,
            None,
        ) == 0
            && !data_ptr.is_null()
        {
            let attrs = &*(data_ptr as *const WLAN_CONNECTION_ATTRIBUTES);
            if attrs.isState == wlan_interface_state_connected {
                connected_ssid = decode_dot11_ssid(&attrs.wlanAssociationAttributes.dot11Ssid)
                    .or_else(|| {
                        let p = wide_buf_to_string(&attrs.strProfileName);
                        if p.is_empty() { None } else { Some(p) }
                    });
            }
            WlanFreeMemory(data_ptr);
        }

        // Collect stored profile names so we know which networks already have saved profiles
        let mut stored_profiles: std::collections::HashSet<String> = std::collections::HashSet::new();
        let mut prof_list_ptr: *mut WLAN_PROFILE_INFO_LIST = std::ptr::null_mut();
        if WlanGetProfileList(client_handle, &iface_guid, None, &mut prof_list_ptr) == 0
            && !prof_list_ptr.is_null()
        {
            let pcount = (*prof_list_ptr).dwNumberOfItems as usize;
            let profs =
                std::slice::from_raw_parts((*prof_list_ptr).ProfileInfo.as_ptr(), pcount);
            for p in profs {
                let name = wide_buf_to_string(&p.strProfileName);
                if !name.is_empty() {
                    stored_profiles.insert(name);
                }
            }
            WlanFreeMemory(prof_list_ptr as *const c_void);
        }

        // Trigger async fresh BSS scan briefly so nearby SSIDs stay fresh
        let _ = WlanScan(client_handle, &iface_guid, None, None, None);

        let mut net_list_ptr: *mut WLAN_AVAILABLE_NETWORK_LIST = std::ptr::null_mut();
        let list_err = WlanGetAvailableNetworkList(client_handle, &iface_guid, 0, None, &mut net_list_ptr);

        let mut map: HashMap<String, WifiNetworkItem> = HashMap::new();

        if list_err == 0 && !net_list_ptr.is_null() {
            let ncount = (*net_list_ptr).dwNumberOfItems as usize;
            let nets = std::slice::from_raw_parts((*net_list_ptr).Network.as_ptr(), ncount);
            for net in nets {
                let Some(ssid) = decode_dot11_ssid(&net.dot11Ssid) else {
                    continue;
                };
                let prof_name = wide_buf_to_string(&net.strProfileName);
                let has_profile = (net.dwFlags & WLAN_AVAILABLE_NETWORK_HAS_PROFILE) != 0
                    || (!prof_name.is_empty() && stored_profiles.contains(&prof_name))
                    || stored_profiles.contains(&ssid);
                let is_connected = (net.dwFlags & WLAN_AVAILABLE_NETWORK_CONNECTED) != 0
                    || connected_ssid.as_deref() == Some(ssid.as_str());
                let sec_enabled = net.bSecurityEnabled.as_bool();
                let (auth_str, is_enterprise) =
                    classify_dot11_auth(net.dot11DefaultAuthAlgorithm.0, sec_enabled);
                let cipher_str =
                    classify_dot11_cipher(net.dot11DefaultCipherAlgorithm.0, sec_enabled);
                let is_secured = auth_str != "Open";
                let signal_quality = (net.wlanSignalQuality as u8).min(100);

                map.entry(ssid.clone())
                    .and_modify(|existing| {
                        if signal_quality > existing.signal_quality {
                            existing.signal_quality = signal_quality;
                        }
                        existing.has_profile = existing.has_profile || has_profile;
                        existing.is_connected = existing.is_connected || is_connected;
                        existing.is_secured = existing.is_secured || is_secured;
                        existing.is_enterprise = existing.is_enterprise || is_enterprise;
                        if existing.auth_label == "Open" && auth_str != "Open" {
                            existing.auth_label = auth_str.to_string();
                            existing.cipher_label = cipher_str.to_string();
                        } else if existing.auth_label == "WPA2" && auth_str == "WPA3" {
                            existing.auth_label = "WPA3".to_string();
                            existing.cipher_label = cipher_str.to_string();
                        }
                        if existing.is_connected {
                            existing.is_captive_portal = is_captive_portal;
                            existing.internet_connectivity = internet_connectivity.clone();
                        }
                    })
                    .or_insert(WifiNetworkItem {
                        ssid,
                        signal_quality,
                        is_secured,
                        is_connected,
                        has_profile,
                        auth_label: auth_str.to_string(),
                        cipher_label: cipher_str.to_string(),
                        is_enterprise,
                        is_captive_portal: if is_connected { is_captive_portal } else { false },
                        internet_connectivity: if is_connected {
                            internet_connectivity.clone()
                        } else {
                            "None".to_string()
                        },
                    });
            }
            WlanFreeMemory(net_list_ptr as *const c_void);
        } else {
            // Windows 11 Location Privacy may block BSS scans for desktop apps (ERROR_ACCESS_DENIED = 5).
            // Fall back to saved Windows WLAN profiles + active SSID cleanly.
            for prof in &stored_profiles {
                let is_connected = connected_ssid.as_deref() == Some(prof.as_str());
                map.insert(
                    prof.clone(),
                    WifiNetworkItem {
                        ssid: prof.clone(),
                        signal_quality: if is_connected { 100 } else { 70 },
                        is_secured: true,
                        is_connected,
                        has_profile: true,
                        auth_label: "WPA2".to_string(),
                        cipher_label: "AES".to_string(),
                        is_enterprise: false,
                        is_captive_portal: if is_connected { is_captive_portal } else { false },
                        internet_connectivity: if is_connected {
                            internet_connectivity.clone()
                        } else {
                            "None".to_string()
                        },
                    },
                );
            }
            if let Some(conn) = &connected_ssid {
                map.entry(conn.clone()).or_insert(WifiNetworkItem {
                    ssid: conn.clone(),
                    signal_quality: 100,
                    is_secured: true,
                    is_connected: true,
                    has_profile: true,
                    auth_label: "WPA2".to_string(),
                    cipher_label: "AES".to_string(),
                    is_enterprise: false,
                    is_captive_portal,
                    internet_connectivity: internet_connectivity.clone(),
                });
            }
        }

        WlanFreeMemory(iface_list_ptr as *const c_void);
        let _ = WlanCloseHandle(client_handle, None);

        let mut items: Vec<WifiNetworkItem> = map.into_values().collect();
        items.sort_by(|a, b| {
            b.is_connected
                .cmp(&a.is_connected)
                .then(b.has_profile.cmp(&a.has_profile))
                .then(b.signal_quality.cmp(&a.signal_quality))
                .then(a.ssid.to_lowercase().cmp(&b.ssid.to_lowercase()))
        });
        Ok(items)
    }
}

#[cfg(windows)]
pub fn connect_wifi_network_native(ssid: &str, password: Option<&str>) -> Result<(), String> {
    use std::ffi::c_void;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::NetworkManagement::WiFi::{
        dot11_BSS_type_infrastructure, wlan_connection_mode_profile,
        wlan_interface_state_associating, wlan_interface_state_authenticating,
        wlan_interface_state_connected, wlan_interface_state_disconnected,
        wlan_interface_state_discovering, wlan_intf_opcode_current_connection, WlanCloseHandle,
        WlanConnect, WlanDeleteProfile, WlanEnumInterfaces, WlanFreeMemory,
        WlanGetAvailableNetworkList, WlanGetProfileList, WlanOpenHandle, WlanQueryInterface,
        WlanSetProfile, DOT11_SSID, WLAN_AVAILABLE_NETWORK_LIST, WLAN_CONNECTION_ATTRIBUTES,
        WLAN_CONNECTION_PARAMETERS, WLAN_INTERFACE_INFO_LIST, WLAN_PROFILE_INFO_LIST,
        WLAN_PROFILE_USER,
    };

    let clean_ssid = validate_wifi_ssid(ssid)?;

    unsafe {
        let mut negotiated_version = 0u32;
        let mut client_handle = HANDLE::default();
        let open_err = WlanOpenHandle(2, None, &mut negotiated_version, &mut client_handle);
        if open_err != 0 {
            return Err(format!("WlanOpenHandle gagal (code={open_err})"));
        }

        let mut iface_list_ptr: *mut WLAN_INTERFACE_INFO_LIST = std::ptr::null_mut();
        let enum_err = WlanEnumInterfaces(client_handle, None, &mut iface_list_ptr);
        if enum_err != 0 || iface_list_ptr.is_null() {
            let _ = WlanCloseHandle(client_handle, None);
            return Err("Adapter Wi-Fi tidak ditemukan.".to_string());
        }

        let iface_count = (*iface_list_ptr).dwNumberOfItems as usize;
        if iface_count == 0 {
            WlanFreeMemory(iface_list_ptr as *const c_void);
            let _ = WlanCloseHandle(client_handle, None);
            return Err("Tidak ada interface Wi-Fi aktif.".to_string());
        }

        let ifaces =
            std::slice::from_raw_parts((*iface_list_ptr).InterfaceInfo.as_ptr(), iface_count);
        let iface_guid = ifaces[0].InterfaceGuid;
        WlanFreeMemory(iface_list_ptr as *const c_void);

        // Inspect available networks + saved Windows profiles to resolve exact auth/cipher/profile
        let mut matched_net_profile: Option<String> = None;
        let mut detected_auth = "WPA2";
        let mut detected_cipher = "AES";
        let mut is_enterprise = false;
        let mut net_list_ptr: *mut WLAN_AVAILABLE_NETWORK_LIST = std::ptr::null_mut();
        if WlanGetAvailableNetworkList(client_handle, &iface_guid, 0, None, &mut net_list_ptr) == 0
            && !net_list_ptr.is_null()
        {
            let ncount = (*net_list_ptr).dwNumberOfItems as usize;
            let nets = std::slice::from_raw_parts((*net_list_ptr).Network.as_ptr(), ncount);
            for net in nets {
                if decode_dot11_ssid(&net.dot11Ssid).as_deref() == Some(clean_ssid.as_str()) {
                    let pname = wide_buf_to_string(&net.strProfileName);
                    if !pname.is_empty() {
                        matched_net_profile = Some(pname);
                    }
                    let sec_enabled = net.bSecurityEnabled.as_bool();
                    let (auth_str, ent) =
                        classify_dot11_auth(net.dot11DefaultAuthAlgorithm.0, sec_enabled);
                    detected_auth = auth_str;
                    detected_cipher =
                        classify_dot11_cipher(net.dot11DefaultCipherAlgorithm.0, sec_enabled);
                    is_enterprise = ent;
                    break;
                }
            }
            WlanFreeMemory(net_list_ptr as *const c_void);
        }

        if is_enterprise && matched_net_profile.is_none() {
            let _ = WlanCloseHandle(client_handle, None);
            return Err(
                "Jaringan Enterprise (802.1X) harus dihubungkan lewat dialog jaringan Windows."
                    .to_string(),
            );
        }

        let mut stored_profile_match: Option<String> = None;
        let mut prof_list_ptr: *mut WLAN_PROFILE_INFO_LIST = std::ptr::null_mut();
        if WlanGetProfileList(client_handle, &iface_guid, None, &mut prof_list_ptr) == 0
            && !prof_list_ptr.is_null()
        {
            let pcount = (*prof_list_ptr).dwNumberOfItems as usize;
            let profs =
                std::slice::from_raw_parts((*prof_list_ptr).ProfileInfo.as_ptr(), pcount);
            for p in profs {
                let pname = wide_buf_to_string(&p.strProfileName);
                if pname == clean_ssid {
                    stored_profile_match = Some(pname);
                    break;
                }
                if stored_profile_match.is_none() && pname.eq_ignore_ascii_case(&clean_ssid) {
                    stored_profile_match = Some(pname);
                }
            }
            WlanFreeMemory(prof_list_ptr as *const c_void);
        }

        let had_existing_profile = matched_net_profile.is_some() || stored_profile_match.is_some();

        let save_wlan_profile = |mut profile_xml: String| -> Result<(), String> {
            let mut xml_wide: Vec<u16> = profile_xml
                .encode_utf16()
                .chain(std::iter::once(0))
                .collect();
            let mut reason_code = 0u32;
            let set_err = WlanSetProfile(
                client_handle,
                &iface_guid,
                WLAN_PROFILE_USER,
                PCWSTR(xml_wide.as_ptr()),
                None,
                true,
                None,
                &mut reason_code,
            );
            let res = if set_err != 0 {
                let set_err_global = WlanSetProfile(
                    client_handle,
                    &iface_guid,
                    0,
                    PCWSTR(xml_wide.as_ptr()),
                    None,
                    true,
                    None,
                    &mut reason_code,
                );
                if set_err_global != 0 {
                    Err(format!(
                        "Gagal menyimpan profil Wi-Fi (code={set_err_global}, reason={reason_code})"
                    ))
                } else {
                    Ok(())
                }
            } else {
                Ok(())
            };
            // Zero-fill secret XML buffers immediately before drop
            xml_wide.fill(0);
            profile_xml.as_bytes_mut().fill(0);
            res
        };

        let resolved_profile_name: String;
        let supplied_pwd = password.filter(|s| !s.is_empty());
        let mut created_new_profile = false;

        if let Some(pwd) = supplied_pwd {
            let mut pwd_buf = pwd.to_string();
            let primary_xml =
                build_wlan_profile_xml(&clean_ssid, detected_auth, detected_cipher, Some(&pwd_buf));
            let save_res = match primary_xml {
                Ok(xml) => match save_wlan_profile(xml) {
                    Ok(()) => Ok(()),
                    Err(first_err) if detected_auth == "WPA3" => {
                        // Fallback for WPA2/WPA3 transition APs or older Windows WLAN schemas
                        match build_wlan_profile_xml(&clean_ssid, "WPA2", "AES", Some(&pwd_buf)) {
                            Ok(fallback_xml) => save_wlan_profile(fallback_xml),
                            Err(_) => Err(first_err),
                        }
                    }
                    Err(err) => Err(err),
                },
                Err(err) => Err(err),
            };
            pwd_buf.as_bytes_mut().fill(0);
            if let Err(err) = save_res {
                let _ = WlanCloseHandle(client_handle, None);
                return Err(err);
            }
            created_new_profile = !had_existing_profile;
            resolved_profile_name = clean_ssid.clone();
        } else if let Some(existing) = matched_net_profile.or(stored_profile_match) {
            resolved_profile_name = existing;
        } else if detected_auth == "Open" {
            let open_xml = match build_wlan_profile_xml(&clean_ssid, "Open", "None", None) {
                Ok(xml) => xml,
                Err(err) => {
                    let _ = WlanCloseHandle(client_handle, None);
                    return Err(err);
                }
            };
            if let Err(err) = save_wlan_profile(open_xml) {
                let _ = WlanCloseHandle(client_handle, None);
                return Err(err);
            }
            created_new_profile = true;
            resolved_profile_name = clean_ssid.clone();
        } else {
            let _ = WlanCloseHandle(client_handle, None);
            return Err("Masukkan password Wi-Fi untuk menyambung ke jaringan ini.".to_string());
        }

        let profile_wide: Vec<u16> = resolved_profile_name
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let ssid_bytes = clean_ssid.as_bytes();
        let mut dot11_ssid = DOT11_SSID {
            uSSIDLength: ssid_bytes.len().min(32) as u32,
            ucSSID: [0u8; 32],
        };
        let copy_len = ssid_bytes.len().min(32);
        dot11_ssid.ucSSID[..copy_len].copy_from_slice(&ssid_bytes[..copy_len]);

        let params = WLAN_CONNECTION_PARAMETERS {
            wlanConnectionMode: wlan_connection_mode_profile,
            strProfile: PCWSTR(profile_wide.as_ptr()),
            pDot11Ssid: &mut dot11_ssid,
            pDesiredBssidList: std::ptr::null_mut(),
            dot11BssType: dot11_BSS_type_infrastructure,
            dwFlags: 0,
        };

        let conn_err = WlanConnect(client_handle, &iface_guid, &params, None);
        if conn_err != 0 {
            if created_new_profile {
                let _ = WlanDeleteProfile(
                    client_handle,
                    &iface_guid,
                    PCWSTR(profile_wide.as_ptr()),
                    None,
                );
            }
            let _ = WlanCloseHandle(client_handle, None);
            return Err(format!(
                "WlanConnect gagal (code={conn_err}). Pastikan profil tersimpan atau periksa password."
            ));
        }

        // For newly submitted passwords, wait up to ~6s to confirm real WLAN association/auth.
        // If authentication fails (wrong password), automatically delete the failed profile.
        if supplied_pwd.is_some() {
            let mut connected_ok = false;
            let mut saw_in_progress = false;
            for step in 0..20 {
                std::thread::sleep(Duration::from_millis(300));
                let mut q_size = 0u32;
                let mut q_ptr: *mut c_void = std::ptr::null_mut();
                if WlanQueryInterface(
                    client_handle,
                    &iface_guid,
                    wlan_intf_opcode_current_connection,
                    None,
                    &mut q_size,
                    &mut q_ptr,
                    None,
                ) == 0
                    && !q_ptr.is_null()
                {
                    let attrs = &*(q_ptr as *const WLAN_CONNECTION_ATTRIBUTES);
                    let state = attrs.isState;
                    let cur_ssid = decode_dot11_ssid(&attrs.wlanAssociationAttributes.dot11Ssid);
                    WlanFreeMemory(q_ptr);

                    if state == wlan_interface_state_connected
                        && cur_ssid.as_deref() == Some(clean_ssid.as_str())
                    {
                        connected_ok = true;
                        break;
                    }
                    if state == wlan_interface_state_associating
                        || state == wlan_interface_state_authenticating
                        || state == wlan_interface_state_discovering
                    {
                        saw_in_progress = true;
                    } else if state == wlan_interface_state_disconnected
                        && (saw_in_progress || step >= 6)
                    {
                        break;
                    }
                } else if saw_in_progress || step >= 8 {
                    break;
                }
            }

            if !connected_ok {
                if created_new_profile {
                    let _ = WlanDeleteProfile(
                        client_handle,
                        &iface_guid,
                        PCWSTR(profile_wide.as_ptr()),
                        None,
                    );
                }
                let _ = WlanCloseHandle(client_handle, None);
                return Err(
                    "Autentikasi Wi-Fi gagal atau password salah. Profil gagal dibersihkan; silakan coba lagi."
                        .to_string(),
                );
            }
        }

        let _ = WlanCloseHandle(client_handle, None);
        Ok(())
    }
}

// =========================================================================
// 8. Native Bluetooth Paired List & Connect/Disconnect
// =========================================================================
#[cfg(windows)]
pub fn list_paired_bluetooth_native() -> Result<Vec<BluetoothDeviceItem>, String> {
    use std::collections::HashMap;
    use windows::Devices::Bluetooth::{
        BluetoothConnectionStatus, BluetoothDevice, BluetoothLEDevice, BluetoothMajorClass,
    };
    use windows::Devices::Enumeration::DeviceInformation;

    let _com = crate::security_utils::ComGuard::init_mta();

    let mut by_addr: HashMap<String, BluetoothDeviceItem> = HashMap::new();

    // 1. Paired Classic Bluetooth devices
    if let Ok(selector) = BluetoothDevice::GetDeviceSelectorFromPairingState(true) {
        if let Ok(op) = DeviceInformation::FindAllAsyncAqsFilter(&selector) {
            if let Ok(infos) = op.join() {
                let count = infos.Size().unwrap_or(0);
                for i in 0..count {
                    if let Ok(info) = infos.GetAt(i) {
                        let id_hstr = match info.Id() {
                            Ok(id) => id,
                            Err(_) => continue,
                        };
                        let id = id_hstr.to_string_lossy();
                        let name = info
                            .Name()
                            .map(|s| s.to_string_lossy().trim().to_string())
                            .unwrap_or_default();
                        if name.is_empty() {
                            continue;
                        }

                        let mut is_connected = false;
                        let mut address = String::new();
                        let mut device_type = "device".to_string();

                        if let Ok(dev_op) = BluetoothDevice::FromIdAsync(&id_hstr) {
                            if let Ok(dev) = dev_op.join() {
                                is_connected = dev
                                    .ConnectionStatus()
                                    .map(|s| s == BluetoothConnectionStatus::Connected)
                                    .unwrap_or(false);
                                if let Ok(addr) = dev.BluetoothAddress() {
                                    address = format_bt_address(addr);
                                }
                                if let Ok(cod) = dev.ClassOfDevice() {
                                    device_type = match cod.MajorClass().ok() {
                                        Some(BluetoothMajorClass::AudioVideo) => "audio".to_string(),
                                        Some(BluetoothMajorClass::Peripheral) => {
                                            "peripheral".to_string()
                                        }
                                        Some(BluetoothMajorClass::Phone) => "phone".to_string(),
                                        Some(BluetoothMajorClass::Computer) => {
                                            "computer".to_string()
                                        }
                                        _ => "device".to_string(),
                                    };
                                }
                            }
                        }

                        let key = if address.is_empty() {
                            id.clone()
                        } else {
                            address.clone()
                        };

                        by_addr.insert(
                            key,
                            BluetoothDeviceItem {
                                id,
                                name: canonical_bt_name(&name),
                                address,
                                is_connected,
                                device_type,
                                battery_percent: None,
                            },
                        );
                    }
                }
            }
        }
    }

    // 2. Paired BLE devices (mice, keyboards, LE audio, wearables)
    if let Ok(selector) = BluetoothLEDevice::GetDeviceSelectorFromPairingState(true) {
        if let Ok(op) = DeviceInformation::FindAllAsyncAqsFilter(&selector) {
            if let Ok(infos) = op.join() {
                let count = infos.Size().unwrap_or(0);
                for i in 0..count {
                    if let Ok(info) = infos.GetAt(i) {
                        let id_hstr = match info.Id() {
                            Ok(id) => id,
                            Err(_) => continue,
                        };
                        let id = id_hstr.to_string_lossy();
                        let name = info
                            .Name()
                            .map(|s| s.to_string_lossy().trim().to_string())
                            .unwrap_or_default();
                        if name.is_empty() {
                            continue;
                        }

                        let mut is_connected = false;
                        let mut address = String::new();
                        if let Ok(dev_op) = BluetoothLEDevice::FromIdAsync(&id_hstr) {
                            if let Ok(dev) = dev_op.join() {
                                is_connected = dev
                                    .ConnectionStatus()
                                    .map(|s| s == BluetoothConnectionStatus::Connected)
                                    .unwrap_or(false);
                                if let Ok(addr) = dev.BluetoothAddress() {
                                    address = format_bt_address(addr);
                                }
                            }
                        }

                        let key = if address.is_empty() {
                            id.clone()
                        } else {
                            address.clone()
                        };

                        by_addr
                            .entry(key)
                            .and_modify(|existing| {
                                existing.is_connected = existing.is_connected || is_connected;
                            })
                            .or_insert(BluetoothDeviceItem {
                                id,
                                name: canonical_bt_name(&name),
                                address,
                                is_connected,
                                device_type: "ble".to_string(),
                                battery_percent: None,
                            });
                    }
                }
            }
        }
    }

    // 3. Enrich with Win32 PnP DEVPKEY_Device_IsConnected + DEVPKEY_Bluetooth_Battery
    let pnp_connected = scan_connected_bluetooth_pnp_native();
    for pnp in pnp_connected {
        let pnp_canon = canonical_bt_name(&pnp.name).to_lowercase();
        let matched = by_addr.values_mut().find(|item| {
            (!pnp.address.is_empty() && item.address.eq_ignore_ascii_case(&pnp.address))
                || (!pnp_canon.is_empty()
                    && canonical_bt_name(&item.name).to_lowercase() == pnp_canon)
        });
        if let Some(item) = matched {
            item.is_connected = true;
            if item.battery_percent.is_none() {
                item.battery_percent = pnp.battery_percent;
            }
            if item.address.is_empty() && !pnp.address.is_empty() {
                item.address = pnp.address;
            }
        } else {
            let key = if pnp.address.is_empty() {
                format!("pnp:{pnp_canon}")
            } else {
                pnp.address.clone()
            };
            by_addr.insert(
                key,
                BluetoothDeviceItem {
                    id: format!("pnp:{}", pnp.name),
                    name: pnp.name,
                    address: pnp.address,
                    is_connected: true,
                    device_type: "device".to_string(),
                    battery_percent: pnp.battery_percent,
                },
            );
        }
    }

    let mut list: Vec<BluetoothDeviceItem> = by_addr.into_values().collect();
    list.sort_by(|a, b| {
        b.is_connected
            .cmp(&a.is_connected)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(list)
}

#[cfg(windows)]
pub fn toggle_bluetooth_device_native(address: &str, connect: bool) -> Result<bool, String> {
    use windows::core::{BOOL, GUID};
    use windows::Win32::Devices::Bluetooth::{
        BluetoothEnumerateInstalledServices, BluetoothFindDeviceClose, BluetoothFindFirstDevice,
        BluetoothFindFirstRadio, BluetoothFindNextDevice, BluetoothFindNextRadio,
        BluetoothFindRadioClose, BluetoothSetServiceState, BLUETOOTH_DEVICE_INFO,
        BLUETOOTH_DEVICE_SEARCH_PARAMS, BLUETOOTH_FIND_RADIO_PARAMS, BLUETOOTH_SERVICE_DISABLE,
        BLUETOOTH_SERVICE_ENABLE,
    };
    use windows::Win32::Foundation::{CloseHandle, HANDLE};

    let clean_addr = address.trim().replace(':', "").replace('-', "");
    let target_addr = u64::from_str_radix(&clean_addr, 16)
        .map_err(|_| "Alamat Bluetooth tidak valid.".to_string())?;

    // Standard Classic Bluetooth profile UUIDs (Audio Sink, Handsfree, Headset, A2DP, AVRCP, HID)
    const FALLBACK_SERVICES: [GUID; 7] = [
        GUID::from_u128(0x0000110B_0000_1000_8000_00805F9B34FB), // AudioSink (A2DP)
        GUID::from_u128(0x0000111E_0000_1000_8000_00805F9B34FB), // Handsfree (HFP)
        GUID::from_u128(0x00001108_0000_1000_8000_00805F9B34FB), // Headset (HSP)
        GUID::from_u128(0x0000110D_0000_1000_8000_00805F9B34FB), // Advanced Audio Dist
        GUID::from_u128(0x0000110C_0000_1000_8000_00805F9B34FB), // AVRCP Target
        GUID::from_u128(0x0000110E_0000_1000_8000_00805F9B34FB), // AVRCP Controller
        GUID::from_u128(0x00001124_0000_1000_8000_00805F9B34FB), // HID
    ];

    unsafe {
        // Collect local Bluetooth radio handles so service state calls bind reliably across drivers
        let mut radio_handles: Vec<HANDLE> = Vec::new();
        let radio_params = BLUETOOTH_FIND_RADIO_PARAMS {
            dwSize: std::mem::size_of::<BLUETOOTH_FIND_RADIO_PARAMS>() as u32,
        };
        let mut first_radio = HANDLE::default();
        if let Ok(radio_find) = BluetoothFindFirstRadio(&radio_params, &mut first_radio) {
            if !first_radio.is_invalid() {
                radio_handles.push(first_radio);
            }
            loop {
                let mut next_radio = HANDLE::default();
                if BluetoothFindNextRadio(radio_find, &mut next_radio).is_err() {
                    break;
                }
                if !next_radio.is_invalid() {
                    radio_handles.push(next_radio);
                }
            }
            let _ = BluetoothFindRadioClose(radio_find);
        }

        let close_radios = |handles: &[HANDLE]| {
            for &h in handles {
                let _ = CloseHandle(h);
            }
        };

        let params = BLUETOOTH_DEVICE_SEARCH_PARAMS {
            dwSize: std::mem::size_of::<BLUETOOTH_DEVICE_SEARCH_PARAMS>() as u32,
            fReturnAuthenticated: BOOL(1),
            fReturnRemembered: BOOL(1),
            fReturnUnknown: BOOL(0),
            fReturnConnected: BOOL(1),
            fIssueInquiry: BOOL(0),
            cTimeoutMultiplier: 0,
            hRadio: radio_handles.first().copied().unwrap_or_default(),
        };

        let mut dev_info = BLUETOOTH_DEVICE_INFO {
            dwSize: std::mem::size_of::<BLUETOOTH_DEVICE_INFO>() as u32,
            ..Default::default()
        };

        let mut matched: Option<BLUETOOTH_DEVICE_INFO> = None;
        if let Ok(find_handle) = BluetoothFindFirstDevice(&params, &mut dev_info) {
            loop {
                if dev_info.Address.Anonymous.ullLong == target_addr {
                    matched = Some(dev_info);
                    break;
                }
                if BluetoothFindNextDevice(find_handle, &mut dev_info).is_err() {
                    break;
                }
            }
            let _ = BluetoothFindDeviceClose(find_handle);
        } else if !params.hRadio.is_invalid() {
            // Fallback search with NULL radio handle if specific radio handle rejected enumeration
            let mut null_params = params;
            null_params.hRadio = HANDLE::default();
            if let Ok(find_handle) = BluetoothFindFirstDevice(&null_params, &mut dev_info) {
                loop {
                    if dev_info.Address.Anonymous.ullLong == target_addr {
                        matched = Some(dev_info);
                        break;
                    }
                    if BluetoothFindNextDevice(find_handle, &mut dev_info).is_err() {
                        break;
                    }
                }
                let _ = BluetoothFindDeviceClose(find_handle);
            }
        }

        let Some(info) = matched else {
            close_radios(&radio_handles);
            return Err(
                "Perangkat tidak merespons Classic Bluetooth RPC (BLE-only / di luar jangkauan)."
                    .to_string(),
            );
        };

        let flag = if connect {
            BLUETOOTH_SERVICE_ENABLE
        } else {
            BLUETOOTH_SERVICE_DISABLE
        };

        let mut radio_candidates: Vec<Option<HANDLE>> =
            radio_handles.iter().copied().map(Some).collect();
        radio_candidates.push(None);

        let mut any_ok = false;
        let mut last_err = 0u32;

        for radio_opt in radio_candidates {
            let mut service_count = 32u32;
            let mut installed = vec![GUID::zeroed(); service_count as usize];
            let enum_res = BluetoothEnumerateInstalledServices(
                radio_opt,
                &info,
                &mut service_count,
                Some(installed.as_mut_ptr()),
            );

            if enum_res == 0 && service_count > 0 {
                let count = (service_count as usize).min(installed.len());
                for guid in &installed[..count] {
                    let res = BluetoothSetServiceState(radio_opt, &info, guid, flag);
                    if res == 0 {
                        any_ok = true;
                    } else {
                        last_err = res;
                    }
                }
            }

            if !any_ok {
                for guid in &FALLBACK_SERVICES {
                    let res = BluetoothSetServiceState(radio_opt, &info, guid, flag);
                    if res == 0 {
                        any_ok = true;
                    } else {
                        last_err = res;
                    }
                }
            }

            if any_ok {
                break;
            }
        }

        close_radios(&radio_handles);

        if any_ok || info.fConnected.as_bool() == connect {
            Ok(connect)
        } else {
            Err(format!(
                "Windows menolak toggle service Bluetooth (code={last_err}). Pastikan perangkat menyala/dalam jangkauan."
            ))
        }
    }
}

#[tauri::command]
pub async fn scan_wifi_networks() -> Result<Vec<WifiNetworkItem>, String> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(scan_wifi_networks_native)
            .await
            .map_err(|e| format!("Wi-Fi scan join error: {e}"))?
    }
    #[cfg(not(windows))]
    {
        Ok(Vec::new())
    }
}

#[tauri::command]
pub async fn connect_wifi_network(
    app: AppHandle,
    ssid: String,
    password: Option<String>,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        let app_clone = app.clone();
        tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
            connect_wifi_network_native(&ssid, password.as_deref())?;
            std::thread::sleep(Duration::from_millis(250));
            let _ = sync_radio_cache_and_emit(&app_clone);

            let bg_app = app_clone.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(1300));
                let _ = sync_radio_cache_and_emit(&bg_app);
                std::thread::sleep(Duration::from_millis(1800));
                let _ = sync_radio_cache_and_emit(&bg_app);
            });
            Ok(())
        })
        .await
        .map_err(|e| format!("Wi-Fi connect join error: {e}"))?
    }
    #[cfg(not(windows))]
    {
        let _ = (app, ssid, password);
        Ok(())
    }
}

#[cfg(windows)]
fn shell_open_pinned_target(target: &str) -> Result<(), String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let wide_open: Vec<u16> = OsStr::new("open")
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let wide_target: Vec<u16> = OsStr::new(target)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    unsafe {
        let res = ShellExecuteW(
            std::ptr::null_mut(),
            wide_open.as_ptr(),
            wide_target.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL as i32,
        );
        if (res as usize) <= 32 {
            return Err(format!("ShellExecuteW gagal membuka target (code={})", res as usize));
        }
    }
    Ok(())
}

/// Membuka halaman login Captive Portal lewat konstanta URL resmi Microsoft via `ShellExecuteW` in-process.
#[tauri::command]
pub fn open_captive_portal_browser() -> Result<(), String> {
    const CAPTIVE_PORTAL_REDIRECT_URL: &str = "http://www.msftconnecttest.com/redirect";
    #[cfg(windows)]
    {
        shell_open_pinned_target(CAPTIVE_PORTAL_REDIRECT_URL)
    }
    #[cfg(not(windows))]
    {
        let _ = CAPTIVE_PORTAL_REDIRECT_URL;
        Ok(())
    }
}

/// Membuka flyout daftar jaringan Windows (`ms-availablenetworks:`) untuk jaringan Enterprise 802.1X.
#[tauri::command]
pub fn open_available_wifi_networks() -> Result<(), String> {
    const AVAILABLE_NETWORKS_URI: &str = "ms-availablenetworks:";
    #[cfg(windows)]
    {
        shell_open_pinned_target(AVAILABLE_NETWORKS_URI)
    }
    #[cfg(not(windows))]
    {
        let _ = AVAILABLE_NETWORKS_URI;
        Ok(())
    }
}

const CORE_FX_CURRENCIES: [&str; 6] = ["USD", "IDR", "SGD", "JPY", "KRW", "EUR"];
const MAX_FX_RESPONSE_BYTES: usize = 256 * 1024;
const MAX_FX_CURRENCIES: usize = 250;

pub fn sanitize_exchange_rate_map(
    raw_rates: &serde_json::Map<String, serde_json::Value>,
) -> Result<std::collections::HashMap<String, f64>, String> {
    let mut clean = std::collections::HashMap::new();
    clean.insert("USD".to_string(), 1.0);
    for code in CORE_FX_CURRENCIES {
        if code == "USD" {
            continue;
        }
        let val = raw_rates
            .get(code)
            .and_then(|v| v.as_f64())
            .filter(|v| v.is_finite() && *v > 0.0 && *v < 1_000_000_000.0)
            .ok_or_else(|| format!("Kurs mata uang {code} tidak valid atau hilang."))?;
        clean.insert(code.to_string(), val);
    }

    for (code, raw_val) in raw_rates {
        if clean.len() >= MAX_FX_CURRENCIES {
            break;
        }
        if code == "USD"
            || code.len() != 3
            || !code.bytes().all(|b| b.is_ascii_uppercase())
        {
            continue;
        }
        if let Some(val) = raw_val
            .as_f64()
            .filter(|v| v.is_finite() && *v > 0.0 && *v < 1_000_000_000.0)
        {
            clean.entry(code.clone()).or_insert(val);
        }
    }

    Ok(clean)
}

/// Proxy Rust on-demand untuk menyegarkan kurs mata uang (USD base, 150+ mata uang dunia) tanpa melonggarkan CSP WebView.
#[tauri::command]
pub async fn fetch_exchange_rates() -> Result<ExchangeRatesResponse, String> {
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(false)
        .connect_timeout(Duration::from_secs(4))
        .timeout(Duration::from_secs(8))
        .user_agent("CASA-Desktop/2.3.2")
        .build()
        .map_err(|e| format!("Gagal membuat HTTP client kurs: {e}"))?;

    let endpoints = [
        ("https://open.er-api.com/v6/latest/USD", "open.er-api.com"),
        (
            "https://api.exchangerate-api.com/v4/latest/USD",
            "api.exchangerate-api.com",
        ),
        (
            "https://api.frankfurter.app/latest?from=USD",
            "api.frankfurter.app",
        ),
    ];

    let mut last_err = "Gagal mengambil kurs mata uang.".to_string();
    for (url, source_label) in endpoints {
        let resp = match client.get(url).send().await {
            Ok(r) => r,
            Err(e) => {
                last_err = format!("Koneksi ke {source_label} gagal: {e}");
                continue;
            }
        };
        if !resp.status().is_success() {
            last_err = format!("{source_label} mengembalikan HTTP {}", resp.status());
            continue;
        }
        if let Some(cl) = resp.content_length() {
            if cl > MAX_FX_RESPONSE_BYTES as u64 {
                last_err = format!("Respons {source_label} melebihi batas ukuran.");
                continue;
            }
        }
        let bytes = match resp.bytes().await {
            Ok(b) if b.len() <= MAX_FX_RESPONSE_BYTES => b,
            Ok(_) => {
                last_err = format!("Respons {source_label} melebihi 256 KiB.");
                continue;
            }
            Err(e) => {
                last_err = format!("Gagal membaca respons {source_label}: {e}");
                continue;
            }
        };
        let parsed: serde_json::Value = match serde_json::from_slice(&bytes) {
            Ok(v) => v,
            Err(e) => {
                last_err = format!("JSON {source_label} tidak valid: {e}");
                continue;
            }
        };
        let Some(rates_obj) = parsed.get("rates").and_then(|v| v.as_object()) else {
            last_err = format!("Field rates tidak ditemukan di {source_label}.");
            continue;
        };
        match sanitize_exchange_rate_map(rates_obj) {
            Ok(rates) => {
                let updated_at = chrono::Utc::now().to_rfc3339();
                return Ok(ExchangeRatesResponse {
                    base: "USD".to_string(),
                    rates,
                    updated_at,
                    source: source_label.to_string(),
                });
            }
            Err(e) => {
                last_err = e;
            }
        }
    }

    Err(last_err)
}

#[tauri::command]
pub async fn list_paired_bluetooth() -> Result<Vec<BluetoothDeviceItem>, String> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(list_paired_bluetooth_native)
            .await
            .map_err(|e| format!("Bluetooth list join error: {e}"))?
    }
    #[cfg(not(windows))]
    {
        Ok(Vec::new())
    }
}

#[tauri::command]
pub async fn toggle_bluetooth_device(
    app: AppHandle,
    address: String,
    connect: bool,
) -> Result<bool, String> {
    #[cfg(windows)]
    {
        let app_clone = app.clone();
        tauri::async_runtime::spawn_blocking(move || -> Result<bool, String> {
            let res = toggle_bluetooth_device_native(&address, connect)?;
            std::thread::sleep(Duration::from_millis(250));
            let _ = sync_radio_cache_and_emit(&app_clone);

            let bg_app = app_clone.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(1100));
                let _ = sync_radio_cache_and_emit(&bg_app);
                std::thread::sleep(Duration::from_millis(1800));
                let _ = sync_radio_cache_and_emit(&bg_app);
            });
            Ok(res)
        })
        .await
        .map_err(|e| format!("Bluetooth toggle join error: {e}"))?
    }
    #[cfg(not(windows))]
    {
        let _ = (app, address);
        Ok(connect)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_audio_and_bt_classification() {
        assert_eq!(canonical_bt_name("soundcore R50i Hands-Free AG Audio"), "soundcore R50i");
        assert_eq!(canonical_bt_name("WH-1000XM5 Avrcp Transport"), "WH-1000XM5");
        assert_eq!(canonical_bt_name("AirPods Pro Stereo"), "AirPods Pro");

        let connected_bt = vec![ConnectedBluetoothDevice {
            name: "Sony WH-1000XM5".to_string(),
            address: "AA:BB:CC:DD:EE:FF".to_string(),
            battery_percent: Some(85),
        }];

        // Enumerator BTH + battery lookup
        let (kind_bt, dev_type_bt, batt_bt) = classify_audio_output(
            "Headphones (Sony WH-1000XM5 Stereo)",
            "BTHENUM",
            3,
            &connected_bt,
        );
        assert_eq!(kind_bt, AudioOutputKind::Bluetooth);
        assert_eq!(dev_type_bt, AudioDeviceType::HeadphoneBluetooth);
        assert_eq!(batt_bt, Some(85));

        // Wired Headphones via FormFactor=3 and HDAUDIO enumerator
        let (kind_wired, dev_type_wired, batt_wired) = classify_audio_output(
            "Headphones (Realtek(R) Audio)",
            "HDAUDIO",
            3,
            &connected_bt,
        );
        assert_eq!(kind_wired, AudioOutputKind::Wired);
        assert_eq!(dev_type_wired, AudioDeviceType::HeadphoneWired);
        assert_eq!(batt_wired, None);

        // Speakers via FormFactor=1
        let (kind_spk, dev_type_spk, batt_spk) = classify_audio_output(
            "Speakers (Realtek(R) Audio)",
            "HDAUDIO",
            1,
            &connected_bt,
        );
        assert_eq!(kind_spk, AudioOutputKind::Speaker);
        assert_eq!(dev_type_spk, AudioDeviceType::Speaker);
        assert_eq!(batt_spk, None);

        // Should never panic even with 0 devices or unsupported hardware
        let pnp_devices = scan_connected_bluetooth_pnp_native();
        println!("PnP connected BT count: {}", pnp_devices.len());
    }

    #[test]
    fn test_hardware_telemetry_reads() {
        println!("Testing read_power_status...");
        let power = read_power_status();
        println!("Power: {:?}", power);

        println!("Testing read_caps_lock_status...");
        let caps = read_caps_lock_status();
        println!("Caps Lock: {}", caps);

        println!("Testing read_audio_endpoint_status...");
        let audio = read_audio_endpoint_status();
        println!(
            "Audio: dev={}, kind={:?}, batt={:?}, vol={}, muted={}",
            audio.audio_device_name,
            audio.audio_output_kind,
            audio.audio_output_battery,
            audio.master_volume,
            audio.is_muted
        );

        println!("Testing read_display_brightness_wmi...");
        let bright = read_display_brightness_wmi();
        println!("Brightness: {:?}", bright);

        println!("Testing enumerate_audio_output_devices...");
        if let Ok(devices) = enumerate_audio_output_devices() {
            println!("Devices found: {}", devices.len());
            for d in &devices {
                println!(
                    "  -> [{}] {} (kind={:?}, batt={:?}, default={})",
                    d.id, d.name, d.output_kind, d.battery_percent, d.is_default
                );
            }
        }
    }

    #[test]
    fn validates_wifi_ssid_passphrase_xml_and_auth_mapping() {
        assert_eq!(classify_dot11_auth(1, true), ("Open", false));
        assert_eq!(classify_dot11_auth(11, true), ("Open", false));
        assert_eq!(classify_dot11_auth(7, true), ("WPA2", false));
        assert_eq!(classify_dot11_auth(9, true), ("WPA3", false));
        assert_eq!(classify_dot11_auth(4, true), ("WPA", false));
        assert_eq!(classify_dot11_auth(6, true), ("Enterprise", true));
        assert_eq!(classify_dot11_auth(10, true), ("Enterprise", true));
        assert_eq!(classify_dot11_cipher(0x04, true), "AES");
        assert_eq!(classify_dot11_cipher(0x02, true), "TKIP");
        assert_eq!(classify_dot11_cipher(0x08, true), "GCMP");
        assert_eq!(classify_dot11_cipher(0x04, false), "None");

        assert!(validate_wifi_ssid("Office_5G").is_ok());
        assert!(validate_wifi_ssid("").is_err());
        assert!(validate_wifi_ssid(&"a".repeat(33)).is_err());
        assert!(validate_wifi_ssid("Bad\nSSID").is_err());
        assert!(validate_wifi_ssid("Bad\0SSID").is_err());

        assert_eq!(validate_wifi_passphrase("correct-horse-123"), Ok(false));
        assert_eq!(validate_wifi_passphrase(&"a".repeat(64)), Ok(true));
        assert!(validate_wifi_passphrase("short77").is_err());
        assert!(validate_wifi_passphrase(&"x".repeat(64)).is_err());
        assert!(validate_wifi_passphrase("bad\npassphrase").is_err());

        // XML injection escape on SSID & passphrase
        let xml = build_wlan_profile_xml(
            "Cafe<A&B>",
            "WPA3",
            "AES",
            Some("P@ss<1>&\"2'3"),
        )
        .expect("valid WPA3 XML");
        assert!(xml.contains("<name>Cafe&lt;A&amp;B&gt;</name>"));
        assert!(xml.contains("<authentication>WPA3SAE</authentication>"));
        assert!(xml.contains("<encryption>AES</encryption>"));
        assert!(xml.contains("<keyMaterial>P@ss&lt;1&gt;&amp;&quot;2&apos;3</keyMaterial>"));
        assert!(!xml.contains("Cafe<A&B>"));

        // Enterprise must be rejected from single-passphrase XML builder
        assert!(build_wlan_profile_xml("CorpNet", "Enterprise", "AES", Some("12345678")).is_err());

        // Open profile XML
        let open_xml = build_wlan_profile_xml("PublicWiFi", "Open", "None", None).unwrap();
        assert!(open_xml.contains("<authentication>open</authentication>"));
        assert!(open_xml.contains("<encryption>none</encryption>"));

        // FX rate sanitization preserves valid 150+ world currencies, rejects non-finite / negative core currencies & invalid keys
        let good_json: serde_json::Value = serde_json::json!({
            "IDR": 16250.5,
            "SGD": 1.34,
            "JPY": 154.2,
            "KRW": 1390.0,
            "EUR": 0.92,
            "SAR": 3.75,
            "MYR": 4.45,
            "GBP": 0.79,
            "bad": 1.23,
            "123": 4.56,
            "<script>": 9.9,
            "ZZZ": -1.0
        });
        let sanitized = sanitize_exchange_rate_map(good_json.as_object().unwrap()).unwrap();
        assert_eq!(sanitized.get("USD"), Some(&1.0));
        assert_eq!(sanitized.get("IDR"), Some(&16250.5));
        assert_eq!(sanitized.get("SAR"), Some(&3.75));
        assert_eq!(sanitized.get("MYR"), Some(&4.45));
        assert_eq!(sanitized.get("GBP"), Some(&0.79));
        assert!(!sanitized.contains_key("bad"));
        assert!(!sanitized.contains_key("123"));
        assert!(!sanitized.contains_key("<script>"));
        assert!(!sanitized.contains_key("ZZZ"));

        let bad_json: serde_json::Value = serde_json::json!({
            "IDR": -100.0,
            "SGD": 1.34,
            "JPY": 154.2,
            "KRW": 1390.0,
            "EUR": 0.92
        });
        assert!(sanitize_exchange_rate_map(bad_json.as_object().unwrap()).is_err());
    }
}
