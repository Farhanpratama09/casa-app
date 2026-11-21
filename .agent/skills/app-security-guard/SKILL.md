---
name: app-security-guard
description: Pengawal keamanan IPC Tauri, CSP aplikasi/web showcase (Supabase + Telegram), hygiene Git (.env*/keys), dan larangan eksposur kredensial.
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
   - Di `docs/index.html` (Web Showcase + **Ratings & Reviews**), CSP wajib mengunci `script-src 'self'`, `frame-src 'none'`, `form-action 'self'`, serta `connect-src` khusus ke `https://api.github.com` dan `https://ivlyujaafwqziogajjtk.supabase.co` tanpa `'unsafe-inline'` pada `script-src`, serta sanitasi DOM bebas `innerHTML`.
   - Di Supabase (`supabase/`): baca publik hanya via view **`casa_reviews_public`** & **`casa_review_stats`** (tabel dasar `casa_reviews` & `review_rate_limits` tertutup bagi `anon`), klien `docs/app.js` hanya memakai header **`apikey`** (`sb_publishable_...`, tanpa `Authorization: Bearer`), Edge Function `telegram-webhook` wajib *constant-time* `X-Telegram-Bot-Api-Secret-Token` + validasi `from.id` & `chat.id`, dan IP di-hash dengan **HMAC-SHA256 (`IP_HASH_SALT`)** (`/64` untuk IPv6).
4. **Sanitasi Proses & Fitur Roadmap (`.agent/ROADMAP_CASA.md`):** Peluncuran biner eksternal (`spotify_win32.rs`, `drop_zone.rs`) wajib memakai path tervalidasi atau Shell API aman tanpa argumen shell terinjeksi. Untuk fitur lanjutan pada [.agent/ROADMAP_CASA.md](../../ROADMAP_CASA.md) (`v2.2.0`+): sanitasi drag-in HTML/URI (`javascript:`/`data:` diblokir), token sesi acak + validasi path traversal untuk server LAN *Connect HP* (`Downloads\CASA Drop`), dan evaluator matematika murni tanpa `eval`.
