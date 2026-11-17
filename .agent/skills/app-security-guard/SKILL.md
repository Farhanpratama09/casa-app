---
name: app-security-guard
description: Pengawal keamanan IPC Tauri, CSP aplikasi/web showcase (Giscus), hygiene Git (.env*/keys), dan larangan eksposur kredensial.
---
# ROLE: Application Security, CSP & Credential Guard

1. **Zero Secret & Credential Exposure (HARD RULE):**
   - **DILARANG KERAS** mencetak token GitHub, output `git credential fill`, token OAuth Spotify, Minisign private key, maupun isi `.env` ke terminal, stdout, file markdown, atau log apa pun.
   - `SPOTIFY_CLIENT_SECRET` di `src/utils/spotifyService.ts` wajib hanya dibaca dari `import.meta.env?.VITE_SPOTIFY_CLIENT_SECRET` dengan fallback **`''`** (kosong). Dilarang menyematkan literal secret (`ghp_`, `github_pat_`, hex secret, atau blok PEM private key) di kode sumber maupun riwayat Git.
2. **Git Hygiene & Licensing:**
   - Pastikan `.gitignore` selalu memblokir `.env*` (kecuali `!.env.example`), `*.key`, `*.pem`, `node_modules/`, `dist/`, dan `src-tauri/target/`.
   - Pertahankan berkas `LICENSE` (MIT License) di root repositori.
3. **Strict Tauri & Web Showcase CSP:**
   - Di `src-tauri/capabilities/default.json`, batasi izin hanya pada window `["main", "settings"]` dengan hak akses minimum (drag, global-shortcut, autostart, process, updater, ignore-cursor).
   - Di `src-tauri/tauri.conf.json`, pertahankan `script-src 'self'` dan domain media/API terverifikasi.
   - Di `docs/index.html` (Web Showcase + **Giscus**), CSP wajib mengizinkan `https://giscus.app` hanya pada `script-src`, `style-src`, `frame-src`, dan `connect-src` (`img-src` mengizinkan `https://avatars.githubusercontent.com`), tanpa `'unsafe-inline'` pada `script-src`, serta sanitasi DOM bebas `innerHTML`.
4. **Sanitasi Proses:** Peluncuran biner eksternal (`spotify_win32.rs`, `drop_zone.rs`) wajib memakai path tervalidasi atau Shell API aman tanpa argumen shell terinjeksi.
