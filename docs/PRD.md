# Product Requirements Document (PRD) — CASA `v2.0.3`

**CASA — Dynamic Rabbit Island for Windows** (`com.farhanpratama.casa`)  
Ambient Desktop Notch, Media Companion & Hardware Telemetry Island (Tauri v2 + Rust + React 19 + TypeScript + Vite)  
**Lisensi:** MIT License ([LICENSE](../LICENSE)) — Copyright © 2026 Farhan Pratama

---

## 1. Identitas & Filosofi Produk
- **Nama Produk:** CASA (*Dynamic Rabbit Island for Windows*)
- **Versi Acuan:** `2.0.3` (tersinkron di [package.json](../package.json), [Cargo.toml](../src-tauri/Cargo.toml), [tauri.conf.json](../src-tauri/tauri.conf.json), sidebar Settings, dan [docs/index.html](./index.html))
- **Konsep Inti:** Kapsul *top-flush Dynamic Island* berlatar OLED hitam murni (`#000000`) di tepi atas monitor Windows 10/11 yang hening (*non-intrusive*, `WS_EX_NOACTIVATE`), menyatukan pemutar musik & lirik sinkron milidetik, *Focus Timer & To-Do Ring*, kontrol cepat sistem, *Drag & Drop Shelf*, dan ekspresi maskot **Obsidian Bunny** (`× ♥`).

---

## 2. Arsitektur & Spesifikasi Desktop (`src/` & `src-tauri/`)

### 2.1 Mode 6 Musik, Sub-Navigasi & Pop-up `QUEUE`
- **Navigasi Sub-Tab:** Menggunakan tepat **2 sub-tab utama** bertajuk **`Player | Playlists`** pada bar kontrol musik (`Mode6MusicLayout.tsx`) — tanpa tab `Queue` redundan pada sub-navigasi.
- **Pop-up Satelit Kanan `QUEUE`:** Dipicu oleh tombol ikon ke-4 pada kontrol `Player`, menampilkan kartu satelit sebelah kanan (`width: 204px`, celah `10px` dari kapsul utama) dengan header monospace ringkas **`QUEUE`** + jumlah antrean.
- **Search Drawer & Playlist Popover:** Kartu satelit kiri (*Search CASA Player*) wajib mengunci popover `SAVE TO PLAYLIST` (`AddToPlaylistPopover`) di dalam batas horizontal & vertikal drawer (`searchDrawerBounds`) dan melaporkannya lewat `update_island_hitboxes` agar terbebas dari *click-through* Windows.
- **Context-Aware Queue Playback & Instant Invalidation:**
  - Konteks `:playlist:` / `:album:` mengirim `{ context_uri, offset: { uri } }`.
  - Konteks non-playlist (Search / Artist / CASA Player) wajib mengirim `{ uris: [clickedUri, ...nextUris] }` tanpa `offset`.
  - Saat berpindah lagu/konteks, state `queue` lama segera diinvalidasi (`request counter` / `AbortController`).
- **Hybrid Media & Lifecycle State:** Menggabungkan Windows GSMTC (`src-tauri/src/media/gsmtc.rs`) dan Spotify Web API (`src/utils/spotifyService.ts`). Jika `Spotify.exe` mati dan tidak ada sesi media aktif lain, seluruh state media wajib di-reset total (`title: ""`, `is_playing: false`).
- **High-Precision Synced Lyrics Engine (`lyricsService.ts`):** Scoring LRCLIB memprioritaskan kecocokan durasi studio ($\pm 1.5$ detik -> `+15000`, selisih $> 3$ detik -> `-20000`) dan menghindari LRC MV yang terlambat masuk vokal.

### 2.2 Sistem Tema Adaptif & Kepatuhan Monokrom Murni
- **Sumber Kebenaran Tema:** `CASA_THEME_PALETTES` pada [useSettingsStore.ts](../src/stores/useSettingsStore.ts) (`useSyncExternalStore` + `localStorage.casa_settings_v1`):
  1. **`default`:** Amber Focus (`#F59E0B`), Emerald Rest (`#10B981`), Cyan Audio (`#38BDF8`), Fuchsia CPU (`#E879F9`), Purple RAM (`#A855F7`).
  2. **`monochrome` (Stealth OLED):** **100% monokrom murni** (`#FFFFFF`, `#E4E4E7`, `#A1A1AA`, `#71717A`) di seluruh komponen—termasuk ikon output audio (`Speaker` / `Headphones` / `Bluetooth` di `Mode6ControlCenterView.tsx`), **Circular Battery Ring** (`BatteryPill.tsx`), garis batas Fokus, indikator Wi-Fi/BT, dan pratinjau Settings—tanpa kebocoran warna statis (`green`/`emerald`/`amber` hardcoded).
  3. **`colorblind` (Okabe-Ito):** Palet ramah deuteranopia/protanopia.

### 2.3 Jendela Settings, `Quit CASA` & System Tray
- **Settings Window (`DesktopSettingsWindow.tsx`):** Menyediakan 4 tab (*Appearance & Themes*, *Island & Behavior*, *Timer & Audio*, *System & Updates*) dengan kartu pratinjau *live notch*, *swatches* tema OLED anti-slop, manajemen *Launch at Startup*, *Global Shortcut `Alt+Space`*, dan panel **OTA Signed Auto-Updater**.
- **Tombol `Quit CASA` di Sidebar Settings:** Memanggil command IPC `quit_app` (`tauriBridge.ts` -> `src-tauri/src/lib.rs`) yang wajib mengeksekusi `app.global_shortcut().unregister_all()` sebelum `app.exit(0)` agar proses aplikasi dan shortcut OS bersih seketika.
- **System Tray Menu (Bahasa Inggris Seragam):**
  - `Show / Hide CASA` (`toggle_visibility`)
  - `Gaming Mode: Auto` (`toggle_gaming`)
  - `Quit CASA` (`quit` — ikut membebaskan global shortcut sebelum keluar)

### 2.4 Native Window, Hitbox 50Hz & Telemetry Perangkat Keras
- **Kanvas Tetap Anti-Resize Hitch:** Window utama terkunci di ukuran logis **`1100×340`** (`LogicalSize`), posisinya dihitung aware DPI melalui `position_window_top` + Win32 `SetWindowPos` (`WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW`, menghapus `WS_EX_TRANSPARENT` statis).
- **Dynamic Multi-Rect Hitbox Poller (`hitbox.rs`):** Polling 50Hz membandingkan posisi kursor terhadap maksimal 6 `HitRect` aktif (`update_island_hitboxes`), mengatur `WS_EX_TRANSPARENT` secara real-time di luar area kapsul, pod kiri/kanan, dan pop-up.
- **Resting, Smart-Tuck & HUD:** Kapsul kompak **`× ♥`** (`W=126px` di web / `IDLE_MIN_AWAKE_WIDTH: 180` & `TUCKED_HEIGHT: 4px` Smart-Tuck), Circular Battery Ring SVG, perimeter stroke To-Do Focus, HUD real-time Volume/Brightness/Bluetooth (`system_hardware.rs`), CPU/RAM (`system_stats.rs`), serta Drop Zone Shelf (`drop_zone.rs`).

---

## 3. Web Showcase (`docs/`) — Paritas 1:1 & Komunitas

- **URL Produksi:** `https://farhanpratama09.github.io/casa-app/`
- **Estetika & Paritas Native 1:1:** Pure Monochrome OLED (`#000000` canvas, `#09090b` surface, hairline `rgba(255,255,255,0.08)`). Monitor Virtual (`#virtual-monitor`) mereplikasi 1:1 anatomi kapsul native (bahu cekung atas, intro `"Hi."` Obsidian Bunny -> pil kompak `× ♥`, *Resting & Wake*, *Mode 6 `Player | Playlists`* + pop-up `QUEUE` kanan, *Idle Lyric Minimize*, *Focus Ring & Dual-Idle*, *HUD Brightness slider* yang meredupkan layar virtual, serta *Drop Zone Shelf* dengan *Copy Back to Desktop*).
- **Navigasi Clean Path Tanpa `#`:** Menggunakan `History API` (`pushState` / `replaceState`) untuk `/casa-app/`, `/casa-app/playground`, `/casa-app/arsitektur`, `/casa-app/unduh`, `/casa-app/feedback` (+ alias `/casa-app/discussions`) disertai pemulihan SPA lewat [404.html](./404.html).
- **Smart Download Counter & Cooldown:**
  - `initSmartReleaseHub()` mengambil statistik dari GitHub Releases API, menjumlahkan khusus biner installer (`.exe` dan `.msi`; mengecualikan `.sig` & `latest.json`), menyimpannya pada `localStorage` (`casa_dl_count_cache`) selama **15 menit** (`DL_CACHE_TTL_MS`), dan sembunyi anggun bila offline.
  - Tombol unduh utama `#primary-download-btn` berlabel ringkas **`Download CASA for Windows`**, dengan versi dan ukuran pada subteks monospace `#download-size-text` (`v2.0.3 · NSIS Setup (.exe) · 4.43 MB`), serta **cooldown 6 detik** (`DL_COOLDOWN_MS = 6000`).
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
