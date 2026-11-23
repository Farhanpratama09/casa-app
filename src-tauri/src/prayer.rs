use chrono::{DateTime, Duration as ChronoDuration, Local, NaiveDate, Timelike, Utc};
use salah::prelude::*;
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PrayerOffsets {
    #[serde(default)]
    pub fajr: i32,
    #[serde(default)]
    pub dhuhr: i32,
    #[serde(default)]
    pub asr: i32,
    #[serde(default)]
    pub maghrib: i32,
    #[serde(default)]
    pub isha: i32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrayerScheduleRequest {
    pub latitude: f64,
    pub longitude: f64,
    #[serde(default)]
    pub country_code: Option<String>,
    #[serde(default = "default_method_str")]
    pub method: String,
    #[serde(default = "default_madhab_str")]
    pub madhab: String,
    #[serde(default)]
    pub offsets: PrayerOffsets,
}

fn default_method_str() -> String {
    "auto".to_string()
}

fn default_madhab_str() -> String {
    "shafi".to_string()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrayerEntry {
    pub id: String,
    pub label: String,
    pub timestamp_ms: i64,
    pub time_label: String,
    pub is_passed: bool,
    pub is_next: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrayerScheduleResponse {
    pub date_key: String,
    pub timezone_label: String,
    pub resolved_method: String,
    pub resolved_method_label: String,
    pub madhab_label: String,
    pub prayers: Vec<PrayerEntry>,
    pub next_prayer_id: String,
    pub next_prayer_label: String,
    pub next_prayer_timestamp_ms: i64,
    pub next_prayer_time_label: String,
    pub next_prayer_date_key: String,
    pub next_prayer_is_tomorrow: bool,
    pub most_recent_prayer_id: String,
    pub most_recent_prayer_label: String,
    pub most_recent_prayer_timestamp_ms: i64,
    pub most_recent_prayer_date_key: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedLocationResult {
    pub status: String,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub city: Option<String>,
    pub region: Option<String>,
    pub country_code: Option<String>,
    pub accuracy_meters: Option<f64>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CitySearchItem {
    pub name: String,
    pub region: Option<String>,
    pub country: String,
    pub country_code: String,
    pub latitude: f64,
    pub longitude: f64,
}

fn resolve_method(method_key: &str, country_code: Option<&str>) -> (&'static str, &'static str, Method) {
    let normalized = method_key.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "kemenag" => ("kemenag", "Kemenag RI", Method::Singapore),
        "jakim" => ("jakim", "JAKIM Malaysia", Method::Singapore),
        "muis" => ("muis", "MUIS Singapura", Method::Singapore),
        "umm_al_qura" => ("umm_al_qura", "Umm al-Qura", Method::UmmAlQura),
        "mwl" => ("mwl", "MWL", Method::MuslimWorldLeague),
        "isna" => ("isna", "ISNA", Method::NorthAmerica),
        "egyptian" => ("egyptian", "Egyptian", Method::Egyptian),
        "karachi" => ("karachi", "Karachi", Method::Karachi),
        _ => {
            let cc = country_code
                .unwrap_or("")
                .trim()
                .to_ascii_uppercase();
            match cc.as_str() {
                "ID" => ("kemenag", "Kemenag RI", Method::Singapore),
                "MY" => ("jakim", "JAKIM Malaysia", Method::Singapore),
                "SG" | "BN" => ("muis", "MUIS Singapura", Method::Singapore),
                "SA" | "AE" | "QA" | "KW" | "BH" | "OM" => {
                    ("umm_al_qura", "Umm al-Qura", Method::UmmAlQura)
                }
                "US" | "CA" => ("isna", "ISNA", Method::NorthAmerica),
                "EG" | "LY" | "SD" => ("egyptian", "Egyptian", Method::Egyptian),
                "PK" | "IN" | "BD" | "AF" => ("karachi", "Karachi", Method::Karachi),
                _ => ("mwl", "MWL", Method::MuslimWorldLeague),
            }
        }
    }
}

fn resolve_madhab(madhab_key: &str) -> (&'static str, Madhab) {
    if madhab_key.trim().eq_ignore_ascii_case("hanafi") {
        ("Hanafi", Madhab::Hanafi)
    } else {
        ("Syafi'i", Madhab::Shafi)
    }
}

fn clamp_offset_minutes(val: i32) -> i64 {
    val.clamp(-60, 60) as i64
}

fn compute_day_times(
    date: NaiveDate,
    coords: Coordinates,
    params: Parameters,
    offsets: &PrayerOffsets,
) -> Result<[(String, String, DateTime<Local>); 5], String> {
    let times = PrayerSchedule::new()
        .on(date)
        .for_location(coords)
        .with_configuration(params)
        .calculate()
        .map_err(|e| format!("Gagal menghitung jadwal sholat untuk {date}: {e:?}"))?;

    let apply = |dt_utc: DateTime<Utc>, offset_min: i32| -> DateTime<Local> {
        let local_base = dt_utc.with_timezone(&Local);
        // Align trigger timestamp with displayed HH:MM (:00 seconds) so minute-offset tests
        // and T-0 notifications fire cleanly on the exact displayed minute mark.
        let minute_aligned = local_base
            .with_second(0)
            .and_then(|d| d.with_nanosecond(0))
            .unwrap_or(local_base);
        minute_aligned + ChronoDuration::minutes(clamp_offset_minutes(offset_min))
    };

    Ok([
        ("fajr".to_string(), "Subuh".to_string(), apply(times.time(Prayer::Fajr), offsets.fajr)),
        ("dhuhr".to_string(), "Dzuhur".to_string(), apply(times.time(Prayer::Dhuhr), offsets.dhuhr)),
        ("asr".to_string(), "Ashar".to_string(), apply(times.time(Prayer::Asr), offsets.asr)),
        ("maghrib".to_string(), "Maghrib".to_string(), apply(times.time(Prayer::Maghrib), offsets.maghrib)),
        ("isha".to_string(), "Isya".to_string(), apply(times.time(Prayer::Isha), offsets.isha)),
    ])
}

/// Offline prayer time calculation using `salah` + active Windows local timezone (`chrono::Local`).
#[tauri::command]
pub fn get_prayer_times(request: PrayerScheduleRequest) -> Result<PrayerScheduleResponse, String> {
    if !request.latitude.is_finite()
        || !request.longitude.is_finite()
        || request.latitude < -90.0
        || request.latitude > 90.0
        || request.longitude < -180.0
        || request.longitude > 180.0
    {
        return Err("Koordinat lintang/bujur tidak valid.".to_string());
    }

    let (resolved_method, resolved_method_label, method_enum) =
        resolve_method(&request.method, request.country_code.as_deref());
    let (madhab_label, madhab_enum) = resolve_madhab(&request.madhab);

    let coords = Coordinates::new(request.latitude, request.longitude);
    let params = Configuration::with(method_enum, madhab_enum);

    let now_local = Local::now();
    let now_ms = now_local.timestamp_millis();
    let today_date = now_local.date_naive();
    let tomorrow_date = today_date
        .succ_opt()
        .ok_or_else(|| "Gagal menghitung tanggal berikutnya.".to_string())?;
    let yesterday_date = today_date
        .pred_opt()
        .ok_or_else(|| "Gagal menghitung tanggal sebelumnya.".to_string())?;

    let today_list = compute_day_times(today_date, coords, params, &request.offsets)?;
    let tomorrow_list = compute_day_times(tomorrow_date, coords, params, &request.offsets)?;
    let yesterday_list = compute_day_times(yesterday_date, coords, params, &request.offsets)?;

    let today_date_key = today_date.format("%Y-%m-%d").to_string();
    let tomorrow_date_key = tomorrow_date.format("%Y-%m-%d").to_string();
    let yesterday_date_key = yesterday_date.format("%Y-%m-%d").to_string();

    let mut next_idx: Option<usize> = None;
    for (idx, (_, _, dt)) in today_list.iter().enumerate() {
        if dt.timestamp_millis() > now_ms {
            next_idx = Some(idx);
            break;
        }
    }

    let prayers: Vec<PrayerEntry> = today_list
        .iter()
        .enumerate()
        .map(|(idx, (id, label, dt))| {
            let ts = dt.timestamp_millis();
            PrayerEntry {
                id: id.clone(),
                label: label.clone(),
                timestamp_ms: ts,
                time_label: dt.format("%H:%M").to_string(),
                is_passed: ts <= now_ms,
                is_next: next_idx == Some(idx),
            }
        })
        .collect();

    let (
        next_prayer_id,
        next_prayer_label,
        next_prayer_timestamp_ms,
        next_prayer_time_label,
        next_prayer_date_key,
        next_prayer_is_tomorrow,
    ) = if let Some(idx) = next_idx {
        let (id, label, dt) = &today_list[idx];
        (
            id.clone(),
            label.clone(),
            dt.timestamp_millis(),
            dt.format("%H:%M").to_string(),
            today_date_key.clone(),
            false,
        )
    } else {
        // Post-Isha rollover: target tomorrow's Fajr
        let (id, label, dt) = &tomorrow_list[0];
        (
            id.clone(),
            label.clone(),
            dt.timestamp_millis(),
            dt.format("%H:%M").to_string(),
            tomorrow_date_key,
            true,
        )
    };

    // Determine most recently passed prayer (for sleep/hibernate wake grace-window catch-up)
    let (
        most_recent_prayer_id,
        most_recent_prayer_label,
        most_recent_prayer_timestamp_ms,
        most_recent_prayer_date_key,
    ) = if let Some(idx) = next_idx {
        if idx == 0 {
            let (id, label, dt) = &yesterday_list[4];
            (id.clone(), label.clone(), dt.timestamp_millis(), yesterday_date_key)
        } else {
            let (id, label, dt) = &today_list[idx - 1];
            (id.clone(), label.clone(), dt.timestamp_millis(), today_date_key.clone())
        }
    } else {
        let (id, label, dt) = &today_list[4];
        (id.clone(), label.clone(), dt.timestamp_millis(), today_date_key.clone())
    };

    let offset_str = now_local.format("%:z").to_string();
    let timezone_label = format!("UTC{offset_str}");

    Ok(PrayerScheduleResponse {
        date_key: today_date_key,
        timezone_label,
        resolved_method: resolved_method.to_string(),
        resolved_method_label: resolved_method_label.to_string(),
        madhab_label: madhab_label.to_string(),
        prayers,
        next_prayer_id,
        next_prayer_label,
        next_prayer_timestamp_ms,
        next_prayer_time_label,
        next_prayer_date_key,
        next_prayer_is_tomorrow,
        most_recent_prayer_id,
        most_recent_prayer_label,
        most_recent_prayer_timestamp_ms,
        most_recent_prayer_date_key,
    })
}

#[derive(Debug, Deserialize)]
struct ReverseGeocodeApiResponse {
    city: Option<String>,
    locality: Option<String>,
    #[serde(rename = "principalSubdivision")]
    principal_subdivision: Option<String>,
    #[serde(rename = "countryCode")]
    country_code: Option<String>,
}

async fn reverse_geocode_coords(lat: f64, lon: f64) -> (Option<String>, Option<String>, Option<String>) {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(4))
        .user_agent("CASA-Desktop/2.2.0")
        .build()
    {
        Ok(c) => c,
        Err(_) => return (None, None, None),
    };

    let url = format!(
        "https://api.bigdatacloud.net/data/reverse-geocode-client?latitude={lat:.5}&longitude={lon:.5}&localityLanguage=id"
    );

    let Ok(resp) = client.get(&url).send().await else {
        return (None, None, None);
    };
    if !resp.status().is_success() {
        return (None, None, None);
    }

    let Ok(data) = resp.json::<ReverseGeocodeApiResponse>().await else {
        return (None, None, None);
    };

    let city = data
        .city
        .filter(|s| !s.trim().is_empty())
        .or_else(|| data.locality.filter(|s| !s.trim().is_empty()))
        .or_else(|| data.principal_subdivision.clone().filter(|s| !s.trim().is_empty()));
    let region = data.principal_subdivision.filter(|s| !s.trim().is_empty());
    let country_code = data
        .country_code
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.trim().to_ascii_uppercase());

    (city, region, country_code)
}

#[cfg(windows)]
fn query_windows_geolocator_blocking() -> Result<(f64, f64, Option<f64>), (String, String)> {
    use windows::Devices::Geolocation::{GeolocationAccessStatus, Geolocator, PositionAccuracy};
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }

    // Request access first; on unpackaged Win32 apps Unspecified may still succeed if OS Location Services is enabled.
    if let Ok(req_op) = Geolocator::RequestAccessAsync() {
        if let Ok(access) = req_op.join() {
            if access == GeolocationAccessStatus::Denied {
                return Err((
                    "permission_denied".to_string(),
                    "Izin lokasi Windows ditolak. Aktifkan Location Services di Pengaturan Windows atau pilih kota secara manual.".to_string(),
                ));
            }
        }
    }

    let geolocator = Geolocator::new().map_err(|e| {
        (
            "service_disabled".to_string(),
            format!("Layanan lokasi Windows tidak tersedia ({e}). Silakan pilih kota secara manual."),
        )
    })?;

    let _ = geolocator.SetDesiredAccuracy(PositionAccuracy::Default);

    let op = geolocator.GetGeopositionAsync().map_err(|e| {
        (
            "service_disabled".to_string(),
            format!("Gagal meminta koordinat Windows ({e}). Pastikan Location Services aktif atau pilih kota manual."),
        )
    })?;

    let position = op.join().map_err(|e| {
        let code = e.code().0 as u32;
        if code == 0x8007_0005 {
            (
                "permission_denied".to_string(),
                "Akses lokasi Windows diblokir (Access Denied). Aktifkan izin lokasi desktop di Pengaturan Windows atau pilih kota manual.".to_string(),
            )
        } else {
            (
                "service_disabled".to_string(),
                "Lokasi Windows tidak merespons (Location Services mungkin nonaktif). Gunakan pencarian kota manual.".to_string(),
            )
        }
    })?;

    let coord = position.Coordinate().map_err(|e| {
        (
            "error".to_string(),
            format!("Gagal membaca objek koordinat lokasi ({e})."),
        )
    })?;

    let point = coord.Point().map_err(|e| {
        (
            "error".to_string(),
            format!("Gagal membaca Geopoint ({e})."),
        )
    })?;

    let basic = point.Position().map_err(|e| {
        (
            "error".to_string(),
            format!("Gagal membaca lintang/bujur ({e})."),
        )
    })?;

    let accuracy = coord.Accuracy().ok();

    if !basic.Latitude.is_finite() || !basic.Longitude.is_finite() {
        return Err((
            "error".to_string(),
            "Koordinat lokasi tidak valid.".to_string(),
        ));
    }

    Ok((basic.Latitude, basic.Longitude, accuracy))
}

/// Detects coordinates via Windows built-in Location API (`Windows.Devices.Geolocation`) with strict timeout.
#[tauri::command]
pub async fn detect_windows_location() -> DetectedLocationResult {
    #[cfg(windows)]
    {
        let timed = tokio::time::timeout(
            Duration::from_secs(7),
            tauri::async_runtime::spawn_blocking(query_windows_geolocator_blocking),
        )
        .await;

        match timed {
            Err(_) => DetectedLocationResult {
                status: "timeout".to_string(),
                latitude: None,
                longitude: None,
                city: None,
                region: None,
                country_code: None,
                accuracy_meters: None,
                message: "Deteksi lokasi Windows melebihi batas waktu (7 detik). Gunakan pencarian kota manual atau cek izin lokasi Windows.".to_string(),
            },
            Ok(Err(join_err)) => DetectedLocationResult {
                status: "error".to_string(),
                latitude: None,
                longitude: None,
                city: None,
                region: None,
                country_code: None,
                accuracy_meters: None,
                message: format!("Thread deteksi lokasi berhenti tak terduga: {join_err}"),
            },
            Ok(Ok(Err((status, message)))) => DetectedLocationResult {
                status,
                latitude: None,
                longitude: None,
                city: None,
                region: None,
                country_code: None,
                accuracy_meters: None,
                message,
            },
            Ok(Ok(Ok((lat, lon, accuracy)))) => {
                let (city, region, country_code) = reverse_geocode_coords(lat, lon).await;
                let resolved_city = city.unwrap_or_else(|| format!("{lat:.3}, {lon:.3}"));
                DetectedLocationResult {
                    status: "ok".to_string(),
                    latitude: Some(lat),
                    longitude: Some(lon),
                    city: Some(resolved_city.clone()),
                    region,
                    country_code,
                    accuracy_meters: accuracy,
                    message: format!("Lokasi terdeteksi: {resolved_city}"),
                }
            }
        }
    }

    #[cfg(not(windows))]
    {
        DetectedLocationResult {
            status: "unsupported".to_string(),
            latitude: None,
            longitude: None,
            city: None,
            region: None,
            country_code: None,
            accuracy_meters: None,
            message: "Deteksi lokasi Windows hanya tersedia di sistem operasi Windows.".to_string(),
        }
    }
}

#[derive(Debug, Deserialize)]
struct OpenMeteoGeoResult {
    name: String,
    admin1: Option<String>,
    country: Option<String>,
    country_code: Option<String>,
    latitude: f64,
    longitude: f64,
}

#[derive(Debug, Deserialize)]
struct OpenMeteoGeoResponse {
    results: Option<Vec<OpenMeteoGeoResult>>,
}

fn percent_encode_query(input: &str) -> String {
    let mut out = String::with_capacity(input.len() * 2);
    for b in input.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*b as char);
            }
            b' ' => out.push_str("%20"),
            _ => {
                out.push_str(&format!("%{:02X}", b));
            }
        }
    }
    out
}

/// Searches cities worldwide via Open-Meteo Geocoding API from Rust (keeps WebView CSP strictly locked).
#[tauri::command]
pub async fn search_prayer_city(query: String) -> Result<Vec<CitySearchItem>, String> {
    let trimmed = query.trim();
    if trimmed.len() < 2 {
        return Ok(Vec::new());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(6))
        .user_agent("CASA-Desktop/2.2.0")
        .build()
        .map_err(|e| format!("Gagal menginisialisasi HTTP client: {e}"))?;

    let encoded_name = percent_encode_query(trimmed);
    let url = format!(
        "https://geocoding-api.open-meteo.com/v1/search?name={encoded_name}&count=6&language=id&format=json"
    );

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|_| "Tidak dapat menghubungi layanan pencarian kota (periksa koneksi internet).".to_string())?;

    if !resp.status().is_success() {
        return Err(format!("Layanan pencarian kota mengembalikan status {}.", resp.status()));
    }

    let payload: OpenMeteoGeoResponse = resp
        .json()
        .await
        .map_err(|_| "Gagal membaca respons pencarian kota.".to_string())?;

    let items = payload
        .results
        .unwrap_or_default()
        .into_iter()
        .filter(|r| r.latitude.is_finite() && r.longitude.is_finite())
        .map(|r| CitySearchItem {
            name: r.name,
            region: r.admin1.filter(|s| !s.trim().is_empty()),
            country: r.country.unwrap_or_else(|| "Unknown".to_string()),
            country_code: r
                .country_code
                .unwrap_or_default()
                .trim()
                .to_ascii_uppercase(),
            latitude: r.latitude,
            longitude: r.longitude,
        })
        .collect();

    Ok(items)
}

/// Safely opens the built-in Windows Privacy -> Location settings page (hardcoded URI, zero injection surface).
#[tauri::command]
pub fn open_windows_location_settings() -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", "ms-settings:privacy-location"])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("Gagal membuka Pengaturan Lokasi Windows: {e}"))?;
        Ok(())
    }

    #[cfg(not(windows))]
    {
        Err("Hanya tersedia di Windows.".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_country_codes_to_expected_methods() {
        assert_eq!(resolve_method("auto", Some("ID")).0, "kemenag");
        assert_eq!(resolve_method("auto", Some("MY")).0, "jakim");
        assert_eq!(resolve_method("auto", Some("SG")).0, "muis");
        assert_eq!(resolve_method("auto", Some("SA")).0, "umm_al_qura");
        assert_eq!(resolve_method("auto", Some("US")).0, "isna");
        assert_eq!(resolve_method("auto", Some("JP")).0, "mwl");
        assert_eq!(resolve_method("umm_al_qura", Some("ID")).0, "umm_al_qura");
    }

    #[test]
    fn computes_ordered_jakarta_prayer_times_and_offsets() {
        let base_req = PrayerScheduleRequest {
            latitude: -6.2088,
            longitude: 106.8456,
            country_code: Some("ID".to_string()),
            method: "auto".to_string(),
            madhab: "shafi".to_string(),
            offsets: PrayerOffsets::default(),
        };
        let base = get_prayer_times(base_req).expect("Jakarta schedule must calculate");
        assert_eq!(base.resolved_method, "kemenag");
        assert_eq!(base.resolved_method_label, "Kemenag RI");
        assert_eq!(base.prayers.len(), 5);
        for w in base.prayers.windows(2) {
            assert!(w[0].timestamp_ms < w[1].timestamp_ms);
        }
        for p in &base.prayers {
            assert_eq!(
                p.timestamp_ms % 60_000,
                0,
                "prayer {} timestamp should align to exact :00 seconds",
                p.id
            );
        }

        let shifted_req = PrayerScheduleRequest {
            latitude: -6.2088,
            longitude: 106.8456,
            country_code: Some("ID".to_string()),
            method: "auto".to_string(),
            madhab: "hanafi".to_string(),
            offsets: PrayerOffsets {
                fajr: 2,
                dhuhr: 0,
                asr: -3,
                maghrib: 4,
                isha: 0,
            },
        };
        let shifted = get_prayer_times(shifted_req).expect("Shifted schedule must calculate");
        assert_eq!(shifted.madhab_label, "Hanafi");
        assert_eq!(
            shifted.prayers[0].timestamp_ms - base.prayers[0].timestamp_ms,
            2 * 60 * 1000
        );
        assert_eq!(
            shifted.prayers[3].timestamp_ms - base.prayers[3].timestamp_ms,
            4 * 60 * 1000
        );
    }

    #[test]
    fn rejects_out_of_range_coordinates() {
        let bad_req = PrayerScheduleRequest {
            latitude: 95.0,
            longitude: 106.8,
            country_code: None,
            method: "auto".to_string(),
            madhab: "shafi".to_string(),
            offsets: PrayerOffsets::default(),
        };
        assert!(get_prayer_times(bad_req).is_err());
    }
}
