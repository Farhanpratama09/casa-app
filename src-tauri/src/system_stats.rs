use serde::Serialize;
use std::sync::Mutex;
use sysinfo::{CpuRefreshKind, MemoryRefreshKind, RefreshKind, System};

#[derive(Debug, Clone, Serialize)]
pub struct BatteryTelemetry {
    pub has_battery: bool,
    pub percent: u8,
    pub is_plugged_in: bool,
    pub is_charging: bool,
    /// One of: "charging" | "plugged_in" | "low" | "normal"
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SystemStatsTelemetry {
    pub cpu_usage_percent: f32,
    pub ram_used_gb: f64,
    pub ram_total_gb: f64,
    pub ram_percent: f32,
    pub battery: BatteryTelemetry,
}

pub struct SystemStatsState {
    sys: Mutex<System>,
}

impl SystemStatsState {
    pub fn new() -> Self {
        let mut sys = System::new_with_specifics(
            RefreshKind::nothing()
                .with_cpu(CpuRefreshKind::everything())
                .with_memory(MemoryRefreshKind::everything()),
        );
        // Capture initial baseline CPU ticks so the first frontend poll already has a meaningful delta
        sys.refresh_cpu_usage();
        sys.refresh_memory();
        Self {
            sys: Mutex::new(sys),
        }
    }
}

#[cfg(windows)]
fn read_battery_telemetry() -> BatteryTelemetry {
    use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};

    let mut sps = SYSTEM_POWER_STATUS::default();
    let ok = unsafe { GetSystemPowerStatus(&mut sps).is_ok() };
    if !ok {
        return BatteryTelemetry {
            has_battery: false,
            percent: 100,
            is_plugged_in: true,
            is_charging: false,
            status: "normal".to_string(),
        };
    }

    // Win32: BatteryFlag 128 = No system battery; BatteryLifePercent 255 = Unknown
    let has_battery = sps.BatteryFlag != 128 && sps.BatteryLifePercent != 255;
    let percent = if has_battery {
        sps.BatteryLifePercent.min(100)
    } else {
        100
    };
    let is_plugged_in = sps.ACLineStatus == 1;
    // Bit 3 (8) indicates active charging current
    let is_charging_flag = (sps.BatteryFlag & 8) != 0;
    let is_charging = has_battery && is_plugged_in && is_charging_flag;

    let status = if !has_battery {
        "normal".to_string()
    } else if is_charging {
        "charging".to_string()
    } else if is_plugged_in {
        "plugged_in".to_string()
    } else if percent <= 20 {
        "low".to_string()
    } else {
        "normal".to_string()
    };

    BatteryTelemetry {
        has_battery,
        percent,
        is_plugged_in,
        is_charging,
        status,
    }
}

#[cfg(not(windows))]
fn read_battery_telemetry() -> BatteryTelemetry {
    BatteryTelemetry {
        has_battery: false,
        percent: 100,
        is_plugged_in: true,
        is_charging: false,
        status: "normal".to_string(),
    }
}

#[tauri::command]
pub fn get_system_telemetry(
    state: tauri::State<'_, SystemStatsState>,
) -> Result<SystemStatsTelemetry, String> {
    let (cpu_usage_percent, ram_used_gb, ram_total_gb, ram_percent) = {
        let mut sys = state
            .sys
            .lock()
            .map_err(|e| format!("SystemStatsState mutex poisoned: {e}"))?;
        sys.refresh_cpu_usage();
        sys.refresh_memory();

        let raw_cpu = sys.global_cpu_usage().clamp(0.0, 100.0);
        let cpu_rounded = (raw_cpu * 10.0).round() / 10.0;

        const BYTES_PER_GB: f64 = 1_073_741_824.0;
        let total_bytes = sys.total_memory() as f64;
        let used_bytes = sys.used_memory() as f64;

        let total_gb = ((total_bytes / BYTES_PER_GB) * 10.0).round() / 10.0;
        let used_gb = ((used_bytes / BYTES_PER_GB) * 10.0).round() / 10.0;
        let ram_pct = if total_bytes > 0.0 {
            let pct = ((used_bytes / total_bytes) * 100.0).clamp(0.0, 100.0) as f32;
            (pct * 10.0).round() / 10.0
        } else {
            0.0
        };

        (cpu_rounded, used_gb, total_gb, ram_pct)
    };

    let battery = read_battery_telemetry();

    Ok(SystemStatsTelemetry {
        cpu_usage_percent,
        ram_used_gb,
        ram_total_gb,
        ram_percent,
        battery,
    })
}
