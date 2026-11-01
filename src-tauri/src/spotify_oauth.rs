use base64::Engine;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpotifyTokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: u64,
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
const ENCODED_SCOPES: &str = "user-read-playback-state%20user-modify-playback-state%20user-read-currently-playing%20playlist-read-private%20playlist-read-collaborative%20user-library-read%20user-library-modify";

/// Starts local HTTP loopback server on 127.0.0.1:8888 and opens user's browser to Spotify authorization
#[tauri::command]
pub async fn start_spotify_login(
    client_id: String,
    client_secret: String,
) -> Result<SpotifyTokens, String> {
    let listener = TcpListener::bind("127.0.0.1:8888")
        .await
        .map_err(|e| format!("Failed to bind loopback server on port 8888: {}", e))?;

    let auth_url = format!(
        "https://accounts.spotify.com/authorize?client_id={}&response_type=code&redirect_uri={}&scope={}",
        client_id.trim(),
        ENCODED_REDIRECT_URI,
        ENCODED_SCOPES,
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

    // Wait for incoming callback request with 120s timeout
    let code = tokio::time::timeout(Duration::from_secs(120), async {
        loop {
            let (mut socket, _) = listener
                .accept()
                .await
                .map_err(|e| format!("Accept failed: {}", e))?;

            let mut buf = [0u8; 4096];
            let bytes_read = socket
                .read(&mut buf)
                .await
                .map_err(|e| format!("Read error: {}", e))?;
            let request = String::from_utf8_lossy(&buf[..bytes_read]);

            // Check if this is the GET /callback?code=...
            if let Some(first_line) = request.lines().next() {
                if first_line.contains("/callback") {
                    // Extract code parameter
                    let mut auth_code = None;
                    if let Some(start) = first_line.find("code=") {
                        let query_str = &first_line[start + 5..];
                        let end = query_str
                            .find('&')
                            .or_else(|| query_str.find(' '))
                            .unwrap_or(query_str.len());
                        auth_code = Some(query_str[..end].to_string());
                    }

                    // Send clean OLED Dark Mode confirmation HTML
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

                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        html.len(),
                        html
                    );
                    let _ = socket.write_all(response.as_bytes()).await;
                    let _ = socket.flush().await;

                    if let Some(c) = auth_code {
                        return Ok(c);
                    } else {
                        return Err("No code found in callback query".to_string());
                    }
                }
            }
        }
    })
    .await
    .map_err(|_| "Spotify authorization timed out after 120 seconds".to_string())??;

    // Exchange code for Access Token & Refresh Token
    let client = reqwest::Client::new();
    let basic_auth = base64::engine::general_purpose::STANDARD.encode(format!("{}:{}", client_id.trim(), client_secret.trim()));

    let res = client
        .post("https://accounts.spotify.com/api/token")
        .header("Authorization", format!("Basic {}", basic_auth))
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(format!(
            "grant_type=authorization_code&code={}&redirect_uri={}",
            code, REDIRECT_URI
        ))
        .send()
        .await
        .map_err(|e| format!("Token exchange request failed: {}", e))?;

    if !res.status().is_success() {
        let err_body = res.text().await.unwrap_or_default();
        return Err(format!("Spotify token error: {}", err_body));
    }

    let token_data: TokenResponse = res
        .json()
        .await
        .map_err(|e| format!("Failed to parse token response: {}", e))?;

    Ok(SpotifyTokens {
        access_token: token_data.access_token,
        refresh_token: token_data.refresh_token,
        expires_in: token_data.expires_in,
        scope: token_data.scope,
    })
}

/// Automatically refreshes user access token using stored refresh token
#[tauri::command]
pub async fn refresh_spotify_user_token(
    refresh_token: String,
    client_id: String,
    client_secret: String,
) -> Result<SpotifyTokens, String> {
    let client = reqwest::Client::new();
    let basic_auth = base64::engine::general_purpose::STANDARD.encode(format!("{}:{}", client_id.trim(), client_secret.trim()));

    let res = client
        .post("https://accounts.spotify.com/api/token")
        .header("Authorization", format!("Basic {}", basic_auth))
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(format!(
            "grant_type=refresh_token&refresh_token={}",
            refresh_token.trim()
        ))
        .send()
        .await
        .map_err(|e| format!("Token refresh request failed: {}", e))?;

    if !res.status().is_success() {
        let err_body = res.text().await.unwrap_or_default();
        return Err(format!("Spotify refresh error: {}", err_body));
    }

    let token_data: TokenResponse = res
        .json()
        .await
        .map_err(|e| format!("Failed to parse refresh response: {}", e))?;

    Ok(SpotifyTokens {
        access_token: token_data.access_token,
        refresh_token: token_data.refresh_token.or(Some(refresh_token)),
        expires_in: token_data.expires_in,
        scope: token_data.scope,
    })
}
