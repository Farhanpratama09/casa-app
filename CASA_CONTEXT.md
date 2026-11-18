# CASA_CONTEXT.md — Single Source of Truth (`v2.0.3`)

> Dibuat dari implementasi nyata pada `src/`, `src-tauri/`, dan `docs/` (bukan asumsi). Wajib diperbarui setiap kali kode atau arsitektur berubah.  
> **CASA** — *Dynamic Rabbit Island for Windows* (`com.farhanpratama.casa`) · MIT License.

---

## 1. Project Overview & Tech Stack

| Aspek | Detail |
|---|---|
| Form factor | Window Tauri transparan, frameless, `alwaysOnTop`, `skipTaskbar`, `shadow:false`, dipusatkan di tepi atas monitor aktif |
| Identifier / Versi | `com.farhanpratama.casa` / **`2.0.3`** (`tauri.conf.json`, `Cargo.toml`, `package.json`) |
| Window utama | `1100×340` terkunci (kanvas logis 1100 px menghindari *DWM swapchain ResizeBuffers hitch*; hitbox dinamis via `WS_EX_TRANSPARENT` per `HitRect`) |
| Settings window | Window sekunder `settings` (`DesktopSettingsWindow.tsx`) berarsitektur flat OLED 2-kolom dengan tombol **`Quit CASA`** |
| Frontend | React 19, TypeScript 5.7 (`strict`), Vite 6 (dev `127.0.0.1:1420`), Tailwind 3.4, framer-motion 12, zustand 5, lucide-react |
| Backend | Rust (edition 2021), Tauri 2.2 (`tray-icon`, `protocol-asset`), `tauri-plugin-{drag,global-shortcut,autostart,process,updater}`, tokio, reqwest 0.13, sysinfo 0.33, serde |
| Windows API | `windows` 0.62 (`Media_Control`, `Storage_Streams`, `Devices_Radios/Bluetooth`, `Win32_Media_Audio`, Wi-Fi/Power/WMI) + `windows-sys` 0.59 (`SetWindowPos`, `GetWindowLongPtrW`, `Toolhelp`) |
| Eksternal | LRCLIB (`lrclib.net/api/search`); Spotify Web API (`spotify_oauth.rs` loopback `127.0.0.1:8888`); YouTube native resolve; GitHub Releases API (`latest.json` OTA); Supabase (`casa_reviews` + Edge Functions) & Telegram Bot API |
| Web Showcase | `docs/` (HTML/CSS/JS statis zero-dependency + Play Store-style **Ratings & Reviews** + E2E Puppeteer `scripts/verify-docs-showcase.mjs`) |
| Cek wajib | `npx tsc --noEmit`, `npm run build`, `cargo check --manifest-path src-tauri/Cargo.toml`, `node scripts/verify-docs-showcase.mjs`, `node scripts/verify-reviews-security.mjs` |

> **Status Keamanan:** Kredensial `SPOTIFY_CLIENT_SECRET` lama telah dibersihkan dari kode (`''` di `src/utils/spotifyService.ts`) dan seluruh histori objek Git (`git gc --prune=now`). `.gitignore` memblokir `.env*`, `*.key`, `*.pem`, `node_modules/`, dan `src-tauri/target/`.

---

## 2. Peta Folder & File Aktual

```
asaverse/
├─ README.md                 ← ringkasan proyek, fitur v2.0.3 & panduan dev/build
├─ AGENTS.md                 ← guardrail wajib agen & pre-push checklist
├─ CASA_CONTEXT.md           ← file ini (Single Source of Truth)
├─ LICENSE                   ← MIT License (Copyright © 2026 Farhan Pratama)
├─ .env.example              ← template SPOTIFY_* & VITE_SPOTIFY_* (.env* terblokir Git)
├─ .agent/skills/*/SKILL.md  ← domain guardrails & SOP spesialis CASA
├─ docs/                     ← Web Showcase 1:1 (farhanpratama09.github.io/casa-app/)
│  ├─ index.html             ← Pure Monochrome OLED showcase, SHA-256 download, Play Store Reviews & strict CSP
│  ├─ app.js                 ← Virtual Monitor parity simulator, clean path router, release hub & Supabase reviews
│  ├─ styles.css             ← Pure OLED theme + native Mode 6 capsule & Play Store reviews styling
│  ├─ 404.html               ← Clean SPA sub-route restoration (/playground, /arsitektur, /unduh, /feedback)
│  ├─ favicon.svg            ← Obsidian Bunny icon (`× ♥`)
│  ├─ PRD.md                 ← Product Requirements Document v2.0.3
│  └─ sasha-character-spec.md
├─ supabase/                 ← Backend moderasi ulasan publik (`ivlyujaafwqziogajjtk.supabase.co`)
│  ├─ config.toml            ← `verify_jwt = false` untuk `submit-review` & `telegram-webhook`
│  ├─ README.md              ← Panduan migrasi, PowerShell secret setup aman & moderasi Telegram
│  ├─ migrations/001_casa_reviews.sql ← `casa_reviews`, `review_rate_limits`, views `casa_reviews_public` & `casa_review_stats`
│  └─ functions/             ← `_shared/helpers.ts`, `submit-review/{index,spam}.ts`, `telegram-webhook/index.ts`
├─ scripts/
│  ├─ verify-docs-showcase.mjs        ← E2E Puppeteer parity Desktop (1280x800) & Mobile (390x844) + CSP & Reviews
│  ├─ verify-reviews-security.mjs     ← Unit test Node untuk anti-spam NFKC/word-boundary, IPv6 /64 HMAC & webhook crypto
│  ├─ verify-search-playlist-flow.mjs ← Verifikasi Search Drawer & Playlist popover flow
│  └─ verify-*.{ts,js}                ← Logic test suite (lyrics, queue, browser sanitizer, time-sync, hitbox)
├─ src-tauri/
│  ├─ tauri.conf.json        ← v2.0.3, com.farhanpratama.casa, 1100x340, CSP, updater pubkey + endpoints
│  ├─ capabilities/default.json
│  └─ src/
│     ├─ main.rs / lib.rs    ← DPI window align (`position_window_top`), 50Hz hitbox, `Alt+Space`, tray EN, `quit_app`, updater
│     ├─ hitbox.rs           ← Multi-rect `HitRect` poller 50Hz + `set_island_pinned`
│     ├─ spotify_oauth.rs    ← OAuth 2.0 loopback :8888 (`start_spotify_login`, `refresh_spotify_user_token`)
│     ├─ native_audio.rs     ← Pencarian & stream resolution native audio (`search_tracks_native`, `resolve_track_stream`)
│     ├─ system_hardware.rs  ← WASAPI volume/mute, Display brightness WMI, Stay-Awake, Wi-Fi, Bluetooth devices/battery, audio endpoints
│     ├─ system_stats.rs     ← CPU, RAM, & hardware telemetry (`get_system_telemetry`)
│     ├─ drop_zone.rs        ← Drop shelf metadata, clipboard files/image, launch/reveal/open actions
│     └─ media/
│        ├─ mod.rs           ← Router IPC media (`tokio::time::timeout` + `spawn_blocking`)
│        ├─ types.rs         ← `MediaSessionSummary`, `MediaUpdatePayload`
│        ├─ gsmtc.rs         ← GSMTC session tracking, klasifikasi AUMID, `STICKY_SESSION`, 500ms telemetry daemon
│        └─ providers/spotify_win32.rs ← `CreateToolhelp32Snapshot`, silent launch/focus/minimize/quit, URI playback
└─ src/
   ├─ App.tsx / index.css
   ├─ stores/
   │  ├─ useSettingsStore.ts ← `CASA_THEME_PALETTES` (default / monochrome / colorblind), placement, behavior, alarm, startup
   │  ├─ useDropZoneStore.ts / usePlaylistStore.ts / useQueueStore.ts
   ├─ components/
   │  ├─ CasaIsland.tsx      ← FSM `tucked | idle | expanded`, alignment, multi-rect `update_island_hitboxes`, search bounds
   │  ├─ settings/DesktopSettingsWindow.tsx ← Jendela Settings 2-kolom + tombol `Quit CASA` + OTA updater UI
   │  ├─ system/             ← `BatteryPill.tsx` (Circular SVG ring), `CosmicIcons.tsx`, `Lunar*Icon.tsx`
   │  └─ views/
   │     ├─ IdlePillView.tsx, RestingPill.tsx, FocusHoverPeekCard.tsx, DropZoneView.tsx, Mode6TopNav.tsx
   │     └─ mode6/
   │        ├─ Mode6MusicLayout.tsx       ← Mode 6 sub-nav `Player | Playlists`, pop-up kanan `QUEUE`, search & lyrics pods
   │        └─ Mode6ControlCenterView.tsx ← Wi-Fi/BT satellite pods, theme-aware audio output icon, sliders, telemetry
   ├─ features/              ← `skillsRegistry.ts`, `media/`, `timer/`, `todo/`
   ├─ hooks/                 ← `useSystemHardware.ts`, `useSystemTelemetry.ts`, `useCompanionMood.ts`, `useMusicAffinity.ts`
   ├─ skills/                ← `CasaSkill` engine, `useSkillStore`, `MediaSkill`, `timerSkill`, `todoSkill`
   └─ utils/                 ← `tauriBridge.ts`, `islandLayoutState.ts`, `spotifyService.ts`, `lyricsService.ts`, `musicQueueEngine.ts`, `smartShuffle.ts`, `settingsWindow.ts`
```

---

## 3. Arsitektur Backend & IPC (`src-tauri/src/`)

### 3.1 Lifecycle Window, Tray & Shortcut (`lib.rs`)
- **Position & Styles:** `position_window_top(window, w, h, align)` mendukung `left | center | right` per monitor DPI melalui Win32 `SetWindowPos` (`SWP_NOACTIVATE | SWP_NOZORDER`). `apply_win32_window_styles` menghapus `WS_EX_TRANSPARENT` awal dan memasang `WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW`.
- **Global Shortcut:** Plugin `global-shortcut` mendaftarkan `Alt+Space` (`casa://toggle-island`) tanpa panic bila bentrok (`SHORTCUT_ALT_SPACE_REGISTERED`).
- **System Tray (English Uniform):** `Show / Hide CASA`, `Gaming Mode: Auto`, dan `Quit CASA`. Baik aksi tray `quit` maupun command IPC `quit_app` sama-sama memanggil `app.global_shortcut().unregister_all()` sebelum `app.exit(0)`.
- **Hitbox 50Hz (`hitbox.rs`):** `update_island_hitboxes` menerima maksimal 6 `HitRect` (`center_offset_x`, `top_offset`, `width`, `height`) yang mencakup kapsul utama, *Search Drawer* (+ tinggi popover `AddToPlaylistPopover`), *Queue Popout*, serta pod *Wi-Fi* / *Bluetooth*.
- **OTA Auto-Updater (`check_app_update`, `install_app_update`):** Membaca `endpoints` di `tauri.conf.json` (`.../releases/latest/download/latest.json`) dengan verifikasi tanda tangan publik Minisign.

### 3.2 Ringkasan IPC Commands (`invoke_handler` di `lib.rs`)
- **Window & Lifecycle:** `set_ignore_cursor_events`, `align_window_top`, `adjust_window_size`, `focus_island_window`, `set_window_visibility`, `toggle_gaming_mode`, `quit_app`, `update_island_hitbox`, `update_island_hitboxes`, `set_island_pinned`.
- **System & OTA:** `get_global_shortcut_status`, `get_autostart_enabled`, `set_autostart_enabled`, `check_app_update`, `install_app_update`.
- **Media & Spotify:** `media_play_pause`, `media_next_track`, `media_prev_track`, `control_media_session`, `quick_swap_session`, `seek_media_session`, `get_current_media`, `spotify_play_track`, `spotify_play_uri_stealth`, `minimize_spotify_stealth`, `is_spotify_running`, `ensure_spotify_running_silent`, `focus_spotify_window`, `launch_spotify_process_clean`, `quit_spotify_app`, `start_spotify_login`, `refresh_spotify_user_token`, `search_tracks_native`, `resolve_track_stream`.
- **Hardware & Drop Zone:** `get_system_metrics`, `get_system_telemetry`, `get_hardware_telemetry`, `set_master_volume`, `toggle_audio_mute`, `set_display_brightness`, `set_stay_awake`, `get_stay_awake`, `get_radio_states`, `toggle_wifi`, `toggle_bluetooth`, `scan_wifi_networks`, `connect_wifi_network`, `list_paired_bluetooth`, `toggle_bluetooth_device`, `get_audio_output_devices`, `set_default_audio_endpoint`, `get_file_metadata`, `register_drop_zone_files`, `read_clipboard_text`, `read_clipboard_files`, `save_clipboard_image`, `copy_files_to_clipboard`, `pick_drop_zone_files`, `launch_file_item`, `reveal_in_folder`, `open_file_item`, `open_url_item`.

---

## 4. Arsitektur Frontend & UX `v2.0.3` (`src/` & `docs/`)

### 4.1 Dimensi Kapsul (`islandLayoutState.ts`)
- **Smart-Tuck:** `120×4 px` (sensor hover `124×8 px`), cooldown pasca-fullscreen `450 ms`.
- **Idle Pill:** Tinggi fisik `39 px` (jendela `40 px`), lebar minimal awake `180 px`, HUD `244 px`, Focus Hover Peek `420×84 px`.
- **Mode 6 Expanded:**
  - Musik default `480×186 px`, Musik + Lirik `640×192 px` (pod satelit kiri Search / pod satelit kanan **`QUEUE`** lebar `204 px`, jarak `10 px`).
  - Productivity (Focus + To-Do) `600×186 px`.
  - Control Center `500×186 px` (pod satelit Wi-Fi/BT `204 px`).
  - Drop Zone `580×192 px`.

### 4.2 Sub-Navigasi Musik & Tema (`Mode6MusicLayout.tsx`, `Mode6ControlCenterView.tsx`, `BatteryPill.tsx`)
- **Sub-Navigasi:** Hanya **`Player | Playlists`** (tab `Queue` redundan dihapus); daftar antrean diakses melalui tombol toggle pod kanan ber-header **`QUEUE`**.
- **Pure Monochrome Fidelity:** Saat `settings.theme === 'monochrome'`, seluruh elemen (`BatteryPill`, ikon `Speaker` / `Headphones` / `Bluetooth`, cincin CPU/RAM/Focus, status Wi-Fi/BT) wajib membaca token dari `CASA_THEME_PALETTES` (`#FFFFFF` / zinc) tanpa kelas warna statis Tailwind (`text-emerald-*`, `text-green-*`, dll.).

### 4.3 Web Showcase & Ratings/Reviews (`docs/` & `supabase/`)
- **1:1 Parity Demo:** Simulasi interaktif di [docs/index.html](./docs/index.html) & [docs/app.js](./docs/app.js) mengikuti anatomi kapsul, intro `"Hi."`, Mode 6 `Player | Playlists` + `QUEUE`, Circular Battery Ring, Brightness HUD, Control Center, dan Drop Zone di aplikasi desktop.
- **Download Hub:** Menjumlahkan `.exe` + `.msi` dari GitHub Releases API (cache `localStorage` 15 menit) dan cooldown klik tombol 6 detik. Tombol utama berlabel `Download CASA for Windows` dengan metadata versi pada subteks `#download-size-text`.
- **Ratings & Reviews (Play Store Style):** Bagian `#feedback` membaca view `casa_reviews_public` dan `casa_review_stats` menggunakan `SUPABASE_PUBLISHABLE_KEY` via header `apikey` saja (tanpa `Authorization: Bearer`), dengan pengiriman lewat Edge Function `submit-review` (anti-spam + HMAC `/64` IP rate limit) dan moderasi 1-klik / balasan `Creator` lewat `telegram-webhook`. CSP ketat mengunci `script-src 'self'`, `frame-src 'none'`, dan `connect-src 'self' https://api.github.com https://ivlyujaafwqziogajjtk.supabase.co`.
