# Product Requirements Document (PRD) — CASA `v2.3.0`

**CASA — Dynamic Rabbit Island for Windows** (`com.farhanpratama.casa`)  
Ambient Desktop Notch, Media Companion & Hardware Telemetry Island (Tauri v2 + Rust + React 19 + TypeScript + Vite)  
**Lisensi:** MIT License ([LICENSE](../LICENSE)) — Copyright © 2026 Farhan Pratama

---

## 1. Identitas & Filosofi Produk
- **Nama Produk:** CASA (*Dynamic Rabbit Island for Windows*)
- **Versi Acuan:** `2.3.0` (tersinkron di [package.json](../package.json), [Cargo.toml](../src-tauri/Cargo.toml), [tauri.conf.json](../src-tauri/tauri.conf.json), sidebar Settings, dan [docs/index.html](./index.html))
- **Konsep Inti:** Kapsul *top-flush Dynamic Island* berlatar OLED hitam murni (`#000000`) di tepi atas monitor Windows 10/11 yang hening (*non-intrusive*, `WS_EX_NOACTIVATE`), menyatukan pemutar musik & lirik sinkron milidetik, *Focus Timer & To-Do Ring*, kontrol cepat sistem, *Drag & Drop Shelf*, dan ekspresi maskot **Obsidian Bunny** (`× ♥`).

---

## 2. Arsitektur & Spesifikasi Desktop (`src/` & `src-tauri/`)

### 2.1 Mode 6 Musik, Sub-Navigasi & Pop-up `QUEUE`
- **Navigasi Sub-Tab:** Menggunakan tepat **2 sub-tab utama** bertajuk **`Player | Playlists`** pada bar kontrol musik (`Mode6MusicLayout.tsx`) — tanpa tab `Queue` redundan pada sub-navigasi.
- **Smart Queue Relasi, Anti-Loop & Search Multi-Kategori (`v2.1.4`):**
  - Auto-queue menggunakan InnerTube `youtubei/v1/next` (*Up Next / Watch Playlist* via `videoId` dengan fallback `artistId` resmi), memakai seed sesi aktif (`sessionSeeds`) tanpa fallback ke *personal mix* 30 hari, mematikan loop playlist saat `repeatMode === 'off'` (berlanjut ke Smart Queue seeded dari playlist kecuali `repeatMode === 'all'`), dan mendukung **Repeat 3-mode (`Off | All | One`)** tersinkron ke `docs/`.
  - Pencarian CASA Player memakai parameter region dinamis (`gl`/`hl` OS + opsi `Auto | ID | US | KR | JP` di Settings) serta menampilkan kategori **Top Songs Artis**, **Albums**, **Playlists**, dan **Songs** dengan aksi **Play All / + Antrian** 1-klik (tetap memutar penuh meski lirik sinkron LRCLIB tidak tersedia), disertai lazy loading Settings (`React.lazy` + `manualChunks`) dan optimasi biner Rust (`[profile.release]`).
- **Pop-up Satelit Kanan `QUEUE`:** Dipicu oleh tombol ikon ke-4 pada kontrol `Player`, menampilkan kartu satelit sebelah kanan (`width: 204px`, celah `10px` dari kapsul utama) dengan header monospace ringkas **`QUEUE`** + jumlah antrean.
- **Search Drawer & Playlist Popover:** Kartu satelit kiri (*Search CASA Player*) wajib mengunci popover `SAVE TO PLAYLIST` (`AddToPlaylistPopover`) di dalam batas horizontal & vertikal drawer (`searchDrawerBounds`) dan melaporkannya lewat `update_island_hitboxes` agar terbebas dari *click-through* Windows.
- **Context-Aware Queue Playback & Instant Invalidation:**
  - Konteks `:playlist:` / `:album:` mengirim `{ context_uri, offset: { uri } }`.
  - Konteks non-playlist (Search / Artist / CASA Player) wajib mengirim `{ uris: [clickedUri, ...nextUris] }` tanpa `offset`.
  - Saat berpindah lagu/konteks, state `queue` lama segera diinvalidasi (`request counter` / `AbortController`).
- **Hybrid Media & Lifecycle State:** Menggabungkan Windows GSMTC (`src-tauri/src/media/gsmtc.rs`) dan Spotify Web API (`src/utils/spotifyService.ts`). Jika `Spotify.exe` mati dan tidak ada sesi media aktif lain, seluruh state media wajib di-reset total (`title: ""`, `is_playing: false`).
- **High-Precision Synced Lyrics Engine & Proportional Unsynced Scroll (`lyricsService.ts`, `playbackClock.ts`):** Scoring LRCLIB memprioritaskan kecocokan durasi studio ($\pm 1.5$ detik -> `+15000`, selisih $> 3$ detik -> `-20000`) dan menghindari LRC MV yang terlambat masuk vokal; satu interpolator `playbackClock` tunggal menyelaraskan lirik Mode 6 dan Idle (`reanchorMediaPlaybackClock`), sementara lirik polos menampilkan badge `Unsynced` bergulir proporsional dengan jeda *wheel* 4 detik.
- **Timer → To-Do Auto-Check, Guard & Persistensi Antar-Sesi:** Daftar To-Do awal kosong (`[]`) tanpa tugas contoh dan otomatis dipersistensikan ke `localStorage` (`casa_todo_items_v1`) dengan validasi `focusedTaskId` saat startup. Saat timer terhubung ke tugas selesai (`isAlarmRinging`), banner menampilkan **`Selesai`** (mencentang tugas + mematikan alarm + reset preset), **`+5m`**, dan **`Dismiss`** (menjaga status tugas tetap belum selesai); mencentang/menghapus tugas lebih dulu otomatis melepas tautan timer.

### 2.2 Sistem Tema Adaptif & Kepatuhan Monokrom Murni
- **Sumber Kebenaran Tema:** `CASA_THEME_PALETTES` pada [useSettingsStore.ts](../src/stores/useSettingsStore.ts) (`useSyncExternalStore` + `localStorage.casa_settings_v1`):
  1. **`default`:** Amber Focus (`#F59E0B`), Emerald Rest (`#10B981`), Cyan Audio (`#38BDF8`), Fuchsia CPU (`#E879F9`), Purple RAM (`#A855F7`).
  2. **`monochrome` (Stealth OLED):** **100% monokrom murni** (`#FFFFFF`, `#E4E4E7`, `#A1A1AA`, `#71717A`) di seluruh komponen—termasuk ikon output audio (`Speaker` / `Headphones` / `Bluetooth` di `Mode6ControlCenterView.tsx`), **Circular Battery Ring** (`BatteryPill.tsx`), garis batas Fokus, indikator Wi-Fi/BT, dan pratinjau Settings—tanpa kebocoran warna statis (`green`/`emerald`/`amber` hardcoded).
  3. **`colorblind` (Okabe-Ito):** Palet ramah deuteranopia/protanopia.

### 2.3 Jendela Settings, `Quit CASA` & System Tray
- **Settings Window (`DesktopSettingsWindow.tsx`):** Menyediakan 5 tab (*Appearance*, *Island & Behavior*, *Timer & Audio*, **`Ibadah & Lokasi`**, *System & Updates*) dengan kartu pratinjau *live notch*, *swatches* tema OLED anti-slop, manajemen *Launch at Startup*, *Global Shortcut `Alt+Space`*, indikator notifikasi badge `1` real-time dari pengecekan senyap `ETag` GitHub Releases (`update_monitor.rs`), dan panel **OTA Signed Auto-Updater**.
- **Tombol `Quit CASA` di Sidebar Settings:** Memanggil command IPC `quit_app` (`tauriBridge.ts` -> `src-tauri/src/lib.rs`) yang wajib mengeksekusi `app.global_shortcut().unregister_all()` sebelum `app.exit(0)` agar proses aplikasi dan shortcut OS bersih seketika.
- **System Tray Menu (Bahasa Inggris Seragam):**
  - `Show / Hide CASA` (`toggle_visibility`)
  - `Gaming Mode: Auto` (`toggle_gaming`)
  - `Quit CASA` (`quit` — ikut membebaskan global shortcut sebelum keluar)

### 2.4 Modul Pengingat Ibadah (`v2.1.0`, Opt-In Default OFF)
- **Aktivasi & Navigasi 5 Tab (`Mode6TopNav.tsx`):** Default nonaktif (`ibadah.enabled = false`) sehingga bar navigasi tetap 4 tab dan tidak ada scheduler latar belakang. Saat diaktifkan, muncul tab ke-5 **`Ibadah`** pada header `flex justify-between` dengan lebar kapsul adaptif (`540–560px`) serta panel `IbadahExpandedView.tsx` Pure Monochrome OLED berupa **kurva parabola matahari/bintang jatuh SVG** (Subuh → Dzuhur zenith → Ashar → Maghrib horizon → Isya malam) lengkap dengan orb real-time, 5 kolom label sejajar, dan shortcut deep-link ke sidebar Settings **`Ibadah & Lokasi`**.
- **Deteksi Lokasi & Kalkulasi Offline (`src-tauri/src/prayer.rs`):**
  - Jalur 1: API lokasi bawaan Windows (`Windows.Devices.Geolocation`) dengan timeout 7 detik, fallback pesan ramah, dan tombol pintasan aman ke `ms-settings:privacy-location`.
  - Jalur 2: Pencarian kota manual via Rust `reqwest` (Open-Meteo Geocoding API tanpa melonggarkan CSP WebView) yang menyimpan koordinat + `countryCode` lokal.
  - Perhitungan astronomi 100% offline berbasis crate `salah` + `chrono::Local` (mengikuti zona waktu aktif Windows, otomatis rollover pasca-Isya ke Subuh H+1, auto-map standar hisab per negara `ID`→Kemenag RI / `MY`→JAKIM / `SG`→MUIS / `SA/AE`→Umm al-Qura / `US/CA`→ISNA / lainnya→MWL, mazhab `Syafi'i | Hanafi`, serta koreksi `±` menit).
- **Audio Lazy Dual-Path `0 MB` Idle RAM (`prayerAudio.ts`):** Pilihan **`Adzan Penuh` | `Chime Singkat` | `Visual Saja`** dengan tombol uji terpisah (**`Test Adzan`** & **`Test Subuh`**) di Settings `Ibadah & Lokasi`. Khusus waktu **Subuh**, mode Adzan memuat `public/audio/adzan-subuh.ogg` secara *lazy* dengan *graceful fallback* ke `public/audio/adzan.ogg`, lalu `playChimeCue` bila keduanya belum tersedia; untuk **Dzuhur, Ashar, Maghrib, dan Isya** langsung memuat `public/audio/adzan.ogg` (fallback ke `playChimeCue`). Referensi elemen `Audio` dilepas penuh pada setiap fallback, `Stop`, maupun `ended`.
- **Perilaku `T-0`, Fullscreen & Konflik Timer (`prayerStore.ts`, `CasaIsland.tsx`):**
  - **Pil Notifikasi Ringkas T-0 & Pemulihan State:** Menampilkan ekspresi mata Bintang & Bulan (**`✦ ☾`** pada `CasaCompanionAvatar` `'prayer'`), teks ringkas **`Adzan <Sholat>`** + jam tabular + 4 bar equalizer monokrom + tombol **`Stop`** (atau **`Tutup`** pada mode Visual Saja), efek getar mikro 600ms, *breathing border glow*, serta `hoverExpandLocked` penuh. Usai `Stop` / audio selesai: jendela tetap mekar jika sebelumnya berada di **Mode 6 Expanded**, kembali ke **`idle`** normal pada desktop biasa (bukan langsung minimize), dan hanya otomatis kembali ke **`tucked`** saat sedang **Fullscreen / Gaming (`smart-tuck`)**.
  - **Fullscreen `total-hide` (Opsi B):** Menjaga layar benar-benar bersih tanpa memunculkan visual pil; hanya memutar audio (Adzan/Chime), sedangkan mode `Visual Saja` ditahan hingga keluar fullscreen dalam grace window 5 menit.
  - **Mode 6 Expanded (Tab Lain Terbuka):** Tidak memaksa pindah tab; menampilkan banner tipis 28px di bawah header navigasi lengkap dengan tombol **`Stop`**.
  - **Prioritas Konflik Adzan > Timer:** Saat bersamaan dengan alarm Focus Timer, Adzan langsung mengambil alih prioritas dan mematikan loop suara Timer secara senyap sambil menjaga status selesai & aksi To-Do tertaut agar tetap tampil tepat setelah Adzan dihentikan.
  - **Sleep / Hibernate Wake Catch-Up:** Evaluasi berbasis *wall-clock* epoch dengan grace window 5 menit, deduplikasi `YYYY-MM-DD:prayer`, dan penekanan otomatis jika waktu sholat sudah terlewat lama.

### 2.5 Native Window, Hitbox 50Hz & Telemetry Perangkat Keras
- **Kanvas Tetap Anti-Resize Hitch:** Window utama terkunci di ukuran logis **`1100×340`** (`LogicalSize`), posisinya dihitung aware DPI melalui `position_window_top` + Win32 `SetWindowPos` (`WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW`, menghapus `WS_EX_TRANSPARENT` statis).
- **Dynamic Multi-Rect Hitbox Poller (`hitbox.rs` & `islandLayoutState.ts`):** Polling adaptif 60Hz/50Hz membandingkan posisi kursor terhadap maksimal 6 `HitRect` aktif (`update_island_hitboxes`), mengatur `WS_EX_TRANSPARENT` secara real-time di luar area kapsul, menjembatani celah *top offset* `12 px` pada Floating Mode (`tucked`/`peek`/`idle`) disertai hysteresis `220 ms`, dan mengisolasi drag-out native (`native_drag_drop_files` via `CF_HDROP` serta `native_drag_drop_text` via `CF_UNICODETEXT` + `CF_TEXT`, `DRAGDROP_S_DROP` & `DROPEFFECT_COPY`) agar item Drop Zone hanya terhapus jika drop ke aplikasi eksternal sukses.
- **Resting, Smart-Tuck & Dropzone 2.0 + Connect HP (`useDropZoneStore.ts`, `drop_zone.rs`, `connect_hp.rs`):** Kapsul kompak **`× ♥`** (`W=126px` di web / `IDLE_MIN_AWAKE_WIDTH: 180` & `TUCKED_HEIGHT: 4px` Smart-Tuck), Circular Battery Ring SVG, perimeter stroke To-Do Focus, HUD real-time Volume/Brightness/Bluetooth (`system_hardware.rs`), CPU/RAM (`system_stats.rs`), **Dropzone 2.0 Ephemeral** (`dragDropEnabled: false`, Smart Drag-In teks/link/file + **Drag-In & Drag-Out Folder** rekursif `webkitGetAsEntry`/`readEntries` → `Downloads\CASA Drop` & `CF_HDROP`, `Ctrl+V` eksplisit, `+ File` / `+ Folder` native via `IFileOpenDialog`, sanitasi HTML/URI, drag-out `CF_HDROP` & `CF_UNICODETEXT` + Undo 4 detik), serta **Connect HP (`v2.3.0`)** berbasis server `axum` + WebSocket sementara dengan QR Code SVG, transfer LAN dua arah Wi-Fi/Hotspot (`192.168.137.1`), batch `>5` file otomatis menjadi 1 folder di `Downloads\CASA Drop`, antrean upload mobile persisten, streaming ZIP `STORE` untuk folder, dan *auto-shutdown* 10 menit idle.

---

## 3. Web Showcase (`docs/`) — Paritas 1:1 & Komunitas

- **URL Produksi:** `https://farhanpratama09.github.io/casa-app/`
- **Estetika & Paritas Native 1:1:** Pure Monochrome OLED (`#000000` canvas, `#09090b` surface, hairline `rgba(255,255,255,0.08)`). Monitor Virtual (`#virtual-monitor`) mereplikasi 1:1 anatomi kapsul native (bahu cekung atas, intro `"Hi."` Obsidian Bunny -> pil kompak `× ♥`, *Resting & Wake*, *Mode 6 `Player | Playlists`* + pop-up `QUEUE` kanan, *Idle Lyric Minimize*, *Focus Ring & Dual-Idle*, *HUD Brightness slider* yang meredupkan layar virtual, *Drop Zone 2.0 Shelf* dengan kartu file/link/teks, `Paste` / `Ctrl+V`, pod kanan **Connect HP** (`QR`, pemilih Wi-Fi/Hotspot `192.168.137.1`, & simulasi kirim dari HP), & *Copy Back to Desktop*, serta *Pengingat Ibadah* opt-in 5 tab kurva parabola SVG & simulasi pil `T-0` `✦ ☾`).
- **Navigasi Clean Path Tanpa `#`:** Menggunakan `History API` (`pushState` / `replaceState`) untuk `/casa-app/`, `/casa-app/playground`, `/casa-app/arsitektur`, `/casa-app/unduh`, `/casa-app/feedback` (+ alias `/casa-app/discussions`) disertai pemulihan SPA lewat [404.html](./404.html).
- **Smart Download Counter & Cooldown:**
  - `initSmartReleaseHub()` mengambil statistik dari GitHub Releases API, menjumlahkan khusus biner installer (`.exe` dan `.msi`; mengecualikan `.sig` & `latest.json`), menyimpannya pada `localStorage` (`casa_dl_count_cache`) selama **15 menit** (`DL_CACHE_TTL_MS`), dan sembunyi anggun bila offline.
  - Tombol unduh utama `#primary-download-btn` berlabel ringkas **`Download CASA for Windows`**, dengan versi dan ukuran pada subteks monospace `#download-size-text` (`v2.3.0 · NSIS Setup (.exe)`), serta **cooldown 6 detik** (`DL_COOLDOWN_MS = 6000`).
- **Ratings & Reviews Ala Play Store (`#feedback`, Supabase + Telegram Moderation):**
  - Bagian `#feedback` menampilkan ringkasan skor rata-rata & 5 progress bar distribusi bintang, filter rating (`All`, `5 ★`..`1 ★`) + sort (`Newest`, `Highest`, `Lowest`), form tulis ulasan tanpa login (star picker `1–5`, Name max 40 char, Review `3–500` char, honeypot `website_hp`, `elapsed_ms`), dan balasan resmi **`Creator`**, disertai satu tautan ke **GitHub Discussions** (`https://github.com/Farhanpratama09/casa-app/discussions`).
  - **Arsitektur Database & Keamanan (`supabase/`):**
    - Tabel `casa_reviews` (`pending | approved | rejected`) & `review_rate_limits` terkunci ketat oleh RLS dari akses `anon`. Publik hanya membaca view **`casa_reviews_public`** dan **`casa_review_stats`**.
    - Frontend mengirim `SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_...`) **hanya melalui header `apikey`** (tanpa `Authorization: Bearer`).
    - Edge Function **`submit-review`** memvalidasi anti-spam NFKC/zero-width/word-boundary (`spam.ts`), *honeypot* + `elapsed_ms < 2500` *silent drop*, penolakan sopan bila berisi URL, *rate limit* per HMAC-SHA256 `/64` IP (`2/jam`) dan batas global (`25/jam`), lalu mengirim kartu moderasi ke Telegram Admin (`[ ✅ Approve ]`, `[ 🗑️ Tolak ]`).
    - Edge Function **`telegram-webhook`** memverifikasi `X-Telegram-Bot-Api-Secret-Token` (*constant-time*, *fail-closed*) serta `from.id` + `chat.id`, menangani soft-reject `'rejected'`, dan menyimpan Telegram `Reply` menjadi `creator_reply` (auto-approve).
  - **Content Security Policy (CSP) di `docs/index.html`:** Wajib mengunci `script-src 'self'`, `frame-src 'none'`, `form-action 'self'`, `img-src 'self' data:`, dan `connect-src 'self' https://api.github.com https://ivlyujaafwqziogajjtk.supabase.co` tanpa `'unsafe-inline'` pada `script-src`.

---

## 4. Security, Licensing & Signed Release SOP

1. **Lisensi:** MIT License ([LICENSE](../LICENSE)) atas nama Farhan Pratama (2026).
2. **Hygiene Git & Proteksi Rahasia:**
   - [.gitignore](../.gitignore) wajib memblokir `.env*` (kecuali `!.env.example`), **`*.key`**, **`*.pem`**, `node_modules/`, `dist/`, dan `src-tauri/target/`.
   - Dilarang menyematkan `SPOTIFY_CLIENT_SECRET` fallback atau token (`ghp_`, `github_pat_`, Minisign private key) di kode maupun mencetak nilai token ke log/terminal. (`SPOTIFY_CLIENT_SECRET` di kode fallback ke `''`).
3. **Alur Rilis Bertanda Tangan Minisign:**
   - Build Windows NSIS/MSI bertanda tangan (`tauri build` menghasilkan `.exe`, `.msi`, `.exe.sig`, `.msi.sig`).
   - Susun manifest OTA `latest.json` (kunci `windows-x86_64` dengan `signature` dari `.sig` & `url` ke asset GitHub Release).
   - Hitung ukuran `MB` dan hash `SHA-256` installer terbaru lalu perbarui `#download` (`docs/index.html`) dan skrip verifikasi sebelum publish/tag.
4. **Checklist Gate Wajib Sebelum `git push`:**
   - `npx tsc --noEmit` (0 error)
   - `npm run build` (0 error)
   - `cargo check --manifest-path src-tauri/Cargo.toml` (0 error)
   - `node scripts/verify-docs-showcase.mjs` (seluruh asersi Desktop & Mobile 0 gagal, CSP=0)
