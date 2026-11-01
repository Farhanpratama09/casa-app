# CASA_CONTEXT.md — Single Source of Truth

> Dibuat dari kode nyata di `src/` dan `src-tauri/` (bukan asumsi). Jika kode berubah, perbarui file ini.
> CASA = *Context Aware System Assistant* — widget "dynamic island" di bezel atas layar Windows.

---

## 1. Project Overview & Tech Stack

| Aspek | Detail |
|---|---|
| Form factor | Jendela Tauri transparan, tanpa dekorasi, `alwaysOnTop`, `skipTaskbar`, `shadow:false`, dipusatkan di tepi atas monitor aktif |
| Identifier / versi | `com.crimson.casa` / `0.1.0` (`tauri.conf.json`) |
| Window awal | 700×38 (kanvas native selalu 700 px lebar; tinggi diubah dinamis lewat IPC) |
| Frontend | React 19, TypeScript 5.7 (`strict`), Vite 6 (dev `127.0.0.1:1420`), Tailwind 3.4, framer-motion 12, zustand 5, lucide-react |
| Backend | Rust (edition 2021), Tauri 2.2 (`tray-icon`), tokio, reqwest 0.13, serde |
| Windows API | crate `windows` 0.62 (`Media_Control`, `Storage_Streams`, `Foundation`) untuk GSMTC; `windows-sys` 0.59 untuk Win32 (SetWindowPos, Toolhelp, dll) |
| Lainnya | `base64` 0.22 (thumbnail), MD5 pure-Rust buatan sendiri (session id) |
| Eksternal | LRCLIB (`lrclib.net/api/search`) untuk lirik; Spotify Web API (OAuth loopback `127.0.0.1:8888`) |
| Test | Script di `scripts/verify-*.ts` (time-sync isolation, browser sanitizer, cold-queue, cover-art, lyrics, dll). Tidak ada `npm test`. |
| Cek wajib | `cargo check --manifest-path src-tauri/Cargo.toml` dan `npx tsc --noEmit` |

**Filosofi:** asisten hening yang sadar konteks sistem (audio playback, fokus, hardware, idle). Hanya muncul saat relevan, tidak mencuri fokus (`WS_EX_NOACTIVATE`).

> ⚠️ Catatan keamanan: `spotifyService.ts` punya *fallback hardcoded* `SPOTIFY_CLIENT_ID/SECRET` bila `VITE_SPOTIFY_*` tidak ada di `.env`. Pertimbangkan dihapus dan merotasi kredensial.

---

## 2. Peta Folder & Penjelasan File

```
asaverse/
├─ CASA_CONTEXT.md        ← file ini
├─ docs/PRD.md            product requirement
├─ scripts/               verify-*.ts (regresi manual), stress loop JS
├─ .env(.example)         SPOTIFY_* & VITE_SPOTIFY_*
├─ tailwind.config.js     warna `island.*`, font sans, shadow `island`
├─ vite.config.ts         port 1420 strict, ignore src-tauri watch
├─ src-tauri/
│  ├─ tauri.conf.json     window 700x38 transparan
│  ├─ capabilities/default.json   izin window (drag, hide/show, ignore-cursor)
│  └─ src/
│     ├─ main.rs          entry → casa_lib::run()
│     ├─ lib.rs           window mgmt, tray, command umum, daftar invoke_handler
│     ├─ spotify_oauth.rs OAuth loopback :8888 (start_spotify_login, refresh_spotify_user_token)
│     └─ media/
│        ├─ mod.rs        router IPC command media (timeout + spawn_blocking)
│        ├─ types.rs      MediaSessionSummary, MediaUpdatePayload
│        ├─ gsmtc.rs      inti GSMTC: MD5 id, klasifikasi app, STICKY_SESSION, daemon telemetry
│        └─ providers/spotify_win32.rs  deteksi proses Spotify (Toolhelp), launch/quit/focus/minimize, URI play
└─ src/
   ├─ main.tsx / App.tsx  mount; App memegang `mode` (IslandMode), Esc → idle, F2/Ctrl+Shift+D → DevTriggerBar
   ├─ index.css           base transparan, scrollbar disembunyikan global, util marquee/lyrics mask
   ├─ types/island.ts     IslandMode, IslandState, SongMetadata, MediaSessionItem, TimerState, TodoItem
   ├─ components/
   │  ├─ CasaIsland.tsx   FSM island, ukuran jendela, wheel→ganti modul, click-outside, file drop
   │  ├─ shell/IslandSkillSlot.tsx   render slot skill (pill / bubble)
   │  └─ views/           MusicCardView (±3000 baris), TimerCardView, TodoCardView, IdlePillView,
   │                      MicroStatusHeader, CompactStripView, DropZoneView, DevTriggerBar
   ├─ skills/             Universal Skills Engine
   │  ├─ types.ts         CasaSkill, slots, SkillPriorityTier + PRIORITY_WEIGHTS
   │  ├─ registry.ts      SkillRegistry (singleton)
   │  ├─ store.ts         zustand `useSkillStore`: skillStates, arbitrase prioritas, cycleActiveSkill
   │  ├─ index.ts         initializeSkillsEngine()
   │  ├─ media/MediaSkill.tsx    skill media: listener event, sinkron waktu, lirik, kontrol skip
   │  ├─ timer/timerSkill.tsx    Pomodoro 25/5, ticker 1s, chime (builtin/timerSkill.tsx = re-export)
   │  └─ builtin/todoSkill.tsx   checklist (prioritas selalu `idle`)
   ├─ features/
   │  ├─ skillsRegistry.ts       ACTIVE_SKILL_MODULES: core.media, core.timer, core.todo (urutan siklus)
   │  ├─ media/useMediaPlayback.ts   hook aksi (togglePlay/next/prev/subpanel/lirik)
   │  ├─ media/MediaExpandedView.tsx jembatan state → MusicCardView
   │  ├─ media/MediaPillSlot.tsx, types.ts
   │  └─ timer/, todo/           *PillSlot, *ExpandedView, use*State, types
   └─ utils/
      ├─ tauriBridge.ts   semua `invoke()` + `playChimeCue` (WebAudio)
      ├─ spotifyService.ts  Web API (token, search, queue, playlist, like, play, seek, shuffle) — ±1400 baris
      ├─ lyricsService.ts   LRCLIB fetch + scoring kandidat + parseLrc + getActiveLyrics
      └─ islandStressTester.ts  hook stress test transisi island
```

---

## 3. Logika Backend & Integrasi Sistem

### 3.1 Window (`lib.rs`)
- `center_window_top(window, w, h)`: hitung posisi tengah-atas monitor DPI-aware, pakai `SetWindowPos` (`SWP_NOACTIVATE|SWP_NOZORDER`); skip jika rect sama.
- `apply_win32_window_styles`: **hapus** `WS_EX_TRANSPARENT` (penyebab click deadlock), **tambah** `WS_EX_NOACTIVATE` + `WS_EX_TOOLWINDOW`.
- Setup: window ke 440×38 lalu frontend mengunci lebar 700; tray (Tampilkan/Sembunyikan, Mode Gaming, Keluar); start `media::windows_media::start_telemetry_daemon`.

### 3.2 Command IPC terdaftar (`invoke_handler`)
`set_ignore_cursor_events`, `get_system_metrics` (mock), `toggle_gaming_mode`, `focus_island_window`, `adjust_window_size`,
`media_play_pause`, `media_next_track`, `media_prev_track`, `control_media_session(session_id, action)`, `quick_swap_session(target_session_id, pause_current)`, `get_current_media`,
`spotify_play_track`, `spotify_play_uri_stealth`, `minimize_spotify_stealth`, `is_spotify_running`, `ensure_spotify_running_silent`, `focus_spotify_window`, `launch_spotify_process_clean`, `quit_spotify_app`,
`start_spotify_login`, `refresh_spotify_user_token`.
Command media dibungkus `tokio::time::timeout` (800 ms; swap 1200 ms) + `spawn_blocking` agar COM tidak membekukan UI.

### 3.3 Event Tauri → Frontend
| Event | Payload | Kapan |
|---|---|---|
| `media-update` | `MediaUpdatePayload` | Meta berubah, drift posisi >3 s, atau heartbeat 5 s (poll 500 ms) |
| `media-session-closed` | `{}` | Sesi hilang (debounce 2500 ms) / Spotify mati |
| `spotify-closed` / `spotify-opened` | `{running, timestamp?}` | Transisi proses Spotify |
| `gaming-mode-changed`, `tray-toggle-gaming` | bool / () | Mode gaming / tray |

`MediaUpdatePayload`: `session_id, title, artist, is_playing, position, duration, album_art (data:image/jpeg;base64), is_shuffle, source_app, is_browser, is_spotify, active_sessions: MediaSessionSummary[]`.
`MediaSessionSummary`: `session_id, app_name, browser_type, title, artist, is_playing`.

### 3.4 GSMTC & Session Tracking (`gsmtc.rs`)
- **Session ID** = `MD5("{AUMID}_{title}")` (trim). Membedakan tab browser dari proses induk sama. *Konsekuensi: ID berubah saat judul berubah* (ditangani via `same_app_match`).
- `classify_source_app(AUMID)` → `(app_name, browser_type, is_browser, is_spotify)`: Spotify, Brave, Edge, Chrome, Firefox, Opera, Vivaldi, fallback nama dari AUMID.
- `extract_session_summary` menolak: Spotify saat proses mati, status `Closed`/`Stopped`, judul & artis kosong.
- **`STICKY_SESSION`** (static Mutex) — hierarki prioritas di `select_primary_session`:
  1. Sticky `PLAYING` → tetap dikunci (id diperbarui bila track berubah di app sama).
  2. Sticky `PAUSED` **dan ada sesi lain `PLAYING`** → lepas kunci, pindah ke sesi playing (Active Playback Precedence).
  3. Sticky `PAUSED` dan tidak ada yang playing → tetap sticky (anti-snap ke Spotify saat pause).
  4. Sticky hilang dari OS → kosongkan; fallback: sesi playing pertama → `GetCurrentSession` → sesi valid pertama.
- `control_media_session_sync(session_id, action)`: cari sesi by id (fallback primary). Aksi: `play` (juga set sticky), `pause`, `stop`, `next|skip_next`, `prev|previous|skip_previous`, default = toggle.
- `quick_swap_session_sync`: kunci sticky ke target, opsional pause semua sesi playing lain, lalu `TryPlayAsync` target.
- `fetch_current_media_state`: sesi primer + posisi/durasi (TimelineProperties) + thumbnail base64 + `active_sessions` (primer dulu, dedupe by id).
- **Daemon** (`start_telemetry_daemon`): poll 500 ms, `spawn_blocking` timeout 800 ms. Menghapus `album_art` bila judul berubah tapi art identik (cegah art basi). Spotify mati & sesi aktif Spotify → emit payload kosong + `media-session-closed` + `spotify-closed`.
- `get_current_media` mengembalikan `None` bila sesi Spotify, proses Spotify mati, dan tidak playing.

---

## 4. Arsitektur Frontend & State Management

### 4.1 Skills Engine
- `CasaSkill<TState>`: `manifest`, `dimensions`, `slots {PillTeaser, BubbleTeaser, ExpandedCard, ...}`, `initialState`, `getPriority(state)`, `onMount(getState,setState)`.
- Prioritas: `idle 0 < ambient 10 < active 50 < alert 80 < critical 100`. `alert` selalu merebut primary; selain itu pilihan user (`userSelectedSkillId`) dipertahankan.
- Media: `ambient` jika `isPlaying` & ada judul, selain itu `idle`. Timer: `alert` saat ≤1 s, `active` jika jalan, `ambient` jika pause. Todo: selalu `idle`.
- State semua skill di `useSkillStore.skillStates[skillId]`; `updateSkillState` memanggil `recalculateArbitration`.

### 4.2 Alur data media
`gsmtc.rs` → event `media-update` → listener di `MediaSkill.onMount` → `setState` store → `useMediaPlayback()` / `MediaExpandedView` → `MusicCardView` (props).

**State `MediaSkillState`:** `song (SongMetadata)`, `hasNativeMedia`, `isShuffle`, `activeSubPanel` (`none|lyrics|search|queue|playlist`, persist `localStorage.casa_active_subpanel`), `audioOutput`, `lyricsData`, `isSpotifyRunning`, `is_browser`, `session_id`, `active_sessions`.

### 4.3 Aturan emas listener `media-update` (`MediaSkill.tsx`)
1. **Payload kosong** (title kosong) → reset total state.
2. **Browser:** abaikan update iklan (`/advertisement|sponsored|^iklan\b/i`); bersihkan akhiran ` - YouTube` / ` - YouTube Music`.
3. **Sticky di frontend:** jika `session_id` payload ≠ state dan sesi lama masih ada di `active_sessions`, update hanya `active_sessions`/`isPlaying` kecuali: (a) target adalah `getLastManualTargetSessionId()` (klik user), atau (b) payload `is_playing` sementara sesi lama tidak playing → boleh pindah.
4. **`trackChanged`** = source switched ∨ session switched ∨ judul/artis beda → abort & fetch lirik baru (`AbortController`), reset lirik, ganti art.
5. **Isolasi waktu (`currentTime`):**
   - *Browser:* timeline Chromium tidak diperbarui saat normal → overwrite hanya jika `trackChanged` ∨ (`nativePosChanged` ∧ `|Δ|>2` ∧ `position>0`).
   - *Non-browser/Spotify:* tanpa guard 2 s; sinkron bila `trackChanged` ∨ `|Δ| ≥ 0.5`.
6. **Durasi:** browser → `round(duration)` bila >0; Spotify → pertahankan nilai terkalibrasi bila selisih ≤1 s (anti-flicker). Presisi durasi Spotify via `getCurrentlyPlayingTrackDetails()` (Web API, cocokkan judul).
7. **Ticker lokal** 1000 ms (`advancePlaybackSecond`) selama `isPlaying && hasNativeMedia`.
8. Poll `isSpotifyRunning` tiap 2 s; `spotify-closed` tidak menghapus sesi bila sedang mode browser.

### 4.4 Multi-browser / Multi-sesi
- `active_sessions` (≥2) → tombol quick swap **"Kontrol {app_name}"** (2 sesi) atau badge `⇄ +N` yang membuka popover (≥3 sesi). Popover otomatis tertutup bila sesi <3.
- Aksi popover: `quickSwapSession(id, true)` (set `lastManualTargetSessionId` + IPC), play/pause per sesi (`controlMediaSession`), "Pause Sesi Lainnya".
- Kontrol Next/Prev: `MediaSkill.ExpandedCard` memanggil `controlMediaSession(currentSessionId,'next'|'prev')` bila ada session id, jika tidak fallback `mediaNextTrack/PrevTrack`. `useMediaPlayback.togglePlay`: browser+sessionId → `controlMediaSession(...,'toggle')`, selain itu `mediaPlayPause()`; lalu optimistik flip `isPlaying`.
- Mode browser menyembunyikan: Shuffle, Search, Queue, Library, divider. Tersisa: Prev, Play/Pause, Next, Lyrics (+ Audio switcher di layout split). Sub-panel `queue` otomatis reset ke `none` saat berpindah ke browser.

### 4.5 Island FSM (`CasaIsland.tsx`)
`IslandState`: `tucked | tucked_peek | idle | idle_peek | expanded`. `IslandMode`: `idle, dual_bubble, compact_strip, expanded_music|timer|todo, drop_zone`.
- Ukuran shell (`getIslandDimensions`): tucked 180×8; idle 440×38 (dual 396×38); expanded musik/todo 700×195; timer/drop_zone 700×185. Window native selalu lebar 700 (`applyWindowSize` mengunci), `+70` tinggi bila DevTrigger tampil.
- Interaksi: wheel di island → `cycleActiveSkill` (idle) atau ganti `expanded_music→timer→todo`; mousedown di luar / `Esc` → collapse; guard transisi 500 ms (`lockTransition`); drag file Tauri → `drop_zone`; bubble sekunder (36×36) di `left: calc(50% + 210px)`.
- Konten expanded: `MicroStatusHeader` + area `flex-1` berisi view modul.

---

## 5. Kondisi UI/UX Saat Ini

- **Kanvas:** window 700 px; kartu musik `h-[162px] max-w-[700px]` di dalam shell expanded 195 px (header mikro memakai sisa tinggi). Idle pill 38 px tinggi.
- **Shell island:** `bg-neutral-900/95 backdrop-blur-md border border-white/[0.12] shadow-2xl`, radius 28 px (expanded) / 20 px (idle) / 4 px bawah (tucked); `overflow:hidden`; animasi spring `stiffness 260, damping 25, mass 0.8`.
- **Warna kustom** (`tailwind.config.js`): `island-{bg #000, secondary #8E8E93, green #30D158, orange #FF9F0A, red #FF453A, blue #0A84FF, purple #BF5AF2, pink #FF375F}`. Font: SF Pro/Inter/Geist/system-ui.
- **MusicCardView – layout 'none' (wide):** `px-6 py-2 flex flex-col justify-between h-[162px]`. Header: cover `w-[72px] h-[72px] rounded-xl`, judul `text-[17px] font-semibold`, artis `text-[13px] text-island-secondary`; badge: session switcher, tombol Spotify `32×32`. Kontrol: Prev `30×30`, Play `34×34 bg-white text-black rounded-full`, Next `30×30`, ikon sub-panel `28×28 text-white/40`.
- **Layout split (sub-panel aktif):** `px-5 py-2.5`, kolom kiri `w-[285px] border-r border-white/[0.08] pr-4 h-[152px]`, kontrol lebih kecil (Prev/Next 22, Play 26, ikon 20), panel kanan `flex-1 min-w-0 h-[152px]` (lirik / playlist / queue / search).
- **Popover multi-sesi:** `absolute inset-y-1.5 right-1.5 w-[310px] bg-neutral-900/95 backdrop-blur-md rounded-2xl border border-white/10 p-2.5 flex flex-col z-50 shadow-2xl select-none`; `onWheel`/`onClick` → `stopPropagation` (cegah ganti modul & klik tembus). List: `flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-1 my-1 pr-1 pb-2.5` + scrollbar tipis `[&::-webkit-scrollbar]:w-1`, thumb `bg-white/20` (hover `/40`). Item aktif `bg-emerald-500/15 border-emerald-500/30`; tombol "Pause Sesi Lainnya" `bg-rose-500/15 text-rose-300`.
- **Scrollbar:** global disembunyikan di `index.css`; `.island-scrollbar`/`.custom-scrollbar` = 5 px thin; `.no-scrollbar` untuk sembunyi.
- **Util CSS:** `.animate-lyrics-marquee` (10 s), `.mask-marquee`, `.mask-lyrics-vertical`, `.tabular-nums`.
- **Fallback:** `VinylDiscFallback` saat art tidak ada/gagal; pipeline art dua tingkat (CDN URL → blob GSMTC) dengan sticky buffer anti-flicker; `SpotifyClosedOverlay` (opacity 50 + blokir klik) bila tidak ada sesi & Spotify mati.
- **Aksen:** emerald untuk media/multi-sesi, `island-orange` timer, `blue-400` todo.
- **Dev:** `F2` / `Ctrl+Shift+D` menampilkan `DevTriggerBar`; `Esc` kembali idle.

---

## 6. Catatan Roadmap Mendatang

### Tema visual baru
- [ ] _(kosong — isi rencana tema di sini)_

### Shortcut browser
- [ ] _(kosong — isi rencana shortcut di sini)_

### Backlog teknis yang terlihat dari kode
- [ ] Pindahkan kredensial Spotify fallback hardcoded ke `.env` saja.
- [ ] `get_system_metrics` & `HardwareMetrics` masih mock (baterai/RAM/CPU statis).
- [ ] `SkillDimensionProfile.expanded.height` (162) tidak dipakai `CasaIsland` (nilai 185/195 hardcoded) — selaraskan.
- [ ] Pecah `MusicCardView.tsx` (±3000 baris) menjadi sub-komponen.
- [ ] Session ID berbasis judul berubah tiap ganti lagu — pertimbangkan id stabil per sesi.
