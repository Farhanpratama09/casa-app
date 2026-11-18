# AGENTS.md — Repository Rules & Engineering Guardrails (`CASA v2.0.3`)

Instruksi wajib bagi setiap agen AI dan kontributor yang bekerja di repositori `casa-app`. Seluruh detail teknis berpegang pada kode aktual di `src/`, `src-tauri/`, dan `docs/` serta [CASA_CONTEXT.md](./CASA_CONTEXT.md).

---

## 1. Hukum Paritas Showcase Web (`docs/` Wajib Sinkron)
1. **Sinkronisasi 1:1 UI Desktop ↔ `docs/`:** Setiap perubahan visual, tata letak, navigasi, perilaku *compact wake* (`× ♥`), animasi pembuka `"Hi."`, atau interaksi modul di `src/` **wajib** disinkronkan ke monitor virtual [docs/index.html](./docs/index.html), [docs/styles.css](./docs/styles.css), dan [docs/app.js](./docs/app.js) dalam task yang sama.
2. **Sinkronisasi Rilis & Checksum:** Setiap kenaikan versi (`package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `DesktopSettingsWindow.tsx`) **wajib** ikut memperbarui nomor versi, ukuran biner `MB`, hash `SHA-256` installer `CASA_<ver>_x64-setup.exe`, URL unduhan serta **baris metadata subteks `#download-size-text`** (`v<ver> · NSIS Setup (.exe) · <MB> MB`) pada `docs/index.html` (menjaga label tombol utama tetap ringkas `Download CASA for Windows`), dan skrip verifikasi `scripts/verify-docs-showcase.mjs`.
3. **Navigasi & Komunitas Web:**
   - Pertahankan **Clean Path Routing tanpa `#`** (`/casa-app/`, `/casa-app/playground`, `/casa-app/arsitektur`, `/casa-app/unduh`, `/casa-app/feedback`) lewat History API + [docs/404.html](./docs/404.html).
   - Pertahankan *Live Download Counter* (menjumlahkan aset `.exe` + `.msi` saja, cache `localStorage` 15 menit) dan tombol unduh dengan *cooldown* 6 detik.
   - Section *Community & Discussions* (`#feedback`) menggunakan **Giscus** (`Farhanpratama09/casa-app`, kategori `General`). **Strict CSP:** meta tag CSP di `docs/index.html` wajib mengizinkan `https://giscus.app` pada `script-src`, `style-src`, `frame-src`, dan `connect-src` tanpa menambahkan `'unsafe-inline'` ke `script-src`.

---

## 2. Kepatuhan Tema & Konsistensi UI Desktop (`src/`)
1. **Zero Color Leak pada Mode Monochrome:** Dilarang keras memakai kelas atau hex warna statis (`text-emerald-*`, `text-green-*`, `#10B981`, dll.) pada komponen yang harus adaptif tema. Seluruh indikator status (ikon output audio `Speaker`/`Headphones`/`Bluetooth`, *Circular Battery Ring*, Focus timer, CPU/RAM, Wi-Fi/BT) **wajib** mengambil warna dari `CASA_THEME_PALETTES` di `src/stores/useSettingsStore.ts`.
2. **Mode 6 Sub-Navigasi & Popout `QUEUE`:** Navigasi musik hanya **`Player | Playlists`** (dilarang mengembalikan tab `Queue` redundan), sementara kartu satelit kanan memakai header monospace ringkas **`QUEUE`**.
3. **Search Drawer Containment:** Popover `SAVE TO PLAYLIST` (`AddToPlaylistPopover`) wajib terkunci di dalam batas lebar Search Drawer dan dihitung penuh dalam `searchDrawerBounds` untuk `update_island_hitboxes`.
4. **System Tray & Tombol Keluar:** Pertahankan label System Tray berbahasa Inggris (`Show / Hide CASA`, `Gaming Mode: Auto`, `Quit CASA`) dan tombol **`Quit CASA`** di sidebar `DesktopSettingsWindow.tsx` yang memanggil IPC `quit_app` (membebaskan *global shortcut* sebelum `app.exit(0)`).

---

## 3. Keamanan, Rahasia & Kebersihan Git (Strict Rules)
1. **DILARANG MENCETAK ATAU MENYIMPAN KREDENSIAL:**
   - Dilarang mencetak token GitHub, output mentah `git credential fill`, token OAuth Spotify, maupun isi `.env` / private key Minisign ke terminal, log, file dokumen, atau output respons.
   - Dilarang menyematkan literal secret (`SPOTIFY_CLIENT_SECRET`, `ghp_`, `github_pat_`, PEM private key) di kode sumber (`SPOTIFY_CLIENT_SECRET` fallback di `src/utils/spotifyService.ts` wajib tetap `''`).
2. **Proteksi `.gitignore` & Lisensi:** Pastikan [.gitignore](./.gitignore) selalu memblokir `.env*` (kecuali `!.env.example`), `*.key`, `*.pem`, `node_modules/`, `dist/`, dan `src-tauri/target/`. Pertahankan [LICENSE](./LICENSE) (MIT License) di root.
3. **Path Test Portabel:** Jangan menuliskan path pribadi mesin pengembang (`C:\Users\<username_asli>\`) ke file maupun skrip yang terlacak Git.

---

## 4. Gate Verifikasi Wajib Sebelum `git push`
Sebelum commit final atau push ke `origin/main`, jalankan dan pastikan keempat verifikasi berikut lulus dengan exit code `0`:

```powershell
npx tsc --noEmit
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
node scripts/verify-docs-showcase.mjs
```

---

## 5. Sinkronisasi Dokumentasi
Setiap kali arsitektur, daftar IPC `invoke_handler`, dimensi pulau, atau alur rilis berubah, perbarui pula:
- [CASA_CONTEXT.md](./CASA_CONTEXT.md)
- [docs/PRD.md](./docs/PRD.md)
- Domain skill terkait pada [.agent/skills/](./.agent/skills/)
