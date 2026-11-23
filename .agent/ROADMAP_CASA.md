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
| `v2.3.0` | *Connect HP — Zero-App Local Web Drop* | Server `axum` HTTP+WebSocket sementara, QR token acak, transfer 2 arah Wi-Fi/Hotspot, auto-shutdown | `[PLANNED]` |
| `v2.4.0` | *Quick Calculator & Instant Converter* | Kalkulator ekspresi inline aman di pil, salin hasil 1 klik, serta konversi satuan/kurs ringkas | `[PLANNED]` |
| `v2.5.0` | *Calendar & Smart Reminders* | Jadwal harian lokal, countdown `H-15m`/`T-0` di pil, tombol *snooze* 5 menit | `[PLANNED]` |

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

### `v2.3.0` — Connect HP: Zero-App Local Web Drop `[PLANNED]`
**Tujuan:** Menghubungkan ponsel (*HP*) dan laptop dua arah lewat browser HP tanpa instalasi aplikasi tambahan (*Zero-App*) melalui jaringan Wi-Fi atau Hotspot lokal.

1. **Server HTTP + WebSocket Sementara di Rust (`src-tauri/Cargo.toml`, `src-tauri/src/`):**
   - Tambah modul server lokal ringan berbasis **`axum`**, **`tokio`**, **`local-ip-address`**, **`qrcode`**, dan **`arboard`**.
   - Ketika fitur **Connect HP** diaktifkan dari UI CASA, nyalakan listener sementara pada IP LAN aktif dengan **token sesi acak** (tersemat pada URL di QR Code SVG/Canvas serta divalidasi di setiap request HTTP & WebSocket upgrade).
   - Matikan server secara deterministik (**auto-shutdown**) saat timer idle habis, panel ditutup, atau `quit_app` dipanggil.

2. **Alur Transfer Dua Arah Wi-Fi / Hotspot:**
   - **HP → Laptop:**
     - Kirim teks/tautan dari browser HP langsung menuliskan ke **Windows Clipboard** (`arboard`) sekaligus menampilkannya sementara di Dropzone bila diinginkan, disertai umpan balik halus.
     - Kirim file dari HP di-*streaming* langsung ke disk ke direktori **`Downloads\CASA Drop`** (menggunakan streaming async agar RAM tetap rendah, sanitasi nama file aman, penanganan bentrok nama, dan validasi ukuran).
   - **Laptop → HP:**
     - Item berkas/teks/tautan yang ada di **Dropzone** di-**beam** langsung ke sesi WebSocket halaman web HP untuk diunduh atau disalin 1 tap di layar ponsel.

3. **Deteksi Kendala Jaringan & Keamanan:**
   - Tambahkan deteksi & **indikator status kendala Firewall / AP Isolation** (misalnya deteksi antarmuka jaringan lokal/Hotspot yang valid, status jabat tangan client HP, peringatan bila port terblokir Windows Defender Firewall atau *Client/AP Isolation* pada router kampus/kantor, serta panduan *troubleshoot* ringkas).
   - Pastikan CSP pada [tauri.conf.json](../src-tauri/tauri.conf.json) tidak membuka akses domain publik baru selain kebutuhan loopback/UI lokal.

---

### `v2.4.0` — Quick Calculator & Instant Converter `[PLANNED]`
**Tujuan:** Menyediakan kalkulator cepat dan konverter instan langsung di dalam pil CASA tanpa membuka aplikasi terpisah.

1. **Kalkulator Ekspresi Matematika Inline (`src/features/`, `IdlePillView.tsx` / `CasaIsland.tsx`):**
   - Evaluator ekspresi matematika murni TypeScript (parser *Shunting-yard* / rekursif **tanpa `eval` / `new Function`** agar bebas celah injeksi & mematuhi `script-src 'self'`).
   - Dukung operasi aritmetika standar, tanda kurung, pangkat, persen (`+`, `-`, `*`, `/`, `%`, `^`), serta **salin hasil 1 klik** ke clipboard dengan feedback visual adaptif `CASA_THEME_PALETTES`.

2. **Konversi Satuan & Kurs Ringkas:**
   - Konversi satuan instan umum (panjang, massa, suhu `°C/°F/K`, ukuran data `KB/MB/GB/MiB`, zona waktu `WIB/WITA/WIT/UTC`) sepenuhnya offline (`0` ketergantungan jaringan).
   - Dukungan konversi kurs mata uang ringkas dengan preset offline / pembaruan ringan *on-demand* (opsional melalui proxy Rust `reqwest` agar CSP WebView tetap terkunci).
   - Sinkronisasi simulasi kalkulator & konverter 1:1 ke `docs/`.

---

### `v2.5.0` — Calendar & Smart Reminders `[PLANNED]`
**Tujuan:** Menyediakan ringkasan jadwal harian & pengingat waktu dekat yang terintegrasi rapi dengan prioritas kapsul pil CASA.

1. **Penyimpanan Lokal Ringan & Pengingat Harian (`src/features/`, `useSettingsStore` / modul lokal):**
   - Penyimpanan jadwal harian berbasis file/storage lokal terstruktur (`0` layanan cloud/login wajib) dengan penggunaan memori minimal saat idle.
   - Integrasi penjadwalan cerdas yang tidak membebani CPU (menggunakan timer terjadwal atau sinkron dengan ticker detik bersama di aplikasi).

2. **Countdown `H-15m` / `T-0` di Pil & Aksi Snooze 5 Menit:**
   - Tampilkan *countdown* halus **`H-15m`** menjelang jadwal serta pil alert **`T-0`** saat agenda tiba, dengan **tombol *Snooze* 5 menit** dan *Dismiss* langsung dari pil maupun banner Mode 6.
   - Hormati arbitrase prioritas kapsul (selaras dengan *Pengingat Ibadah T-0* & *Focus Timer Alarm* di [CasaIsland.tsx](../src/components/CasaIsland.tsx)) serta patuhi mode **Smart-Tuck Fullscreen / Gaming Mode** agar layar penuh tidak terganggu secara paksa.
   - Sinkronisasi simulasi jadwal & pengingat ke `docs/` Web Showcase.

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
