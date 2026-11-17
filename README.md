# CASA — Dynamic Rabbit Island for Windows (`v2.0.3`)

![License: MIT](https://img.shields.io/badge/License-MIT-white.svg?style=flat-square)
![Platform: Windows 10/11 x64](https://img.shields.io/badge/Platform-Windows%2010%2F11%20x64-09090b.svg?style=flat-square)
![Stack: Tauri v2 + Rust + React 19](https://img.shields.io/badge/Stack-Tauri%20v2%20%2B%20Rust%20%2B%20React%2019-09090b.svg?style=flat-square)

**CASA** adalah utilitas desktop ambien bertema **Pure Monochrome OLED** (`#000000`) untuk Windows 10/11 yang menyematkan kapsul interaktif (*top-flush notch* maupun *floating pill*) di bibir atas layar, ditemani maskot **Obsidian Bunny** (`× ♥`).

> **Live Web Showcase & Unduh Installer:** [farhanpratama09.github.io/casa-app](https://farhanpratama09.github.io/casa-app/)  
> **GitHub Releases (Signed OTA + Checksum):** [github.com/Farhanpratama09/casa-app/releases/latest](https://github.com/Farhanpratama09/casa-app/releases/latest)

---

## Fitur Utama (`v2.0.3`)

- **Musik & Lirik Sinkron Milidetik (`Player | Playlists` + `QUEUE`):**
  - Integrasi Windows GSMTC + Spotify Web API (`OAuth loopback :8888`) + pencarian audio native.
  - Sub-navigasi ringkas **`Player | Playlists`**, satelit drawer kiri pencarian lagu + `Save to Playlist`, dan satelit pop-up kanan ber-header **`QUEUE`**.
  - Scoring lirik LRCLIB presisi durasi studio ($\pm 1.5$ detik) dan mode kompak *Idle Lyric Minimize*.
- **Focus Pomodoro & To-Do Ring:**
  - *U-shape perimeter progress stroke* sepanjang tepi kapsul + mode *Dual-Idle* (Musik × Timer fokus simultan) dan alarm kustom hingga 15 detik.
- **Control Center, Hardware HUD & Drop Zone Shelf:**
  - Slider Volume WASAPI & Display Brightness WMI real-time lengkap dengan HUD kapsul atas.
  - Toggle cepat **Wi-Fi**, daftar perangkat **Bluetooth + persentase baterai**, **Circular Battery Ring SVG**, pembacaan CPU/RAM live (`sysinfo`), serta **Drop Zone** *drag-and-drop* berkas sementara.
- **Tema Adaptif OLED & Ergonomi Windows:**
  - Pilihan tema **`Default`**, **`Monochrome` (Stealth OLED 100% bebas aksen warna statis)**, dan **`Colorblind` (Okabe-Ito)**.
  - Jendela `Settings` mandiri dengan pratinjau kapsul langsung, global shortcut `Alt + Space`, `4px` *Smart-Tuck* di aplikasi *fullscreen*, system tray berbahasa Inggris (`Show / Hide CASA`, `Gaming Mode: Auto`, `Quit CASA`), serta tombol **`Quit CASA`** pada sidebar Settings.
  - Pembaruan OTA bertanda tangan kriptografi Minisign (`latest.json` + `.sig`).

---

## Memulai Pengembangan Lokal

### Prasyarat
- **Node.js** 20+ & **npm**
- **Rust** toolchain (`rustup`, stable MSVC) & prasyarat **Tauri v2** (WebView2 di Windows 10/11)

### Setup Environment
1. Salin file template environment:
   ```powershell
   Copy-Item .env.example .env
   ```
   *(Opsional untuk fitur login Spotify pribadi: isi `VITE_SPOTIFY_CLIENT_ID` dan `VITE_SPOTIFY_CLIENT_SECRET` di `.env` — seluruh berkas `.env*` diblokir oleh `.gitignore`.)*
2. Pasang dependensi & jalankan mode pengembangan:
   ```powershell
   npm install
   npm run tauri dev
   ```

---

## Verifikasi & Build Produksi

Jalankan seluruh pemeriksaan berikut sebelum melakukan push ke `main`:

```powershell
npx tsc --noEmit
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
node scripts/verify-docs-showcase.mjs
```

Untuk membangun installer Windows NSIS/MSI bertanda tangan Minisign:
```powershell
npm run tauri build
```

---

## Arsitektur & Komunitas

- Dokumentasi teknis lengkap: [CASA_CONTEXT.md](./CASA_CONTEXT.md) · [docs/PRD.md](./docs/PRD.md) · [AGENTS.md](./AGENTS.md)
- Diskusi & laporan bug: [GitHub Discussions](https://github.com/Farhanpratama09/casa-app/discussions) atau langsung melalui widget **Giscus** pada bagian *Community & Discussions* di [farhanpratama09.github.io/casa-app/feedback](https://farhanpratama09.github.io/casa-app/feedback).

## Lisensi

Dirilis di bawah **MIT License** — lihat berkas [LICENSE](./LICENSE). Copyright © 2026 Farhan Pratama.
