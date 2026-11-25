use base64::Engine;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::Duration;
use tauri::Manager;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpotifyTokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: u64,
    pub scope: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredSpotifyTokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at_ms: i64,
    pub scope: Option<String>,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: u64,
    scope: Option<String>,
}

const REDIRECT_URI: &str = "http://127.0.0.1:8888/callback";
const ENCODED_REDIRECT_URI: &str = "http%3A%2F%2F127.0.0.1%3A8888%2Fcallback";
const ENCODED_SCOPES: &str = "user-read-private%20user-read-playback-state%20user-modify-playback-state%20user-read-currently-playing%20playlist-read-private%20playlist-read-collaborative%20user-library-read%20user-library-modify";
const SPOTIFY_TOKEN_HTTP_TIMEOUT_SECS: u64 = 10;

fn validate_spotify_client_id(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty()
        || trimmed.len() > 64
        || !trimmed.chars().all(|c| c.is_ascii_alphanumeric())
    {
        return Err("Spotify client_id tidak valid".to_string());
    }
    Ok(trimmed.to_string())
}

pub fn compute_pkce_s256_challenge(code_verifier: &str) -> String {
    let hash = crate::security_utils::sha256_bytes(code_verifier.as_bytes());
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(hash)
}

fn generate_pkce_pair() -> Result<(String, String), String> {
    let raw = crate::security_utils::random_bytes::<32>()?;
    let verifier = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(raw);
    let challenge = compute_pkce_s256_challenge(&verifier);
    Ok((verifier, challenge))
}

fn generate_oauth_state_hex() -> Result<String, String> {
    let raw = crate::security_utils::random_bytes::<16>()?;
    let mut hex = String::with_capacity(32);
    for b in raw {
        use std::fmt::Write;
        let _ = write!(&mut hex, "{:02x}", b);
    }
    Ok(hex)
}

fn percent_encode_form_component(raw: &str) -> String {
    use std::fmt::Write;
    let mut out = String::with_capacity(raw.len());
    for &b in raw.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => {
                let _ = write!(&mut out, "%{:02X}", b);
            }
        }
    }
    out
}

pub fn encode_form_urlencoded(pairs: &[(&str, &str)]) -> String {
    let mut parts = Vec::with_capacity(pairs.len());
    for (k, v) in pairs {
        parts.push(format!(
            "{}={}",
            percent_encode_form_component(k),
            percent_encode_form_component(v)
        ));
    }
    parts.join("&")
}

fn percent_decode(raw: &str) -> String {
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'+' {
            out.push(b' ');
            i += 1;
        } else if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex_slice = &raw[i + 1..i + 3];
            if let Ok(val) = u8::from_str_radix(hex_slice, 16) {
                out.push(val);
                i += 3;
                continue;
            }
            out.push(bytes[i]);
            i += 1;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

pub fn parse_oauth_callback_request_line(
    first_line: &str,
) -> Option<(Option<String>, Option<String>, Option<String>)> {
    let target = first_line.split_whitespace().nth(1)?;
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    if path != "/callback" {
        return None;
    }

    let mut code = None;
    let mut state = None;
    let mut error = None;
    for pair in query.split('&') {
        if let Some((k, v)) = pair.split_once('=') {
            match k {
                "code" => code = Some(percent_decode(v)),
                "state" => state = Some(percent_decode(v)),
                "error" => error = Some(percent_decode(v)),
                _ => {}
            }
        }
    }
    Some((code, state, error))
}

fn build_oauth_http_response(status_line: &str, html: &str) -> String {
    format!(
        "HTTP/1.1 {status_line}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store, max-age=0\r\nX-Frame-Options: DENY\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n{}",
        html.len(),
        html
    )
}

fn spotify_token_http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(SPOTIFY_TOKEN_HTTP_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("Failed building Spotify HTTP client: {}", e))
}

fn dpapi_token_store_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Cannot resolve app_local_data_dir: {}", e))?;
    Ok(dir.join("spotify_tokens.dpapi"))
}

fn persist_dpapi_tokens(
    app: &tauri::AppHandle,
    stored: &StoredSpotifyTokens,
) -> Result<(), String> {
    let path = dpapi_token_store_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Gagal membuat folder penyimpanan token: {}", e))?;
    }
    let json_bytes = serde_json::to_vec(stored)
        .map_err(|e| format!("Gagal serialisasi token Spotify: {}", e))?;

    #[cfg(windows)]
    let payload = crate::security_utils::dpapi_protect(&json_bytes)?;
    #[cfg(not(windows))]
    let payload = json_bytes;

    let tmp = path.with_extension("dpapi.tmp");
    std::fs::write(&tmp, &payload)
        .map_err(|e| format!("Gagal menulis berkas token terenkripsi: {}", e))?;
    std::fs::rename(&tmp, &path)
        .map_err(|e| format!("Gagal menyimpan berkas token terenkripsi: {}", e))?;
    Ok(())
}

fn load_dpapi_tokens(app: &tauri::AppHandle) -> Result<Option<StoredSpotifyTokens>, String> {
    let path = dpapi_token_store_path(app)?;
    if !path.is_file() {
        return Ok(None);
    }
    let cipher = std::fs::read(&path)
        .map_err(|e| format!("Gagal membaca berkas token terenkripsi: {}", e))?;
    if cipher.is_empty() {
        return Ok(None);
    }

    #[cfg(windows)]
    let plain = match crate::security_utils::dpapi_unprotect(&cipher) {
        Ok(p) => p,
        Err(_) => return Ok(None),
    };
    #[cfg(not(windows))]
    let plain = cipher;

    match serde_json::from_slice::<StoredSpotifyTokens>(&plain) {
        Ok(parsed) if !parsed.access_token.trim().is_empty() => Ok(Some(parsed)),
        _ => Ok(None),
    }
}

fn clear_dpapi_tokens(app: &tauri::AppHandle) -> Result<(), String> {
    let path = dpapi_token_store_path(app)?;
    if path.exists() {
        let _ = std::fs::remove_file(&path);
    }
    let tmp = path.with_extension("dpapi.tmp");
    if tmp.exists() {
        let _ = std::fs::remove_file(&tmp);
    }
    Ok(())
}

fn now_epoch_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[tauri::command]
pub fn load_spotify_user_tokens(app: tauri::AppHandle) -> Result<Option<StoredSpotifyTokens>, String> {
    load_dpapi_tokens(&app)
}

#[tauri::command]
pub fn save_spotify_user_tokens(
    app: tauri::AppHandle,
    tokens: StoredSpotifyTokens,
) -> Result<(), String> {
    if tokens.access_token.trim().is_empty() {
        return Err("Access token kosong".to_string());
    }
    persist_dpapi_tokens(&app, &tokens)
}

#[tauri::command]
pub fn clear_spotify_user_tokens(app: tauri::AppHandle) -> Result<(), String> {
    clear_dpapi_tokens(&app)
}

/// Starts local HTTP loopback OAuth 2.0 PKCE (`S256`) + `state` flow on 127.0.0.1:8888
#[tauri::command]
pub async fn start_spotify_login(
    app: tauri::AppHandle,
    client_id: String,
) -> Result<SpotifyTokens, String> {
    let clean_client_id = validate_spotify_client_id(&client_id)?;
    let (code_verifier, code_challenge) = generate_pkce_pair()?;
    let expected_state = generate_oauth_state_hex()?;

    let listener = TcpListener::bind("127.0.0.1:8888")
        .await
        .map_err(|e| format!("Failed to bind loopback server on port 8888: {}", e))?;

    let auth_url = format!(
        "https://accounts.spotify.com/authorize?client_id={}&response_type=code&redirect_uri={}&scope={}&state={}&code_challenge_method=S256&code_challenge={}",
        clean_client_id,
        ENCODED_REDIRECT_URI,
        ENCODED_SCOPES,
        expected_state,
        code_challenge,
    );

    // Launch default browser on Windows directly via Win32 ShellExecuteW (zero subprocess/CMD/conhost)
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::Shell::ShellExecuteW;
        use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        let op: Vec<u16> = "open\0".encode_utf16().collect();
        let file: Vec<u16> = format!("{}\0", auth_url).encode_utf16().collect();
        unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                op.as_ptr(),
                file.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                SW_SHOWNORMAL,
            );
        }
    }
    #[cfg(not(windows))]
    {
        let _ = std::process::Command::new("xdg-open")
            .arg(&auth_url)
            .spawn();
    }

    // Wait for valid state-matched callback request with 120s timeout
    let code = tokio::time::timeout(Duration::from_secs(120), async {
        loop {
            let (mut socket, _) = listener
                .accept()
                .await
                .map_err(|e| format!("Accept failed: {}", e))?;

            let mut buf = [0u8; 4096];
            let Ok(Ok(bytes_read)) =
                tokio::time::timeout(Duration::from_secs(5), socket.read(&mut buf)).await
            else {
                continue;
            };
            let request = String::from_utf8_lossy(&buf[..bytes_read]);

            let Some(first_line) = request.lines().next() else {
                continue;
            };

            let Some((code_opt, state_opt, err_opt)) = parse_oauth_callback_request_line(first_line)
            else {
                let not_found = build_oauth_http_response(
                    "404 Not Found",
                    "<!DOCTYPE html><html><body>Not Found</body></html>",
                );
                let _ = socket.write_all(not_found.as_bytes()).await;
                let _ = socket.flush().await;
                continue;
            };

            let state_matches = state_opt
                .as_deref()
                .map(|s| crate::security_utils::ct_eq(s.as_bytes(), expected_state.as_bytes()))
                .unwrap_or(false);

            if !state_matches {
                let bad_req = build_oauth_http_response(
                    "400 Bad Request",
                    "<!DOCTYPE html><html><body style=\"background:#000;color:#fff;font-family:sans-serif;text-align:center;padding:40px\"><h3>OAuth State Verification Failed</h3><p>CSRF/state mismatch rejected.</p></body></html>",
                );
                let _ = socket.write_all(bad_req.as_bytes()).await;
                let _ = socket.flush().await;
                continue;
            }

            if let Some(err_str) = err_opt {
                let denied_html = "<!DOCTYPE html><html><body style=\"background:#000;color:#fff;font-family:sans-serif;text-align:center;padding:40px\"><h3>Spotify Authorization Cancelled</h3><p>You can close this window.</p></body></html>";
                let resp = build_oauth_http_response("400 Bad Request", denied_html);
                let _ = socket.write_all(resp.as_bytes()).await;
                let _ = socket.flush().await;
                return Err(format!("Spotify authorization denied: {}", err_str));
            }

            let html = r#"<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>CASA Spotify Connected</title></head>
<body style="background:#000000;color:#ffffff;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;">
  <div style="text-align:center;padding:32px 40px;border:1px solid rgba(255,255,255,0.15);border-radius:20px;background:#0d0d0d;box-shadow:0 12px 40px rgba(0,0,0,0.8);">
    <div style="font-size:36px;color:#30D158;margin-bottom:12px;">✓</div>
    <h2 style="margin:0 0 8px 0;font-size:18px;font-weight:600;">Spotify Connected</h2>
    <p style="margin:0;color:#8E8E93;font-size:13px;line-height:1.5;">CASA is now synchronized with your real queue and playlists.<br>You can safely close this browser window.</p>
  </div>
  <script>setTimeout(() => window.close(), 1800);</script>
</body>
</html>"#;

            let response = build_oauth_http_response("200 OK", html);
            let _ = socket.write_all(response.as_bytes()).await;
            let _ = socket.flush().await;

            if let Some(c) = code_opt.filter(|s| !s.trim().is_empty()) {
                return Ok(c);
            } else {
                return Err("No authorization code found in callback query".to_string());
            }
        }
    })
    .await
    .map_err(|_| "Spotify authorization timed out after 120 seconds".to_string())??;

    // Exchange authorization code with PKCE code_verifier (zero client_secret needed)
    let client = spotify_token_http_client()?;
    let res = client
        .post("https://accounts.spotify.com/api/token")
        .header(
            reqwest::header::CONTENT_TYPE,
            "application/x-www-form-urlencoded",
        )
        .body(encode_form_urlencoded(&[
            ("grant_type", "authorization_code"),
            ("code", code.as_str()),
            ("redirect_uri", REDIRECT_URI),
            ("client_id", clean_client_id.as_str()),
            ("code_verifier", code_verifier.as_str()),
        ]))
        .send()
        .await
        .map_err(|e| format!("Token exchange request failed: {}", e))?;

    if !res.status().is_success() {
        let status = res.status();
        return Err(format!("Spotify token exchange returned HTTP {}", status));
    }

    let token_data: TokenResponse = res
        .json()
        .await
        .map_err(|e| format!("Failed to parse token response: {}", e))?;

    let stored = StoredSpotifyTokens {
        access_token: token_data.access_token.clone(),
        refresh_token: token_data.refresh_token.clone(),
        expires_at_ms: now_epoch_ms().saturating_add((token_data.expires_in as i64) * 1000),
        scope: token_data.scope.clone(),
    };
    let _ = persist_dpapi_tokens(&app, &stored);

    Ok(SpotifyTokens {
        access_token: token_data.access_token,
        refresh_token: token_data.refresh_token,
        expires_in: token_data.expires_in,
        scope: token_data.scope,
    })
}

/// Automatically refreshes user access token via Spotify PKCE refresh flow and updates DPAPI storage
#[tauri::command]
pub async fn refresh_spotify_user_token(
    app: tauri::AppHandle,
    client_id: String,
    refresh_token: Option<String>,
) -> Result<SpotifyTokens, String> {
    let clean_client_id = validate_spotify_client_id(&client_id)?;
    let stored_prev = load_dpapi_tokens(&app).ok().flatten();
    let effective_refresh = refresh_token
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| stored_prev.as_ref().and_then(|s| s.refresh_token.clone()))
        .ok_or_else(|| "Refresh token Spotify tidak ditemukan".to_string())?;

    let client = spotify_token_http_client()?;
    let res = client
        .post("https://accounts.spotify.com/api/token")
        .header(
            reqwest::header::CONTENT_TYPE,
            "application/x-www-form-urlencoded",
        )
        .body(encode_form_urlencoded(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", effective_refresh.as_str()),
            ("client_id", clean_client_id.as_str()),
        ]))
        .send()
        .await
        .map_err(|e| format!("Token refresh request failed: {}", e))?;

    if !res.status().is_success() {
        let status = res.status();
        return Err(format!("Spotify refresh returned HTTP {}", status));
    }

    let token_data: TokenResponse = res
        .json()
        .await
        .map_err(|e| format!("Failed to parse refresh response: {}", e))?;

    let merged_refresh = token_data.refresh_token.or(Some(effective_refresh));
    let stored = StoredSpotifyTokens {
        access_token: token_data.access_token.clone(),
        refresh_token: merged_refresh.clone(),
        expires_at_ms: now_epoch_ms().saturating_add((token_data.expires_in as i64) * 1000),
        scope: token_data.scope.clone(),
    };
    let _ = persist_dpapi_tokens(&app, &stored);

    Ok(SpotifyTokens {
        access_token: token_data.access_token,
        refresh_token: merged_refresh,
        expires_in: token_data.expires_in,
        scope: token_data.scope,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_s256_matches_rfc7636_appendix_b_vector() {
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        let expected_challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
        assert_eq!(compute_pkce_s256_challenge(verifier), expected_challenge);
    }

    #[test]
    fn callback_parser_and_client_id_guard_work() {
        assert!(validate_spotify_client_id("6d0512b574044ffa8833b4d0c550a4ce").is_ok());
        assert!(validate_spotify_client_id("").is_err());
        assert!(validate_spotify_client_id("bad&param=1").is_err());

        let parsed = parse_oauth_callback_request_line(
            "GET /callback?code=abc%2D123&state=deadbeef HTTP/1.1",
        )
        .expect("should parse /callback");
        assert_eq!(parsed.0.as_deref(), Some("abc-123"));
        assert_eq!(parsed.1.as_deref(), Some("deadbeef"));
        assert_eq!(parsed.2, None);

        assert!(parse_oauth_callback_request_line("GET /favicon.ico HTTP/1.1").is_none());
    }

    #[test]
    fn form_urlencoded_escapes_reserved_characters() {
        let encoded = encode_form_urlencoded(&[
            ("grant_type", "authorization_code"),
            ("val", "a&b=c+d e%f"),
        ]);
        assert_eq!(
            encoded,
            "grant_type=authorization_code&val=a%26b%3Dc%2Bd%20e%25f"
        );
    }
}
