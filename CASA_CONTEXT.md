# CASA_CONTEXT.md — Single Source of Truth (`v2.2.0`)

> Dibuat dari implementasi nyata pada `src/`, `src-tauri/`, dan `docs/` (bukan asumsi). Wajib diperbarui setiap kali kode atau arsitektur berubah.  
> **CASA** — *Dynamic Rabbit Island for Windows* (`com.farhanpratama.casa`) · MIT License.

---

## 1. Project Overview & Tech Stack

| Aspek | Detail |
|---|---|
| Form factor | Window Tauri transparan, frameless, `alwaysOnTop`, `skipTaskbar`, `shadow:false`, dipusatkan di tepi atas monitor aktif |
| Identifier / Versi | `com.farhanpratama.casa` / **`2.2.0`** (`tauri.conf.json`, `Cargo.toml`, `package.json`, `docs/`) |
| Window utama | `1100×340` terkunci (kanvas logis 1100 px menghindari *DWM swapchain ResizeBuffers hitch*; hitbox dinamis via `WS_EX_TRANSPARENT` per `HitRect`) |
| Settings window | Window sekunder `settings` (`DesktopSettingsWindow.tsx`) berarsitektur flat OLED 2-kolom (5 tab sidebar termasuk **`Ibadah & Lokasi`**) + tombol **`Quit CASA`** |
| Frontend | React 19, TypeScript 5.7 (`strict`), Vite 6 (dev `127.0.0.1:1420`, `manualChunks` & lazy `Settings`), Tailwind 3.4, framer-motion 12, zustand 5, lucide-react |
| Backend | Rust (edition 2021, `[profile.release]` `opt-level="z"`, `lto="thin"`, `strip="symbols"`, `panic="abort"`), Tauri 2.2 (`tray-icon`, `protocol-asset`), `tauri-plugin-{drag,global-shortcut,autostart,process,updater}`, tokio, reqwest 0.13, sysinfo 0.33, chrono 0.4, salah 0.7, serde |
| Windows API | `windows` 0.62 (`Media_Control`, `Storage_Streams`, `Devices_Radios/Bluetooth/Geolocation`, `Win32_Media_Audio`, `Win32_Globalization`, Wi-Fi/Power/WMI) + `windows-sys` 0.59 (`SetWindowPos`, `GetWindowLongPtrW`, `Toolhelp`) |
| Eksternal | LRCLIB (`lrclib.net/api/search`); Spotify Web API (`spotify_oauth.rs` loopback `127.0.0.1:8888`); YouTube native resolve; Open-Meteo Geocoding & BigDataCloud reverse-geocode via Rust `reqwest` (tanpa membuka CSP WebView); GitHub Releases API (`latest.json` OTA); Supabase (`casa_reviews` + Edge Functions) & Telegram Bot API |
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
├─ .agent/
│  ├─ ROADMAP_CASA.md        ← cetak biru roadmap pengembangan bertahap v2.1.3–v2.5.0
│  └─ skills/*/SKILL.md      ← domain guardrails & SOP spesialis CASA
├─ docs/                     ← Web Showcase 1:1 (farhanpratama09.github.io/casa-app/)
│  ├─ index.html             ← Pure Monochrome OLED showcase, SHA-256 download, Play Store Reviews & strict CSP
│  ├─ app.js                 ← Virtual Monitor parity simulator, clean path router, release hub & Supabase reviews
│  ├─ styles.css             ← Pure OLED theme + native Mode 6 capsule & Play Store reviews styling
│  ├─ 404.html               ← Clean SPA sub-route restoration (/playground, /arsitektur, /unduh, /feedback)
│  ├─ favicon.svg            ← Obsidian Bunny icon (`× ♥`)
│  ├─ PRD.md                 ← Product Requirements Document v2.2.0
│  └─ sasha-character-spec.md
├─ supabase/                 ← Backend moderasi ulasan publik (`ivlyujaafwqziogajjtk.supabase.co`)
│  ├─ config.toml            ← `verify_jwt = false` untuk `submit-review` & `telegram-webhook`
│  ├─ README.md              ← Panduan migrasi, PowerShell secret setup aman & moderasi Telegram
│  ├─ migrations/001_casa_reviews.sql ← `casa_reviews`, `review_rate_limits`, views `casa_reviews_public` & `casa_review_stats`
│  └─ functions/             ← `_shared/helpers.ts`, `submit-review/{index,spam}.ts`, `telegram-webhook/index.ts`
├─ scripts/
│  ├─ verify-docs-showcase.mjs        ← E2E Puppeteer parity Desktop (1280x800) & Mobile (390x844) + CSP & Reviews
│  ├─ verify-reviews-security.mjs     ← Unit test Node untuk anti-spam NFKC/word-boundary, IPv6 /64 HMAC & webhook crypto
│  ├─ verify-todo-persistence.mjs     ← Verifikasi persistensi To-Do antar-sesi, initial empty [], & validasi focusedTaskId
│  ├─ verify-search-playlist-flow.mjs ← Verifikasi Search Drawer & Playlist popover flow
│  ├─ verify-floating-drop-v213.mjs   ← Verifikasi Floating Mode anti-flicker & native CF_HDROP drag-out
│  ├─ verify-player-v214.mjs         ← Verifikasi Smart Queue, Anti-Loop Playlist, Session Seeding, Region, Search & Lazy Bundle
│  ├─ verify-dropzone-v220.mjs       ← Verifikasi Dropzone 2.0 (sanitasi HTML/URI, Smart Drag-In, Ctrl+V, CF_UNICODETEXT & ephemeral cleanup)
│  └─ verify-*.{ts,js}                ← Logic test suite (lyrics, queue, browser sanitizer, time-sync, hitbox)
├─ src-tauri/
│  ├─ tauri.conf.json        ← v2.2.0, com.farhanpratama.casa, 1100x340, dragDropEnabled:false, CSP, updater pubkey + endpoints
│  ├─ capabilities/default.json
│  └─ src/
│     ├─ main.rs / lib.rs    ← DPI window align (`position_window_top`), 50Hz hitbox, `Alt+Space`, tray EN, `quit_app`, updater
│     ├─ prayer.rs           ← Kalkulasi sholat offline (`salah` + `chrono::Local`), WinRT `Windows.Devices.Geolocation`, Open-Meteo city search, `ms-settings:privacy-location`
│     ├─ update_monitor.rs   ← Lightweight ETag (`If-None-Match`) background `latest.json` / release check (5s launch, `online` reconnect, focus/wake, 45m) + 6px pulse dot & changelog payload
│     ├─ hitbox.rs           ← Multi-rect `HitRect` poller 50Hz + `set_island_pinned`
│     ├─ spotify_oauth.rs    ← OAuth 2.0 loopback :8888 (`start_spotify_login`, `refresh_spotify_user_token`)
│     ├─ native_audio.rs     ← InnerTube dinamis region (`gl`/`hl`), search multi-kategori (`search_catalog_native`), `Up Next / Watch Playlist` (`get_up_next_native`), `browse_collection_tracks_native`, & stream resolution (`resolve_track_stream`)
│     ├─ system_hardware.rs  ← WASAPI volume/mute, Display brightness WMI, Stay-Awake, Wi-Fi, Bluetooth devices/battery, audio endpoints
│     ├─ system_stats.rs     ← CPU, RAM, & hardware telemetry (`get_system_telemetry`)
│     ├─ drop_zone.rs        ← Drop shelf metadata, clipboard files/image, staging transit ephemeral (`stage_dropped_file`, `cleanup_ephemeral_drop_zone`), native OLE `CF_HDROP` & `CF_UNICODETEXT` drag-out, launch/reveal/open actions
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
   │  ├─ CasaIsland.tsx      ← FSM `tucked | idle | expanded`, Priority Alert (`Timer` + `Ibadah` + `hoverExpandLocked` + `wasTuckedBeforeAlertRef`), alignment, multi-rect `update_island_hitboxes`
   │  ├─ settings/DesktopSettingsWindow.tsx + IbadahSettingsSection.tsx ← Jendela Settings 2-kolom (5 tab termasuk `Ibadah & Lokasi`) + `Quit CASA` + OTA updater UI
   │  ├─ system/             ← `BatteryPill.tsx` (Circular SVG ring), `CosmicIcons.tsx`, `Lunar*Icon.tsx`
   │  └─ views/
   │     ├─ IdlePillView.tsx, RestingPill.tsx, FocusHoverPeekCard.tsx, DropZoneView.tsx, Mode6TopNav.tsx
   │     └─ mode6/
   │        ├─ Mode6MusicLayout.tsx       ← Mode 6 sub-nav `Player | Playlists`, pop-up kanan `QUEUE`, search & lyrics pods
   │        └─ Mode6ControlCenterView.tsx ← Wi-Fi/BT satellite pods, theme-aware audio output icon, sliders, telemetry
   ├─ features/              ← `skillsRegistry.ts`, `media/`, `timer/`, `todo/`, `ibadah/` (`prayerStore.ts`, `prayerScheduleLogic.ts`, `prayerAudio.ts`, `IbadahExpandedView.tsx`)
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
- **Hitbox 50Hz/60Hz (`hitbox.rs`):** `update_island_hitboxes` menerima maksimal 6 `HitRect` (`center_offset_x`, `top_offset`, `width`, `height`) yang mencakup kapsul utama, *Search Drawer* (+ tinggi popover `AddToPlaylistPopover`), *Queue Popout*, serta pod *Wi-Fi* / *Bluetooth*. Saat drag-out native DropZone aktif (`IS_INTERNAL_DRAG_OUT`), region di luar kartu DropZone langsung dilepas menjadi `WS_EX_TRANSPARENT`.
- **OTA Auto-Updater & Background Notifier (`check_app_update`, `install_app_update`, `update_monitor.rs`):** Membaca `endpoints` di `tauri.conf.json` (`.../releases/latest/download/latest.json`) dengan verifikasi tanda tangan publik Minisign; daemon latar belakang melakukan pengecekan senyap memakai `ETag` / `If-None-Match` ke `latest.json` (fallback GitHub Releases API) pada 5 detik pasca-buka, event `online` saat koneksi pulih, focus/wake debounced, dan interval 45 menit — menyalakan titik 6px berdenyut pada ikon gerigi (`⚙`, klik langsung deep-link ke `System & Updates`) serta kartu **Update Tersedia** + changelog & tombol **`Download & Restart`** secara *real-time*.

### 3.2 Ringkasan IPC Commands (`invoke_handler` di `lib.rs`)
- **Window & Lifecycle:** `set_ignore_cursor_events`, `align_window_top`, `adjust_window_size`, `focus_island_window`, `set_window_visibility`, `toggle_gaming_mode`, `quit_app`, `update_island_hitbox`, `update_island_hitboxes`, `set_island_pinned`.
- **System & OTA:** `get_global_shortcut_status`, `get_autostart_enabled`, `set_autostart_enabled`, `check_app_update`, `install_app_update`, `get_update_notification_status`, `trigger_background_update_check`, `dismiss_update_badge`, `clear_update_notification`.
- **Media & Spotify:** `media_play_pause`, `media_next_track`, `media_prev_track`, `control_media_session`, `quick_swap_session`, `seek_media_session`, `get_current_media`, `spotify_play_track`, `spotify_play_uri_stealth`, `minimize_spotify_stealth`, `is_spotify_running`, `ensure_spotify_running_silent`, `focus_spotify_window`, `launch_spotify_process_clean`, `quit_spotify_app`, `start_spotify_login`, `refresh_spotify_user_token`, `search_tracks_native`, `search_catalog_native`, `get_up_next_native`, `browse_collection_tracks_native`, `get_player_region_info`, `resolve_track_stream`.
- **Hardware & Drop Zone:** `get_system_metrics`, `get_system_telemetry`, `get_hardware_telemetry`, `set_master_volume`, `toggle_audio_mute`, `set_display_brightness`, `set_stay_awake`, `get_stay_awake`, `get_radio_states`, `toggle_wifi`, `toggle_bluetooth`, `scan_wifi_networks`, `connect_wifi_network`, `list_paired_bluetooth`, `toggle_bluetooth_device`, `get_audio_output_devices`, `set_default_audio_endpoint`, `get_file_metadata`, `register_drop_zone_files`, `read_clipboard_text`, `read_clipboard_files`, `save_clipboard_image`, `copy_files_to_clipboard`, `native_drag_drop_files`, `native_drag_drop_text`, `stage_dropped_file`, `cleanup_ephemeral_drop_zone`, `pick_drop_zone_files`, `launch_file_item`, `reveal_in_folder`, `open_file_item`, `open_url_item`.
- **Pengingat Ibadah & Lokasi (`prayer.rs`):** `get_prayer_times`, `detect_windows_location`, `search_prayer_city`, `open_windows_location_settings`.

---

## 4. Arsitektur Frontend & UX `v2.2.0` (`src/` & `docs/`)

### 4.1 Dimensi Kapsul (`islandLayoutState.ts`)
- **Smart-Tuck:** `120×4 px` (sensor hover Docked `136×12 px`, Floating `140×18 px`), cooldown hysteresis hover/transisi terpadu **`220 ms`** (`HOVER_TRANSITION_HYSTERESIS_MS`), dan kompensasi *top-bridge* `0..12 px` di Floating Mode (`computePrimaryIslandHitboxAndSensor`) untuk transisi `tucked ↔ tucked_peek ↔ idle ↔ idle_peek`, plus cooldown pasca-fullscreen `450 ms`.
- **Idle Pill:** Tinggi fisik `39 px` (jendela `40 px`), lebar minimal awake `180 px`, HUD `244 px`, Timer Alarm `360/428 px`, Prayer T-0 `384 px`, Focus Hover Peek `420×84 px`.
- **Mode 6 Expanded:**
  - Musik default `480×186 px` (`540×186 px` saat 5 tab `Ibadah` aktif), Musik + Lirik `640×192 px` (pod satelit kiri Search / pod satelit kanan **`QUEUE`** lebar `204 px`, jarak `10 px`).
  - Productivity (Focus + To-Do) `600×186 px`.
  - Control Center `500×186 px` (`540×186 px` saat 5 tab `Ibadah` aktif; pod satelit Wi-Fi/BT `204 px`).
  - **Ibadah (Opt-In `v2.1.0`):** `560×186 px` (+`28 px` tinggi ekstra sementara jika banner tipis T-0 muncul di atas tab lain).
  - Drop Zone `580×192 px`.

### 4.2 Sub-Navigasi Musik & Tema (`Mode6MusicLayout.tsx`, `Mode6ControlCenterView.tsx`, `BatteryPill.tsx`)
- **Sub-Navigasi:** Hanya **`Player | Playlists`** (tab `Queue` redundan dihapus); daftar antrean diakses melalui tombol toggle pod kanan ber-header **`QUEUE`**, lengkap dengan kontrol Repeat 3-mode **`Off | All | One`** (`repeatMode` di `useQueueStore.ts`, `CasaAudioContext.tsx`, dan `docs/`).
- **CASA Player Smart Queue, Anti-Loop, & Search Multi-Kategori (`v2.1.4`):**
  - *Smart Queue Relasi & Session Seeding (`native_audio.rs`, `radioEngine.ts`, `useQueueStore.ts`):* Memakai InnerTube `youtubei/v1/next` (*Up Next / Watch Playlist* via `videoId` dengan fallback resmi `artistId` melalui `browse`), mempertahankan seed sesi aktif (`sessionSeeds` + playlist aktif) tanpa fallback ke riwayat putar 30 hari (*personal mix*), mematikan pengulangan playlist paksa (`wrapAround: false`) saat `repeatMode === 'off'`, dan melindungi skip cepat lewat `radioEpoch` + `AbortController` + `playbackSeqRef`.
  - *Region Dinamis & Pencarian Terstruktur:* Parameter `gl`/`hl` dibaca dinamis dari Windows locale OS (`Win32_Globalization`) dengan override manual `Auto | ID | US | KR | JP` (`settings.playerRegion` di `Timer, Audio & Player`); Search Pod kiri menampilkan **Top Songs Artis**, **Albums**, **Playlists**, dan **Songs** lengkap dengan tombol **Play All** / **+ Antrian** 1-klik yang memutar lagu utuh tanpa menunggu lirik sinkron LRCLIB.
  - *Hygiene RAM & Ukuran Biner:* `DesktopSettingsWindow` di-lazy-load via `React.lazy` (dikeluarkan dari `modulePreload` utama lewat `vite.config.ts`), dan `Cargo.toml` mengonfigurasi `[profile.release]` (`opt-level = "z"`, `lto = "thin"`, `strip = "symbols"`, `panic = "abort"`, `codegen-units = 1`).
- **Pure Monochrome Fidelity:** Saat `settings.theme === 'monochrome'`, seluruh elemen (`BatteryPill`, ikon `Speaker` / `Headphones` / `Bluetooth`, cincin CPU/RAM/Focus, status Wi-Fi/BT) wajib membaca token dari `CASA_THEME_PALETTES` (`#FFFFFF` / zinc) tanpa kelas warna statis Tailwind (`text-emerald-*`, `text-green-*`, dll.).
- **Dropzone 2.0 — Papan Transit Teks, Link & File Ephemeral (`v2.2.0`):**
  - *Smart Drag-In & `Ctrl+V` Eksplisit:* `dragDropEnabled: false` pada window `main` memungkinkan DOM `dragenter`/`dragover`/`drop` menerima `Files`, `text/uri-list`, `text/plain`, dan `text/html` langsung ke kapsul (termasuk membangunkan mode `tucked`/`idle`/`resting`), dilengkapi tombol **`Paste`** & pintasan `Ctrl+V` on-demand tanpa *clipboard snooping* latar belakang.
  - *Sanitasi & Blokir Skema URI Berbahaya:* `sanitizeDropText` membersihkan tag HTML/skrip dan karakter kontrol/bidi; `parseSafeHttpUrl` membatasi tautan hanya pada `http://` & `https://` serta memblokir `javascript:`, `data:`, `vbscript:`, `file://`, dll. dengan indikator `securityNotice`.
  - *Native Drag-Out `CF_UNICODETEXT`, Clipboard 1-Klik & Safeguard Undo 4 Detik:* `DropZoneView.tsx` mendukung drag-out kartu `file`/`image` (`native_drag_drop_files` `CF_HDROP`) dan `text`/`link` (`native_drag_drop_text` `CF_UNICODETEXT` + `CF_TEXT` + `CF_OEMTEXT` + `CF_LOCALE` lewat `run_drag_drop_on_sta`) dengan auto-hapus bersyarat `DRAGDROP_S_DROP` + anti-self-drop; klik tunggal badan kartu `text`/`link` langsung menyalin `item.payload` (`Tersalin`), sementara 1 item terakhir hasil drag-out ditahan in-memory selama `4 detik` disertai banner **Urungkan** (`undoLastDraggedOut`); seluruh isi Dropzone + direktori transit dibersihkan otomatis saat `beforeunload`, `pagehide`, startup, tray `"quit"`, maupun `quit_app` (`cleanup_ephemeral_transit_dir`).

- **Single Clock Sync, `Unsynced` Auto-Scroll & To-Do Alarm `v2.0.4`:**
  - *Single Playback Clock:* `playbackClock.ts` menyatukan `resolvePlaybackPositionMs`, `computeLyricAdjustedTimeMs` (`75 ms` companion, `0 ms` native), dan `computeSyncedLyricIndex` (`50 ms` hysteresis) untuk Mode 6 & Idle Pill, disertai re-anchor SMTC (`reanchorMediaPlaybackClock`) saat transisi expanded/idle & Playing/Paused.
  - *Proportional Unsynced Scroll:* Lirik tanpa timestamp menampilkan badge `Unsynced` dengan gulir halus proporsional (`computeUnsyncedScrollProgress`, margin intro/outro ±9%) dan jeda otomatis 4 detik saat digulir manual via *mouse wheel*.
  - *Timer → To-Do Auto-Check & Persistent Storage:* Daftar To-Do berawal kosong (`[]`) tanpa dummy task dan dipersistensikan sinkron via [todoPersistence.ts](./src/features/todo/todoPersistence.ts) (`localStorage` `casa_todo_items_v1` + validasi startup `focusedTaskId`); saat alarm berakhir pada item To-Do tertaut, muncul 3 aksi (`Selesai` | `+5m` | `Dismiss`), dan mencentang/menghapus item lebih dulu otomatis melepaskan tautan `focusedTaskId` (`unlinkTodoFromTimerState`).
- **Modul Pengingat Ibadah (`v2.1.0`, Opt-In Default OFF):**
  - *Zero Background Overhead saat OFF:* Tab ke-5 **`Ibadah`** pada `Mode6TopNav` (kini menggunakan `flex justify-between`) dan scheduler wall-clock (`prayerStore.ts` + `prayerScheduleLogic.ts`) hanya aktif bila pengguna menyalakan saklar di sidebar Settings **`Ibadah & Lokasi`**. `useSettingsStore.ts` juga memancarkan event `casa://settings-updated` lintas jendela WebView2, dan deduplikasi `fireKey` mengikutsertakan menit jadwal (`dateKey:prayerId:scheduledMin`) dengan perataan detik `:00` di `prayer.rs` serta tampilan preview `HH:MM` pada stepper koreksi menit Settings.
  - *Offline Rust Math & Dual Geolocation:* Menghitung 5 waktu sholat hari `D` + rollover Subuh `D+1` pasca-Isya via crate `salah` + `chrono::Local` (`prayer.rs`), mendukung `Windows.Devices.Geolocation` dengan timeout 7s + pencarian kota manual via Rust `reqwest` (Open-Meteo, CSP WebView tetap terkunci), pemetaan standar hisab otomatis berdasarkan `countryCode` (`ID` → Kemenag RI, `MY` → JAKIM, `SG` → MUIS, `SA/AE` → Umm al-Qura, `US/CA` → ISNA, lainnya → MWL), mazhab `Syafi'i | Hanafi`, dan offset `±` menit per waktu sholat.
  - *Lazy Dual-Path Audio (`0 MB` Idle RAM) & Priority Arbitration:* Audio `public/audio/adzan-subuh.ogg` (khusus **Subuh**, *graceful fallback* ke `/audio/adzan.ogg` lalu `playChimeCue`) dan `public/audio/adzan.ogg` (**Dzuhur, Ashar, Maghrib, Isya**, fallback ke `playChimeCue`) hanya dimuat *lazy* saat `T-0` / `Test Adzan` / `Test Subuh` (`prayerAudio.ts`) dan langsung dilepas setelah `Stop` / `ended`. Adzan mengambil prioritas audio di atas Focus Timer (mematikan loop chime Timer secara senyap tanpa menghapus status selesai/tautan To-Do Timer).
  - *Fullscreen, Post-Stop State & Celestial Sky Curve:* Pil T-0 tampil ringkas (`✦ ☾` mata Bintang & Bulan pada `CasaCompanionAvatar` ekspresi `'prayer'`, teks `Adzan <Sholat>`, jam tabular, 4 bar equalizer monokrom, tombol `Stop`/`Tutup`, animasi *micro-vibrate* 600ms, dan *breathing border glow*) dengan `hoverExpandLocked` penuh. Setelah `Stop`/audio selesai: tetap terbuka jika sebelumnya **Expanded Mode 6**, kembali ke **`idle`** normal pada desktop biasa, dan hanya langsung kembali ke **`tucked`** jika sedang aktif **Fullscreen / Gaming (`smart-tuck`)**. Pada `total-hide`, layar dijaga bersih (audio-only untuk Adzan/Chime; `Visual Saja` ditahan hingga keluar fullscreen dalam grace window 5 menit). Tab `Ibadah` menampilkan kurva parabola SVG dengan 5 titik sholat, ikon benda langit bergerak `13×13px` (Matahari Terbit / Matahari Penuh / Matahari Terbenam / Bulan Sabit + bintang) berlatar `#000000` (`r=8`) dan interpolasi warna langit dinamis (patuh Pure Monochrome pada tema `monochrome`), tombol *Perbarui Lokasi* (`↻`) di sebelah kota, label ringkas `<SHOLAT>` + `NEXT`, serta deep-link langsung ke sidebar Settings **`Ibadah & Lokasi`**.

### 4.3 Web Showcase & Ratings/Reviews (`docs/` & `supabase/`)
- **1:1 Parity Demo:** Simulasi interaktif di [docs/index.html](./docs/index.html) & [docs/app.js](./docs/app.js) mengikuti anatomi kapsul, intro `"Hi."`, Mode 6 `Player | Playlists` + `QUEUE`, Circular Battery Ring, Brightness HUD, Control Center, **Drop Zone 2.0** (file, link & text transit card + tombol `Paste` & `Ctrl+V` eksplisit + wake saat drag), serta **Pengingat Ibadah `v2.1.0`** (opt-in tab ke-5 kurva parabola SVG, simulasi pil `T-0` `✦ ☾` + `Adzan <Sholat>` + equalizer + getar mikro dengan `hoverExpandLocked`, dan banner tipis Mode 6).
- **Download Hub:** Menjumlahkan `.exe` + `.msi` dari GitHub Releases API (cache `localStorage` 15 menit) dan cooldown klik tombol 6 detik. Tombol utama berlabel `Download CASA for Windows` dengan metadata versi pada subteks `#download-size-text`.
- **Ratings & Reviews (Play Store Style):** Bagian `#feedback` membaca view `casa_reviews_public` dan `casa_review_stats` menggunakan `SUPABASE_PUBLISHABLE_KEY` via header `apikey` saja (tanpa `Authorization: Bearer`), dengan pengiriman lewat Edge Function `submit-review` (anti-spam + HMAC `/64` IP rate limit) dan moderasi 1-klik / balasan `Creator` lewat `telegram-webhook`. CSP ketat mengunci `script-src 'self'`, `frame-src 'none'`, dan `connect-src 'self' https://api.github.com https://ivlyujaafwqziogajjtk.supabase.co`.
