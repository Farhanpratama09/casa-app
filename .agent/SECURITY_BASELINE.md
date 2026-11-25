# CASA Security Baseline & Guardrails (`v2.3.2+`)

Standar keamanan permanen untuk pengembangan CASA **`v2.4.0` ke atas** pada `src/`, `src-tauri/`, `docs/`, dan `scripts/`. Referensi ini melengkapi [AGENTS.md](../AGENTS.md) dan mengunci perbaikan 14 temuan audit keamanan (`v2.3.2`).

---

## 1. Tauri IPC, Capabilities & Asset Protocol (`src-tauri/`)

1. **Least-Privilege Capabilities (`src-tauri/capabilities/`):**
   - `default.json` memuat izin bersama minimum untuk jendela `main` & `settings` (tanpa izin pembuatan jendela/webview dan tanpa izin restart proses).
   - `main-window.json` (`"windows": ["main"]`) mengisolasi `"core:window:allow-create"` dan `"core:webview:allow-create-webview-window"`.
   - `settings-window.json` (`"windows": ["settings"]`) mengisolasi `"process:allow-restart"`.
   - Fitur baru tidak boleh menambahkan `*:default` yang luas jika hanya membutuhkan satu perintah spesifik.
2. **Global Tauri & CSP (`src-tauri/tauri.conf.json`):**
   - Pertahankan `"withGlobalTauri": false` agar hanya modul ES bundel yang memanggil `@tauri-apps/api`.
   - CSP produksi tidak boleh menyertakan `'unsafe-inline'` atau `'unsafe-eval'` pada `script-src`, dan wajib membatasi `connect-src` hanya ke endpoint resmi yang digunakan aplikasi.
3. **Asset Protocol Scope Narrowing (`src-tauri/src/drop_zone.rs`):**
   - **Dilarang memanggil `allow_directory(..., true)` secara rekursif.** Gunakan hanya `allow_file(...)` pada berkas tunggal yang sudah diverifikasi ada, non-direktori, lolos `is_previewable_asset_file`, dan tidak berada pada jalur sensitif (`is_blocked_asset_scope_path`: root drive, `Windows`, `Program Files*`, `%LOCALAPPDATA%`, `.ssh`, `.gnupg`, `.aws`, `.kube`, `.git`).
4. **Input Clamping UI → Native (`hitbox.rs`, `lib.rs`):**
   - `adjust_window_size` dibatasi dalam rentang `60..=1100` x `4..=340`.
   - `HitRect` wajib dinormalisasi lewat `normalize_hit_rect` (tolak `NaN`/`Infinity`, clamp dalam kanvas `1100x340`, maksimal 6 rect aktif).

---

## 2. Server LAN Connect HP (`src-tauri/src/connect_hp.rs`)

1. **Middleware Auth & Anti-DNS Rebinding Sebelum Body Extraction:**
   - Validasi LAN IP peer (`is_allowed_lan_ip`), header `Host` (`is_allowed_host` mencocokkan IP LAN + port aktif), status `stopped`, header `Origin` same-origin (`is_allowed_origin`), dan token sesi konstan-waktu (`ct_token_eq`) wajib dijalankan di `axum::middleware::from_fn_with_state` **sebelum** extractor `Json`/`Multipart` membaca body.
   - `touch_activity()` hanya boleh dipanggil setelah autentikasi request berhasil (mencegah DoS perpanjangan TTL oleh request tidak sah).
2. **Per-Route Body Limit:**
   - Terapkan `.layer(DefaultBodyLimit::max(MAX_DEFAULT_HTTP_BODY_BYTES))` (`256 KiB`) secara default pada router Connect HP.
   - `DefaultBodyLimit::disable()` hanya dipasang secara eksplisit pada route streaming `/api/upload` (yang membungkus `BodySizeGuard` streaming ke disk + batas ukuran per file).
3. **Header Keamanan, Batas Resource & Windows MOTW:**
   - Setiap respons HTTP menyertakan `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, dan `Cache-Control: no-store`.
   - Batasi koneksi WebSocket aktif dengan `MAX_WS_CLIENTS` (`8`) via `AtomicUsize::try_update` dan ukuran pesan `MAX_WS_MESSAGE_BYTES` (`4096`).
   - Pembuatan folder batch (`MAX_BATCH_FOLDERS_PER_SESSION = 32`) ditunda sampai file pertama menulis `written_bytes > 0` agar header `x-casa-batch-*` palsu tidak membuat direktori kosong.
   - Semua berkas hasil upload dari HP wajib diberi NTFS ADS Mark of the Web (`write_mark_of_the_web` → `:Zone.Identifier` dengan `ZoneId=3`).

---

## 3. Win32 FFI, Process Launch & Filesystem Hygiene

1. **COM Lifecycle & Typed Interfaces (`security_utils.rs`, `system_hardware.rs`, `prayer.rs`, `drop_zone.rs`):**
   - Inisialisasi COM wajib memakai RAII `ComGuard::init_mta()` / `ComGuard::init_sta()` agar setiap `CoInitializeEx` (`S_OK` / `S_FALSE`) seimbang dengan `CoUninitialize()` saat keluar cakupan.
   - Antarmuka COM tidak terdokumentasi seperti `IPolicyConfig` / `IPolicyConfigVista` wajib didefinisikan dengan `#[windows_core::interface("guid")]`, bukan `std::mem::transmute` raw vtable pointer. Endpoint ID wajib lolos validasi format dan cocok dengan daftar endpoint aktif.
2. **In-Process Shell API Tanpa CLI Argument Injection (`drop_zone.rs`, `prayer.rs`):**
   - Pembukaan folder (`reveal_in_folder`) menggunakan `ILCreateFromPathW` + `SHOpenFolderAndSelectItems` + `ILFree`, bukan memanggil `explorer.exe /select`.
   - Pembukaan URL HTTP/HTTPS (`open_url_item`) menggunakan `ShellExecuteW` langsung dengan penolakan whitespace/control character, bukan `rundll32 url.dll`.
   - Pemanggilan `rundll32.exe` (mis. pengaturan lokasi Windows di `prayer.rs`) wajib me-resolve jalur absolut `%SystemRoot%\System32\rundll32.exe`.
   - `launch_file_item` menolak ekstensi eksekusi/skrip berbahaya (`is_dangerous_executable_extension`) dan mengarahkan ke `reveal_in_folder` saja.
3. **Sanitasi Nama File, URI & Memori Thumbnail:**
   - Sanitasi path transit (`sanitize_transit_filename`, `sanitize_directory_name`) wajib menetralkan *path traversal*, separator `..`/`/`/`\`, serta Windows reserved DOS device names (`CON`, `PRN`, `AUX`, `NUL`, `COM0–9`, `LPT0–9` termasuk superscript) via `is_windows_reserved_device_name`.
   - Spotify desktop control (`spotify_win32.rs`) memverifikasi nama berkas biner `spotify.exe` (`Path::file_name()`) sebelum memeriksa jalur serta mensanitasi URI lewat `sanitize_spotify_uri`.
   - Pembacaan thumbnail GSMTC (`gsmtc.rs`) dibatasi `MAX_GSMTC_THUMBNAIL_BYTES` (`8 MiB`).

---

## 4. Kredensial, OAuth & Integritas Sidecar (`native_audio.rs`, `spotify_oauth.rs`)

1. **Spotify OAuth PKCE & Penyimpanan DPAPI (Zero Client Secret):**
   - Alur Spotify user memakai **OAuth 2.0 Authorization Code + PKCE (`S256`)** dan `state` CSPRNG 128-bit yang diverifikasi konstan-waktu (`crate::security_utils::ct_eq`).
   - Dilarang menyimpan atau membaca `SPOTIFY_CLIENT_SECRET` / `VITE_SPOTIFY_CLIENT_SECRET` di frontend, `.env.example`, maupun bundel Rust (`Client Credentials` flow di frontend ditiadakan).
   - Token user disimpan terenkripsi dengan **Windows DPAPI (`CryptProtectData` / `CryptUnprotectData`)** pada `%LOCALAPPDATA%\...\spotify_tokens.dpapi` melalui IPC `load_spotify_user_tokens`, `save_spotify_user_tokens`, `clear_spotify_user_tokens`. Kredensial legacy di `localStorage` dimigrasikan sekali lalu dihapus.
2. **Integritas Sidecar `yt-dlp`, Proxy Audio & TLS (`native_audio.rs`):**
   - Biner `yt-dlp` di-pin ke rilis tetap (`YTDLP_PINNED_TAG = "2026.11.23"`) dengan hash SHA-256 resmi (`YTDLP_WIN_SHA256`, `YTDLP_MACOS_SHA256`, `YTDLP_LINUX_SHA256`).
   - `verify_ytdlp_binary_sha256` wajib lulus **baik saat selesai mengunduh (sebelum rename) maupun setiap kali sebelum mengeksekusi biner**; jika hash tidak cocok, berkas langsung dihapus dan eksekusi dibatalkan.
   - Pengunduhan sidecar dibatasi `YTDLP_DOWNLOAD_TIMEOUT_SECS` (`30s`) dan `YTDLP_MAX_BINARY_BYTES` (`35 MiB`).
   - `STREAM_REGISTRY` dibatasi dengan LRU `StreamRegistryCache` (`MAX_STREAM_REGISTRY_ENTRIES = 64`), pembacaan header soket proxy dibatasi timeout 5 detik, dan header respons upstream disanitasi dari `CR`/`LF`.
   - Validasi sertifikat TLS (`danger_accept_invalid_certs`) selalu tetap `false` pada seluruh HTTP client Rust.

---

## 5. Kebersihan Frontend, Showcase & Gate Verifikasi Wajib

1. **Frontend & Web Showcase (`index.html`, `src/`, `docs/`):**
   - `index.html` bebas link stylesheet/CDN pihak ketiga yang yatim (`fonts.googleapis.com` dihapus; font OLED dipaket lokal lewat `@fontsource`).
   - Dilarang menggunakan `dangerouslySetInnerHTML`, `innerHTML`, `document.write`, atau `eval()` di `src/` maupun `docs/app.js`.
   - Tema Pure Monochrome OLED dijaga ketat: dilarang hardcode class emerald/green/`#10B981` pada komponen adaptif (`DropZoneView.tsx`, dll.).
2. **Gate Verifikasi Sebelum Rilis/Push:**
   Seluruh pemeriksaan berikut harus lulus dengan `exit code 0`:
   - `npx tsc --noEmit`
   - `npm run build`
   - `cargo check --manifest-path src-tauri/Cargo.toml`
   - `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --skip test_drip_babymonster` (pada Windows, sertakan manifest `Microsoft.Windows.Common-Controls` `6.0.0.0` lewat `CARGO_ENCODED_RUSTFLAGS` — `/MANIFEST:EMBED` dan `/MANIFESTDEPENDENCY:...` — karena `tauri_build::build()` hanya menautkan `resource.lib` ke target `--bin`, bukan target `--lib` unit test)
   - `node scripts/verify-reviews-security.mjs`
   - `node scripts/verify-connect-hp-v230.mjs`
   - `node scripts/verify-docs-showcase.mjs`
   - Seluruh skrip `scripts/verify-*.mjs` lainnya & `npm audit` (`0` vulnerabilities).
