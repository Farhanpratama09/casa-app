use serde::Deserialize;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;

const LATEST_JSON_ENDPOINT_URL: &str =
    "https://github.com/Farhanpratama09/casa-app/releases/latest/download/latest.json";
const GITHUB_RELEASES_LATEST_URL: &str =
    "https://api.github.com/repos/farhanpratama09/casa-app/releases/latest";
const GITHUB_RELEASES_PAGE_URL: &str =
    "https://github.com/Farhanpratama09/casa-app/releases/latest";
const UPDATE_EVENT_NAME: &str = "casa://update-status";
const STARTUP_CHECK_DELAY_SECS: u64 = 5;
const PERIODIC_CHECK_INTERVAL_SECS: u64 = 45 * 60;
const FOCUS_DEBOUNCE_SECS: u64 = 180;
const FORCE_MIN_INTERVAL_SECS: u64 = 15;
const HTTP_TIMEOUT_SECS: u64 = 8;

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateNotificationPayload {
    pub current_version: String,
    pub latest_version: Option<String>,
    pub release_url: Option<String>,
    pub release_notes: Option<String>,
    pub published_at: Option<String>,
    pub update_available: bool,
    pub badge_visible: bool,
}

#[derive(Deserialize)]
struct LatestJsonManifest {
    version: Option<String>,
    notes: Option<String>,
    pub_date: Option<String>,
}

#[derive(Deserialize)]
struct GitHubLatestRelease {
    tag_name: Option<String>,
    html_url: Option<String>,
    body: Option<String>,
    published_at: Option<String>,
    draft: Option<bool>,
    prerelease: Option<bool>,
}

enum FetchOutcome {
    NotModified,
    Updated {
        etag: Option<String>,
        tag_name: Option<String>,
        html_url: Option<String>,
        release_notes: Option<String>,
        published_at: Option<String>,
        is_draft: bool,
        is_prerelease: bool,
    },
    FailedOrSkipped,
}

struct UpdateMonitorInner {
    etag: Option<String>,
    latest_version: Option<String>,
    release_url: Option<String>,
    release_notes: Option<String>,
    published_at: Option<String>,
    dismissed_version: Option<String>,
    last_check_instant: Option<Instant>,
    last_check_wall: Option<SystemTime>,
    is_checking: bool,
    client: reqwest::Client,
}

#[derive(Clone)]
pub struct UpdateMonitorState {
    inner: Arc<Mutex<UpdateMonitorInner>>,
}

impl Default for UpdateMonitorState {
    fn default() -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(HTTP_TIMEOUT_SECS))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        Self {
            inner: Arc::new(Mutex::new(UpdateMonitorInner {
                etag: None,
                latest_version: None,
                release_url: None,
                release_notes: None,
                published_at: None,
                dismissed_version: None,
                last_check_instant: None,
                last_check_wall: None,
                is_checking: false,
                client,
            })),
        }
    }
}

fn strip_version_prefix(raw: &str) -> String {
    raw.trim().trim_start_matches(['v', 'V']).to_string()
}

fn parse_semver_tuple(raw: &str) -> Option<(u64, u64, u64, bool)> {
    let cleaned = strip_version_prefix(raw);
    if cleaned.is_empty() {
        return None;
    }

    let (core_part, has_prerelease) = match cleaned.split_once('-') {
        Some((core, pre)) => (core, !pre.trim().is_empty()),
        None => (cleaned.as_str(), false),
    };
    let core_no_meta = core_part.split('+').next().unwrap_or(core_part);

    let mut parts = core_no_meta.split('.');
    let major = parts.next()?.trim().parse::<u64>().ok()?;
    let minor = parts
        .next()
        .map(|s| s.trim().parse::<u64>().ok())
        .unwrap_or(Some(0))?;
    let patch = parts
        .next()
        .map(|s| s.trim().parse::<u64>().ok())
        .unwrap_or(Some(0))?;

    Some((major, minor, patch, has_prerelease))
}

pub fn is_remote_version_newer(remote_tag: &str, current_version: &str) -> bool {
    let Some((r_maj, r_min, r_pat, r_pre)) = parse_semver_tuple(remote_tag) else {
        return false;
    };
    let Some((c_maj, c_min, c_pat, c_pre)) = parse_semver_tuple(current_version) else {
        return false;
    };

    let r_tuple = (r_maj, r_min, r_pat);
    let c_tuple = (c_maj, c_min, c_pat);

    if r_tuple > c_tuple {
        return !r_pre;
    }
    if r_tuple == c_tuple && !r_pre && c_pre {
        return true;
    }
    false
}

fn build_payload(inner: &UpdateMonitorInner, current_version: &str) -> UpdateNotificationPayload {
    let valid_latest = inner
        .latest_version
        .as_ref()
        .filter(|v| is_remote_version_newer(v, current_version))
        .cloned();
    let update_available = valid_latest.is_some();
    let badge_visible = match &valid_latest {
        Some(ver) => inner.dismissed_version.as_deref() != Some(ver.as_str()),
        None => false,
    };

    UpdateNotificationPayload {
        current_version: current_version.to_string(),
        latest_version: valid_latest,
        release_url: if update_available {
            inner.release_url.clone()
        } else {
            None
        },
        release_notes: if update_available {
            inner.release_notes.clone()
        } else {
            None
        },
        published_at: if update_available {
            inner.published_at.clone()
        } else {
            None
        },
        update_available,
        badge_visible,
    }
}

fn elapsed_since_last_check_secs(inner: &UpdateMonitorInner) -> Option<u64> {
    let monotonic = inner.last_check_instant.map(|t| t.elapsed().as_secs());
    let wall = inner
        .last_check_wall
        .and_then(|t| SystemTime::now().duration_since(t).ok())
        .map(|d| d.as_secs());

    match (monotonic, wall) {
        (Some(a), Some(b)) => Some(a.max(b)),
        (Some(a), None) => Some(a),
        (None, Some(b)) => Some(b),
        (None, None) => None,
    }
}

async fn fetch_latest_json_with_etag(
    client: &reqwest::Client,
    current_version: &str,
    cached_etag: Option<&str>,
) -> FetchOutcome {
    let mut request = client
        .get(LATEST_JSON_ENDPOINT_URL)
        .header("User-Agent", format!("CASA-App/{current_version}"))
        .header("Accept", "application/json");

    if let Some(etag) = cached_etag {
        if !etag.trim().is_empty() {
            request = request.header("If-None-Match", etag);
        }
    }

    let Ok(response) = request.send().await else {
        return FetchOutcome::FailedOrSkipped;
    };

    if response.status() == reqwest::StatusCode::NOT_MODIFIED {
        return FetchOutcome::NotModified;
    }

    if !response.status().is_success() {
        return FetchOutcome::FailedOrSkipped;
    }

    let etag = response
        .headers()
        .get(reqwest::header::ETAG)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let Ok(manifest) = response.json::<LatestJsonManifest>().await else {
        return FetchOutcome::FailedOrSkipped;
    };

    if manifest.version.as_deref().map(str::trim).unwrap_or("").is_empty() {
        return FetchOutcome::FailedOrSkipped;
    }

    FetchOutcome::Updated {
        etag,
        tag_name: manifest.version,
        html_url: Some(GITHUB_RELEASES_PAGE_URL.to_string()),
        release_notes: manifest.notes.filter(|s| !s.trim().is_empty()),
        published_at: manifest.pub_date.filter(|s| !s.trim().is_empty()),
        is_draft: false,
        is_prerelease: false,
    }
}

async fn fetch_latest_release_with_etag(
    client: &reqwest::Client,
    current_version: &str,
    cached_etag: Option<&str>,
) -> FetchOutcome {
    // Primary: lightweight signed OTA `latest.json` endpoint (zero GitHub REST API rate-limit)
    match fetch_latest_json_with_etag(client, current_version, cached_etag).await {
        FetchOutcome::FailedOrSkipped => {}
        resolved => return resolved,
    }

    // Secondary fallback: GitHub Releases latest API with ETag
    let mut request = client
        .get(GITHUB_RELEASES_LATEST_URL)
        .header("User-Agent", format!("CASA-App/{current_version}"))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28");

    if let Some(etag) = cached_etag {
        if !etag.trim().is_empty() {
            request = request.header("If-None-Match", etag);
        }
    }

    let Ok(response) = request.send().await else {
        return FetchOutcome::FailedOrSkipped;
    };

    if response.status() == reqwest::StatusCode::NOT_MODIFIED {
        return FetchOutcome::NotModified;
    }

    if !response.status().is_success() {
        return FetchOutcome::FailedOrSkipped;
    }

    let etag = response
        .headers()
        .get(reqwest::header::ETAG)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let Ok(release) = response.json::<GitHubLatestRelease>().await else {
        return FetchOutcome::FailedOrSkipped;
    };

    FetchOutcome::Updated {
        etag,
        tag_name: release.tag_name,
        html_url: release.html_url,
        release_notes: release.body.filter(|s| !s.trim().is_empty()),
        published_at: release.published_at.filter(|s| !s.trim().is_empty()),
        is_draft: release.draft.unwrap_or(false),
        is_prerelease: release.prerelease.unwrap_or(false),
    }
}

pub async fn run_silent_update_check(app: &AppHandle, force: bool) {
    let Some(state) = app.try_state::<UpdateMonitorState>() else {
        return;
    };
    let current_version = app.package_info().version.to_string();

    let (client, cached_etag) = {
        let mut inner = state.inner.lock().await;
        if inner.is_checking {
            return;
        }
        let min_gap = if force {
            FORCE_MIN_INTERVAL_SECS
        } else {
            FOCUS_DEBOUNCE_SECS
        };
        if let Some(secs) = elapsed_since_last_check_secs(&inner) {
            if secs < min_gap {
                return;
            }
        }
        inner.is_checking = true;
        (inner.client.clone(), inner.etag.clone())
    };

    let outcome =
        fetch_latest_release_with_etag(&client, &current_version, cached_etag.as_deref()).await;

    let payload_to_emit = {
        let mut inner = state.inner.lock().await;
        inner.is_checking = false;
        inner.last_check_instant = Some(Instant::now());
        inner.last_check_wall = Some(SystemTime::now());

        match outcome {
            FetchOutcome::NotModified => Some(build_payload(&inner, &current_version)),
            FetchOutcome::Updated {
                etag,
                tag_name,
                html_url,
                release_notes,
                published_at,
                is_draft,
                is_prerelease,
            } => {
                if let Some(new_etag) = etag {
                    inner.etag = Some(new_etag);
                }

                if !is_draft && !is_prerelease {
                    if let Some(raw_tag) = tag_name {
                        if is_remote_version_newer(&raw_tag, &current_version) {
                            let normalized = strip_version_prefix(&raw_tag);
                            if inner.latest_version.as_deref() != Some(normalized.as_str()) {
                                inner.latest_version = Some(normalized);
                            }
                            inner.release_url = html_url;
                            inner.release_notes = release_notes;
                            inner.published_at = published_at;
                        } else {
                            inner.latest_version = None;
                            inner.release_url = None;
                            inner.release_notes = None;
                            inner.published_at = None;
                            inner.dismissed_version = None;
                        }
                    }
                }
                Some(build_payload(&inner, &current_version))
            }
            FetchOutcome::FailedOrSkipped => None,
        }
    };

    if let Some(payload) = payload_to_emit {
        let _ = app.emit(UPDATE_EVENT_NAME, &payload);
    }
}

pub fn spawn_background_update_monitor(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(STARTUP_CHECK_DELAY_SECS)).await;
        run_silent_update_check(&app, true).await;

        let mut ticker = tokio::time::interval(Duration::from_secs(PERIODIC_CHECK_INTERVAL_SECS));
        ticker.tick().await;
        loop {
            ticker.tick().await;
            run_silent_update_check(&app, true).await;
        }
    });
}

#[tauri::command]
pub async fn get_update_notification_status(
    app: AppHandle,
    state: tauri::State<'_, UpdateMonitorState>,
) -> Result<UpdateNotificationPayload, String> {
    let current_version = app.package_info().version.to_string();
    let inner = state.inner.lock().await;
    Ok(build_payload(&inner, &current_version))
}

#[tauri::command]
pub async fn trigger_background_update_check(
    app: AppHandle,
    force: Option<bool>,
) -> Result<(), String> {
    let app_clone = app.clone();
    let should_force = force.unwrap_or(false);
    tauri::async_runtime::spawn(async move {
        run_silent_update_check(&app_clone, should_force).await;
    });
    Ok(())
}

#[tauri::command]
pub async fn dismiss_update_badge(
    app: AppHandle,
    state: tauri::State<'_, UpdateMonitorState>,
) -> Result<UpdateNotificationPayload, String> {
    let current_version = app.package_info().version.to_string();
    let payload = {
        let mut inner = state.inner.lock().await;
        if let Some(latest) = inner.latest_version.clone() {
            inner.dismissed_version = Some(latest);
        }
        build_payload(&inner, &current_version)
    };
    let _ = app.emit(UPDATE_EVENT_NAME, &payload);
    Ok(payload)
}

#[tauri::command]
pub async fn clear_update_notification(
    app: AppHandle,
    state: tauri::State<'_, UpdateMonitorState>,
) -> Result<UpdateNotificationPayload, String> {
    let current_version = app.package_info().version.to_string();
    let payload = {
        let mut inner = state.inner.lock().await;
        inner.latest_version = None;
        inner.release_url = None;
        inner.release_notes = None;
        inner.published_at = None;
        inner.dismissed_version = None;
        build_payload(&inner, &current_version)
    };
    let _ = app.emit(UPDATE_EVENT_NAME, &payload);
    Ok(payload)
}

#[cfg(test)]
mod tests {
    use super::is_remote_version_newer;

    #[test]
    fn compares_semver_tags_accurately() {
        assert!(is_remote_version_newer("v2.0.5", "2.0.4"));
        assert!(is_remote_version_newer("2.1.0", "2.0.9"));
        assert!(is_remote_version_newer("v3.0.0", "2.9.9"));
        assert!(!is_remote_version_newer("v2.0.4", "2.0.4"));
        assert!(!is_remote_version_newer("v2.0.3", "2.0.4"));
        assert!(!is_remote_version_newer("v2.0.5-beta.1", "2.0.4"));
        assert!(is_remote_version_newer("2.0.5", "2.0.5-beta.1"));
    }
}
