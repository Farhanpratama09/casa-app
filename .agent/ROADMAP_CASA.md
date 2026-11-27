# ROADMAP_CASA.md — Cetak Biru Pengembangan CASA Pasca-`v2.1.2`

> **Baseline Aktif:** CASA **`v2.1.2`** (`com.farhanpratama.casa`)  
> **Workspace Utama:** `d:\nextproject\asaverse`  
> **Dokumen Acuan Terkait:** [AGENTS.md](../AGENTS.md) · [CASA_CONTEXT.md](../CASA_CONTEXT.md) · [docs/PRD.md](../docs/PRD.md)

Dokumen ini menjadi sumber acuan resmi untuk eksekusi bertahap setiap pembaruan CASA setelah rilis `v2.1.2`. Setiap agen AI yang diminta mengerjakan versi tertentu wajib membaca prinsip arsitektur, rincian teknis target versi, dan aturan verifikasi di bawah ini.

---

## 1. Prinsip Arsitektur Wajib

Setiap implementasi fitur dari `v2.1.3` hingga `v2.5.0` **wajib** mematuhi lima prinsip dasar berikut:

1. **Ephemeral-First (Transit Sementara, Bukan Brankas Permanen):**
   - **Dropzone** berfungsi murni sebagai rak transit memori jangka pendek untuk memindahkan berkas, teks, atau tautan lintas aplikasi/perangkat—bukan pengelola berkas permanen. Item Dropzone dibersihkan otomatis saat berhasil dikirim ke target atau ketika aplikasi ditutup.
2. **Hemat RAM & CPU (Idle Zero-Churn):**
   - Tidak ada polling agresif, loop animasi aktif, atau thread berat yang menyala saat kapsul berada pada kondisi *Resting / Smart-Tuck* atau ketika modul fitur belum dibuka.
   - Ukuran window transparan utama dipertahankan statis di **`1100×340`** (`LogicalSize`) guna menghindari *DWM swapchain `ResizeBuffers` hitch* dan efek flicker, mengandalkan `update_island_hitboxes` + Win32 `WS_EX_TRANSPARENT` (`50Hz` hitbox poller).
3. **Server Lokal Auto-Shutdown Saat Idle:**
   - Layanan jaringan lokal sementara (seperti server HTTP/WebSocket *Connect HP* pada `v2.3.0`) hanya aktif ketika modul dibuka oleh pengguna, memakai token sesi acak sekali pakai, dan **wajib berhenti otomatis** (*auto-shutdown*) saat idle melewati batas waktu, tab ditutup, atau aplikasi keluar (`quit_app` / Tray `Quit CASA`).
4. **Privasi Data, Keamanan Memori & Sanitasi Input:**
   - Seluruh kalkulasi jadwal, papan teks, konversi lokal, dan transfer LAN diproses 100% secara lokal tanpa mengunggah isi Dropzone/clipboard pengguna ke server eksternal.
   - Konten HTML/teks drag-in wajib disanitasi terhadap injeksi skrip/HTML berbahaya; endpoint LAN wajib memakai token acak & sanitasi path file untuk mencegah *path traversal*; larangan mutlak pencetakan/penyimpanan kredensial mengacu pada [AGENTS.md § 3](../AGENTS.md) & [app-security-guard](./skills/app-security-guard/SKILL.md).
5. **Paritas Pure Monochrome & Web Showcase 1:1:**
   - Setiap perubahan visual desktop tetap patuh pada palet adaptif `CASA_THEME_PALETTES` (**0 color-leak** pada tema `monochrome`) dan disinkronkan 1:1 ke Web Showcase [docs/](../docs/index.html) sesuai [AGENTS.md § 1–2](../AGENTS.md).

---

## 2. Ringkasan Peta Versi (`v2.1.3` – `v2.5.0`)

| Versi | Nama Rilis | Fokus Utama | Status |
|---|---|---|---|
| `v2.1.2` | *Prayer T-0 Sky Perimeter & Mode 6 Update Pop-Up* | Baseline rilis stabil saat ini | `[DONE]` |
| `v2.1.3` | *Hotfix Stability — Drop-Out & Floating Pill* | Native OS drag-out (`CF_HDROP`) dengan verifikasi `DRAGDROP_S_DROP` + anti-flicker floating mode | `[DONE]` |
| `v2.1.4` | *CASA Player — Smart Queue & Search Album/Playlist* | Auto-queue relasi lagu (`videoId`/`trackId` + `artistId`), transisi playlist→Smart Queue & *session-seeded* queue, region `gl`/`hl`, kategori Top Songs, Album & Playlist, 3-mode Repeat, & hygiene RAM/binary | `[DONE]` |
| `v2.2.0` | *Dropzone 2.0 — Papan Teks Ephemeral* | Drag-in teks/link/file tanpa shortcut (`dragDropEnabled: false`), `Ctrl+V` eksplisit, sanitasi HTML/URI, `CF_UNICODETEXT`, & cleanup ephemeral | `[DONE]` |
| `v2.3.0` | *Connect HP — Zero-App Local Web Drop* | Server `axum` HTTP+WebSocket sementara, QR token CSPRNG, transfer 2 arah Wi-Fi/Hotspot (`192.168.137.1`), Drag-In & Drag-Out Folder, `+ File`/`+ Folder` native, antrean upload mobile persisten, batch >5 auto-folder, streaming ZIP `STORE`, & auto-shutdown 10m | `[DONE]` |
| `v2.3.1` | *Hotfix Android & Polish UI* | Persistensi token multi-scan & `sessionStorage` + auto-reconnect, restart sesi bersih, `Content-Length` eksak ZIP `STORE`, warna ring baterai `#22c55e`/petir `#facc15`, & strip peringatan Dropzone >25 MB non-truncate | `[DONE]` |
| `v2.3.2` | *Security Hardening & SmartScreen Guide* | Middleware Axum auth/body-limit/MOTW Connect HP, pinned SHA-256 `yt-dlp`, OAuth PKCE + DPAPI, Shell/COM hardening, capability split, `SECURITY_BASELINE.md`, & kartu panduan inline SmartScreen web showcase | `[DONE]` |
| `v2.4.0` | *Quick Calculator, Instant Converter, Hybrid 6-Tab Nav & Adaptive Wi-Fi* | Kalkulator 2-kolom keypad aman (`0 eval()`), konverter satuan & kurs real-time 163 negara (`localhost` cache 30m), navigasi 6-tab Hybrid Morphing pil kaca gelap + ikon menyala (`Kontrol` paling kanan), toggle cepat modul, ikon stopwatch Focus, mata Dropzone `◈ ♥`, & Wi-Fi Adaptive Auth/Rollback/802.1X/Captive Portal | `[DONE]` |
| `v2.5.0` | *Calendar, Smart Reminders & Smart Audio* | Kalender bulanan & CRUD agenda lokal (Zero-Churn), pill satelit kanan `<=5m` & chip header `Mode6TopNav`, `T-0` `◉ ♥` + *Snooze 5m*, tombol kontekstual `Hari Ini`, `Sen–Jum`, Core Audio *ducking* `12%` multi-endpoint + `PlaySoundW` `0.85` + Adzan SMTC auto-pause/resume, bypass autoplay WebView2, & paritas `docs/` | `[DONE]` |

---

## 3. Spesifikasi Teknis Bertahap Per Versi

### `v2.1.3` — Hotfix Stability: Drop-Out & Floating Pill `[DONE]`
**Tujuan:** Menuntaskan dua kendala stabilitas utama pada Dropzone drag-out ke aplikasi Windows eksternal dan transisi kapsul di *Floating Mode*.

1. **Perbaikan Drag-Out File Eksternal (`DropZoneView.tsx`, `src-tauri/src/`):**
   - Ganti/bungkus alur drag keluar di [DropZoneView.tsx](../src/components/views/DropZoneView.tsx) agar memakai implementasi drag OS native Win32 berbasis **`CF_HDROP`** (`IDataObject` + `IDropSource` + `DoDragDrop` OLE via `windows` crate atau sinkronisasi hasil `tauri-plugin-drag`) sehingga target seperti **WhatsApp Desktop**, **Windows Desktop**, dan **File Explorer** menerima berkas secara andal.
   - **Auto-Hapus Bersyarat Status Drop OS:** Item di [useDropZoneStore.ts](../src/stores/useDropZoneStore.ts) **hanya boleh dihapus otomatis** ketika Windows OS mengembalikan status sukses **`DRAGDROP_S_DROP`** (bukan saat dibatalkan `DRAGDROP_S_CANCEL` atau target menolak drop).
   - Jaga koordinasi dengan `isInternalDragging` dan `50Hz` hitbox poller di [CasaIsland.tsx](../src/components/CasaIsland.tsx) / [hitbox.rs](../src-tauri/src/hitbox.rs) agar kapsul tidak tiba-tiba runtuh atau menutup diri saat kursor menarik berkas keluar batas kapsul.

2. **Perbaikan Flickering Loop Floating Mode `minimize` → `idle` (`CasaIsland.tsx`, `islandLayoutState.ts`, `hitbox.rs`):**
   - Kunci ukuran window transparan Tauri tetap statis **`1100×340`** sepanjang siklus transisi (`minimize` / `collapseToIdle` ↔ `idle`) tanpa mengundang `resize` DWM berulang.
   - Perluas *hit-area* / margin sensor hover pil mini pada *Floating Mode* (termasuk kompensasi celah *top offset* `12px` pada hitbox wrapper) agar tepi atas/bawah pil mini tidak memicu ping-pong `mouseenter` ↔ `mouseleave`.
   - Tambahkan **cooldown / hysteresis transisi `200ms`** pada transisi status kapsul antara `expanded` → `idle` → `tucked` sehingga getaran mikropointer di perbatasan pil tidak memicu flickering loop.

---

### `v2.1.4` — CASA Player: Smart Queue & Search Album/Playlist `[DONE]`
**Tujuan:** Meningkatkan akurasi rekomendasi antrean otomatis (*Auto-Queue*) dan memperkaya pencarian CASA Player agar mendukung kategori Artis, Album, serta Playlist secara lintas-katalog.

1. **Auto-Queue Berbasis Relasi Lagu (`native_audio.rs`, `musicQueueEngine.ts`, `nativeAudioService.ts`):**
   - Ganti mekanisme *auto-queue* yang sebelumnya mengandalkan pencarian teks bebas nama artis dengan endpoint relasi lagu resmi (**`Up Next` / `Watch Playlist`** berbasis `videoId` / `trackId`), disertai *fallback* ke **`artistId`** resmi jika daftar relasi belum tersedia, agar rekomendasi otomatis selalu mengikuti ekosistem musik lagu yang sedang diputar (baik katalog lokal Indonesia maupun internasional).
   - **Transisi Playlist ke Smart Queue (Anti-Loop Paksa):** Saat memutar dari playlist tersimpan dan mode *Repeat* dalam keadaan **Off**, begitu lagu terakhir di playlist selesai diputar, CASA Player **tidak boleh mengulang/loop isi playlist dari awal**, melainkan otomatis melanjutkan pemutaran dengan menarik rekomendasi *Smart Queue* berdasarkan *seed* lagu-lagu di playlist tersebut (hanya mengulang dari awal apabila pengguna secara eksplisit mengaktifkan mode *Repeat All*).
   - **Session-Seeded Smart Queue (Anti-Personal Mix Fallback):** Saat pengguna menambahkan lagu secara manual ke antrian dan seluruh antrian habis, *auto-queue* **wajib** menggunakan **riwayat *seed* sesi aktif** (`videoId` dan `artistId` dari beberapa lagu terakhir yang diputar/diantrekan di sesi tersebut) untuk memanggil endpoint relasi *Up Next / Watch Playlist*—bukan jatuh ke *fallback* *personal mix* / riwayat putar harian pengguna—agar rekomendasi lanjutan tetap konsisten dengan nuansa dan artis lagu yang baru didengarkan.

2. **Parameter Wilayah Dinamis (`gl` & `hl`):**
   - Terapkan parameter wilayah (**`gl`** & **`hl`**) secara dinamis mengikuti locale/region OS pengguna, dilengkapi opsi pemilih region manual di pengaturan Player (**`Auto`**, **`ID`**, **`US`**, **`KR`**, **`JP`**) sehingga hasil pencarian kata ambigu tetap relevan tanpa mengunci katalog ke satu negara saja.

3. **Pencarian Kategori Top Songs Artis, Album & Playlist (`native_audio.rs`, `Mode6MusicLayout.tsx`):**
   - Perluas antarmuka & backend pencarian CASA Player agar menampilkan hasil terstruktur meliputi **Top Songs Artis**, **Album**, dan **Playlist**, lengkap dengan aksi **Play All / Muat ke Antrian** 1-klik.
   - Pastikan seluruh lagu di dalam Album/Playlist tersebut tetap dapat dimuat dan diputar penuh di CASA Player meskipun lirik sinkron LRCLIB belum tersedia (berjalan selaras dengan fallback lirik / *unsynced*).

---

### `v2.2.0` — Dropzone 2.0: Papan Teks Ephemeral `[DONE]`
**Tujuan:** Menjadikan Dropzone sebagai rak transit terpadu untuk **potongan teks**, **tautan URL**, dan **berkas** secara langsung lewat drag-and-drop maupun `Ctrl+V` eksplisit tanpa perlu polling clipboard latar belakang.

1. **Drag-In Teks, Link & File Terpadu (`tauri.conf.json`, `CasaIsland.tsx`, `DropZoneView.tsx`, `useDropZoneStore.ts`):**
   - Atur **`"dragDropEnabled": false`** pada konfigurasi window `main` di [src-tauri/tauri.conf.json](../src-tauri/tauri.conf.json) agar event HTML5 `dragenter`/`dragover`/`drop` DOM menerima penuh muatan `text/plain`, `text/uri-list`, `text/html`, dan `DataTransfer.files` (dibantu `stage_dropped_file` untuk staging file DOM tanpa `.path`), sementara `onDragDropEvent` tetap dipertahankan sebagai fallback kompatibel.
   - Terapkan **sanitasi konten HTML/teks** (*strip tag* HTML/skrip berbahaya & karakter kontrol/bidi lewat `sanitizeDropText`) serta validasi skema tautan (`parseSafeHttpUrl` — mengizinkan `http://` & `https://`, menolak `javascript:`, `data:`, `vbscript:`, dan `file:` yang tidak tervalidasi dengan banner `securityNotice`) sebelum ditampilkan di kartu `DropZoneView.tsx`.
   - Mendukung **Smart Drag-In** di seluruh kapsul untuk membangunkan mode *Idle / Tucked / Resting* ke Dropzone secara mulus, serta **`Ctrl+V` eksplisit + tombol `Paste`** (tanpa *background clipboard snooping* `Ctrl+C`).

2. **Siklus Hidup Ephemeral Murni (`useDropZoneStore.ts`, `src-tauri/src/`):**
   - Mendukung **drag-out teks/link** ke aplikasi tujuan melalui Win32 OLE **`CF_UNICODETEXT`** (`+ CF_TEXT` fallback via `native_drag_drop_text` & `run_drag_drop_on_sta`) selain `CF_HDROP` untuk berkas.
   - **Auto-hapus** item begitu OS mengonfirmasi drop berhasil (`DRAGDROP_S_DROP` & `dwEffect != DROPEFFECT_NONE`, anti-self-drop) maupun pembersihan otomatis seluruh isi Dropzone + direktori transit sementara (`cleanup_ephemeral_drop_zone` / startup & `quit_app` / tray `"quit"` / `beforeunload`) saat sesi berakhir.
   - Sinkronisasi perilaku Dropzone 2.0 (`file`, `link`, `text`, tombol `Paste`, `Ctrl+V`, & wake saat drag di kapsul) pada Web Showcase `docs/`, terverifikasi via `scripts/verify-dropzone-v220.mjs` (22/22 pass).

---

### `v2.3.0` — Connect HP: Zero-App Local Web Drop `[DONE]`
**Tujuan:** Menghubungkan ponsel (*HP*) dan laptop dua arah lewat browser HP tanpa instalasi aplikasi tambahan (*Zero-App*) melalui jaringan Wi-Fi atau Hotspot lokal.

1. **Server HTTP + WebSocket Sementara di Rust ([Cargo.toml](../src-tauri/Cargo.toml), [connect_hp.rs](../src-tauri/src/connect_hp.rs), [drop_zone.rs](../src-tauri/src/drop_zone.rs)):**
   - Memakai crate ringan **`axum`** (`http1, tokio, ws, multipart, json, query`), **`tokio-util`** (`io`), **`qrcode`** (`svg`), dan Win32 `BCryptGenRandom` + `GetAdaptersAddresses` + `INetworkListManager` + `write_clipboard_text` (`CF_UNICODETEXT`) tanpa tambahan crate `arboard`/`local-ip-address`.
   - Saat diaktifkan, listener bind `0.0.0.0:0` dengan token sesi CSPRNG 128-bit (`ct_token_eq`), guard IPv4 RFC 1918 & CSWSH `Origin`, pergantian adapter Wi-Fi ↔ Hotspot `192.168.137.1` tanpa restart server, serta **auto-shutdown 10 menit idle** maupun deterministik pada tombol tutup sesi, `quit_app`, & Tray Quit (tetap hidup saat kapsul menciut/ganti tab).

2. **Alur Transfer Dua Arah Wi-Fi / Hotspot (`useConnectHpStore.ts`, `useDropZoneStore.ts`, `DropZoneView.tsx`):**
   - **HP → Laptop:**
     - Teks/tautan menulis opsional ke **Windows Clipboard** dan masuk ke `useDropZoneStore` (terlindung `sanitizeDropText` + `parseSafeHttpUrl`).
     - Berkas di-*stream* `O(1)` RAM (`BufWriter` 64 KB, `DefaultBodyLimit::disable()`, batas 4 GB/file, `.part` atomic rename) ke **`Downloads\CASA Drop`**. Pemilihan **> 5 file** (`X-Casa-Batch-Id` / `X-Casa-Batch-Total`) otomatis membentuk 1 subfolder sesi (`Batch-HHMM`) & 1 kartu folder tunggal berprogres live.
   - **Laptop → HP:**
     - Mendukung pemilihan **`+ File`** dan **`+ Folder`** native (`IFileOpenDialog` / `FOS_PICKFOLDERS`) untuk melewati limit RAM 25 MB WebView, sinkronisasi DTO aman `sync_connect_hp_items` (zero local-path leak), streaming file via `ReaderStream`, serta **streaming ZIP metode `STORE`** (0% kompresi, CRC-32 + Data Descriptor `0x08074b50`) untuk unduhan folder penuh ke HP.

3. **Deteksi Kendala Jaringan, Mobile UI & Keamanan:**
   - Right Satellite Pod (`204 × 177 px` di dalam kanvas `1100×340` via `effectiveRightPodOpen` & `update_island_hitboxes`), deteksi profil jaringan Windows (`Private`/`Public`/`Domain`), serta panduan cepat Hotspot/Firewall tanpa UAC.
   - Web UI HP self-contained (`0` CDN, nol `innerHTML`, token scrub via `history.replaceState` setelah `sessionStorage`, auto-reconnect `visibilitychange` + tombol `Hubungkan Ulang`, salin teks HTTP-safe `<textarea>` + `execCommand('copy')`, antrean upload mobile persisten terpadu lintas batch dengan maksimal `2` worker paralel + 1x retry). Mendukung pula Drag-In folder Explorer rekursif (`webkitGetAsEntry`/`readEntries` loop penuh → `Downloads\CASA Drop`), strip peringatan >25 MB non-truncate, serta drag-out `CF_HDROP` direktori penuh ke Explorer. CSP [tauri.conf.json](../src-tauri/tauri.conf.json) tetap terkunci.

---

### `v2.3.1` — Hotfix Android Connect HP & UI Polish `[DONE]`
- **Multi-Scan & Reload Aman:** Token sesi berlaku sepanjang sesi aktif, disimpan di `sessionStorage` sebelum scrub `/`, auto-reconnect saat kembali ke tab Android, plus tombol **`Hubungkan Ulang`**, dan `shutdown_connect_hp_server_async` memastikan restart Connect HP tanpa perlu keluar CASA.
- **ZIP `Content-Length` Eksak & MIME:** `prepare_store_zip_plan` menghitung total ukuran ZIP sebelum streaming (`Content-Type: application/zip`, `Content-Length` eksak, `filename*=UTF-8''`, `Cache-Control: no-store`, dan catatan Chrome HTTP *"Tetap simpan"*).
- **UI Polish (`BatteryPill.tsx` & `DropZoneView.tsx`):** Lingkar baterai hijau `#22c55e` (normal & charging), kuning `#f59e0b` (`<=20%`), merah `#ef4444` (`<=10%`), petir charging kuning `#facc15`, serta strip peringatan Dropzone `File >25 MB: gunakan tombol + File, + Folder, atau Paste (Ctrl+V).` di bawah header tanpa pemotongan elipsis.

---

### `v2.3.2` — Security Hardening & SmartScreen Inline Guide `[DONE]`
- **Pagar Keamanan Menyeluruh (`src-tauri/`, `src/`, `.agent/SECURITY_BASELINE.md`):**
  - Middleware autentikasi Axum `from_fn_with_state` + `is_allowed_host` sebelum membaca body, per-route body limit (`DefaultBodyLimit::disable()` hanya di `/api/upload`, `256 KiB` default elsewhere), batas WS (`8` klien / `4096` byte) & folder batch (`32`), header keamanan (`X-Frame-Options: DENY`, `nosniff`, `no-store`), serta NTFS MOTW (`:Zone.Identifier`).
  - Pinning `yt-dlp` `2026.11.23` dengan verifikasi SHA-256 sebelum rename & eksekusi, timeout 30s, batas 35 MiB, LRU `StreamRegistryCache` (`64`), serta TLS penuh.
  - Migrasi Spotify ke OAuth 2.0 **PKCE (`S256`) + `ct_eq` `state`** dan penyimpanan Windows **DPAPI** (`spotify_tokens.dpapi`, tanpa `CLIENT_SECRET`), serta pemisahan capability per jendela (`main-window.json`, `settings-window.json`), `ILCreateFromPathW`/`SHOpenFolderAndSelectItems`, `ShellExecuteW`, typed `#[interface] IPolicyConfig`, `ComGuard` RAII, dan penghapusan `<link>` CDN yatim di `index.html`.
- **Web Showcase (`docs/`):** Kartu panduan inline SmartScreen `#download-smartscreen-guide` (`...` → `Keep` → `Keep anyway` & `More info` → `Run anyway`) tampil otomatis saat tombol unduh `.exe`/`.msi` diklik tanpa handler inline.

---

### `v2.4.0` — Quick Calculator, Instant Converter, Hybrid 6-Tab Nav & Adaptive Wi-Fi `[DONE]`
**Tujuan:** Menyediakan kalkulator cepat & konverter kurs dunia langsung di kapsul `540×186`, memadatkan navigasi 6-tab dengan pil kaca gelap, serta menyempurnakan Wi-Fi Adaptif & sinyal visual companion.

1. **Kalkulator Split 2-Kolom & Konverter Kurs Real-Time 163 Negara (`src/features/calculator/`, `drop_zone.rs`, `system_hardware.rs`):**
   - Parser matematika rekursif murni TypeScript ([calcParser.ts](../src/features/calculator/calcParser.ts), **tanpa `eval` / `new Function`**) mendukung `+`, `-`, `*` (`×`/`x`/`X`), `/` (`÷`), `^`, tanda kurung, perkalian implisit `2(3+4)`, persentase kontekstual (`100000 + 10% = 110000`), batas panjang/eksponen anti-freeze, tata letak 2-kolom dengan keypad 5×4 (`CalculatorExpandedView.tsx`), serta salin 1-klik lewat Win32 IPC `copy_text_to_clipboard`.
   - Konverter satuan offline (`unitConverter.ts`: Panjang, Massa, Suhu `°C/°F/K`, Data `B–GiB`, Zona Waktu `WIB/WITA/WIT/UTC`) dan **163 mata uang dunia** (`WORLD_CURRENCY_CATALOG`) lengkap dengan pemilih pencarian instan per kode/negara, cache lokal 30 menit, serta proxy Rust `fetch_exchange_rates` (`danger_accept_invalid_certs(false)`, timeout 8s).

2. **Wi-Fi Adaptive Auth, Auto-Rollback & Captive Portal (`system_hardware.rs`, `Mode6ControlCenterView.tsx`):**
   - Pemetaan `<WLANProfile>` in-memory untuk `Open`, `WPA`, `WPA2`, `WPA3`, serta pengalihan `802.1X Enterprise` ke `ms-availablenetworks:` (`open_available_wifi_networks`); validasi XML control char & PSK, zero-fill buffer memori pasca-`WlanSetProfile`, serta **auto-rollback `WlanDeleteProfile`** jika koneksi awal gagal (~6s).
   - Deteksi *on-demand* `ConstrainedInternetAccess` disertai banner `Perlu Login` & tombol `Buka Portal` (`open_captive_portal_browser`).

3. **Hybrid 6-Tab Dark Glass Nav, Focus Timer Icon & Drop Zone `◈ ♥` (`Mode6TopNav.tsx`, `ProductivitySplitView.tsx`, `CasaCompanionAvatar.tsx`, `CasaCompanionEyes.tsx`, `docs/`):**
   - Urutan tab terkunci dengan `Kontrol` paling kanan (`Musik → Focus → Drop → (Ibadah) → (Calc) → Kontrol`), pil aktif kaca gelap (`rgba(255,255,255,0.08)` + border `0.14`) dengan ikon menyala semantik per modul (`#FFFFFF` penuh di tema `monochrome`), chip toggle cepat `Ibadah` / `Calc` di Control Center, ikon stopwatch `<Timer>` di Focus Timer, serta mata kiri `◈` (`◈ ♥`) pada avatar/resting pill saat Dropzone terisi.
   - Paritas 1:1 Web Showcase `docs/` (termasuk keypad 2-kolom, pencarian kurs, mata `◈ ♥`, dan portal Wi-Fi) terverifikasi penuh lewat [verify-calculator-v240.mjs](../scripts/verify-calculator-v240.mjs), [verify-docs-showcase.mjs](../scripts/verify-docs-showcase.mjs), dan [verify-reviews-security.mjs](../scripts/verify-reviews-security.mjs). *(Pemaketan installer & kenaikan nomor versi rilis digabungkan pada rilis akhir bersama `v2.5.0`.)*

---

### `v2.5.0` — Calendar, Smart Reminders & Smart Audio `[DONE]`
**Tujuan:** Menyediakan kalender bulanan & pengingat agenda lokal yang hening saat idle (`Idle Zero-Churn`), tampil adaptif saat `<= 5` menit, serta mengatur arbitrasi audio sistem (*Adzan SMTC auto-pause/resume* dan *Core Audio ducking*).

1. **Kalender Bulanan, CRUD Agenda & Scheduler Idle Zero-Churn (`src/features/calendar/calendarScheduleLogic.ts`, `calendarStore.ts`, `CalendarExpandedView.tsx`):**
   - Penyimpanan agenda harian lokal (`localStorage` `casa_reminders_v1`, batas `MAX_REMINDER_ITEMS = 50`), sanitasi ketat HTML/bidi/kontrol, opsi pengulangan **`Sekali | Harian | Sen–Jum`**, serta tombol kontekstual **`Hari Ini`** (hanya tampil ketika bulan/tanggal yang dilihat bukan hari ini).
   - Mode navigasi **7-tab** (`Mode6TopNav.tsx` dengan `Jadwal` `#FB7185` sebelum `Kontrol`; tema `monochrome` mengunci `#FFFFFF`) dan chip toggle cepat `Ibadah`/`Calc`/`Jadwal` selaras warna (`#10B981`, `#FB923C`, `#FB7185`).
   - *Idle Zero-Churn:* `0` timer aktif bila modul nonaktif/kosong; memakai `1` `setTimeout` presisi menuju ambang berikutnya dan mengaktifkan ticker 1 detik hanya selama badge `<= 5m` atau antrean alert `T-0` aktif.

2. **Heads-Up `<= 5 Menit` Satellite Pill & Smart Audio Arbitration (`CasaIsland.tsx`, `native_audio.rs`, `calendarChime.ts`, `alarmChime.ts`, `prayerStore.ts`):**
   - Saat *Idle* dan sisa waktu `<= 5 menit`, badge tampil sebagai **pill satelit kanan terpisah** (`36 px` tinggi, maks `168 px`, celah `8 px` di `hitRects` via `computeReminderSatelliteBounds`, menjaga equalizer/lirik `IdlePillView.tsx` tetap bersih); saat *Expanded* di tab lain, tampil sebagai **chip ringkas** di header `Mode6TopNav.tsx`.
   - Saat `T-0` tiba, kapsul menampilkan ekspresi `◉ ♥` (`reminder_t0` di bawah `alarm` dan di atas `dual_active`), tombol **`Snooze 5m`** dan **`Dismiss`**, menghormati Fullscreen `smart-tuck`/`total-hide`, serta mensintesis chime `PlaySoundW` (`0.85` peak, fallback Web Audio + bypass `--autoplay-policy=no-user-gesture-required` di `tauri.conf.json`).
   - Core Audio *ducking* multi-endpoint (`EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)`, menangani `RPC_E_CHANGED_MODE`) menurunkan sesi eksternal ke **`12%`** dan memaksa sesi CASA ke **`100%`** selama alarm Timer / Kalender `T-0` aktif, sedangkan Adzan mengambil alih penuh (jeda/lanjut eksplisit SMTC dan melepaskan *ducking*). Paritas `docs/` terverifikasi via [verify-calendar-v250.mjs](../scripts/verify-calendar-v250.mjs) & [verify-docs-showcase.mjs](../scripts/verify-docs-showcase.mjs).

---

## 4. Aturan Eksekusi & Standar Penutupan Versi

1. **Status Lifecycle:**
   - Seluruh versi `v2.1.3` s.d. `v2.5.0` berstatus **`[PLANNED]`** sampai dikerjakan.
   - Saat memulai pengerjaan suatu versi (misalnya pengguna meminta *"kerjakan `v2.1.3`"*), ubah statusnya menjadi **`[IN_PROGRESS]`** bila perlu melacak sub-tahap, kerjakan tepat sesuai ruang lingkup spesifikasi versi tersebut (tanpa mencampur fitur versi lain yang belum diminta), dan tetap patuhi [AGENTS.md](../AGENTS.md).
2. **Gate Verifikasi Wajib Sebelum Status Diubah Menjadi `[DONE]`:**
   Agen **DILARANG** menandai versi sebagai `[DONE]` sebelum menjalankan langsung seluruh verifikasi berikut dan memastikan semuanya lulus dengan exit code **`0`**:
   ```powershell
   npx tsc --noEmit
   npm run build
   cargo check --manifest-path src-tauri/Cargo.toml
   cargo test --manifest-path src-tauri/Cargo.toml --lib
   node scripts/verify-docs-showcase.mjs
   node scripts/verify-reviews-security.mjs
   ```
   *(Tambahkan juga eksekusi skrip verifikasi logika/UX khusus fitur yang baru diubah, misalnya skrip unit test logic di `scripts/verify-*.mjs` dan uji interaksi nyata Desktop + Web Showcase).*
3. **Lockstep Sinkronisasi Rilis:**
   Setelah seluruh pengujian hijau dan siap dirilis, ikuti SOP pada [release-bundler](./skills/release-bundler/SKILL.md) dan perbarui status versi pada `.agent/ROADMAP_CASA.md` menjadi **`[DONE]`** beserta pembaruan [CASA_CONTEXT.md](../CASA_CONTEXT.md), [docs/PRD.md](../docs/PRD.md), dan skill terkait di [.agent/skills/](./skills/).
