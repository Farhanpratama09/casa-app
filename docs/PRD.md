# Product Requirements Document (PRD) — C.A.S.A.
**Crimson All-in-one Screen App (C.A.S.A.)**
Dynamic Floating Island Utility for Windows (Tauri v2 + Rust + React + Vite)

## 1. Identitas & Tujuan Produk
- **Nama Produk:** C.A.S.A. (Crimson All-in-one Screen App)
- **Konsep:** Dynamic floating desktop island di bagian tengah atas layar Windows yang menyatukan kontrol musik, lirik sinkron milidetik, antrean pintar, dan utilitas sistem secara ringkas.

## 2. Standar Arsitektur Inti
1. **Hybrid Media & Lifecycle State:**
   - Menggabungkan Windows GSMTC (`src-tauri/src/media.rs`) dan Spotify Web API (`src/utils/spotifyService.ts`).
   - Jika aplikasi Spotify ditutup (`Spotify.exe` mati dan tidak ada sesi media aktif), seluruh state lagu wajib di-reset total (`title: ""`, `isPlaying: false`) dan UI wajib kembali ke layar awal pemilihan Playlist / Buka Spotify.
2. **Context-Aware Queue Playback:**
   - Saat berpindah lagu/konteks, state `queue` lama wajib dikosongkan seketika (`isQueueLoading = true`) agar item antrean basi tidak dapat diklik (anti-race condition).
   - Klik lagu pada antrean Playlist/Album menggunakan `{ context_uri, offset: { uri } }`, sedangkan klik lagu pada antrean Non-Playlist (Search/Artist/Random) wajib mengirim `{ uris: [clickedUri, ...nextUris] }`.
3. **High-Precision Synced Lyrics Engine:**
   - Menggunakan `/api/search` LRCLIB dengan prioritas mutlak pada kecocokan durasi studio ($\pm 1.5$ detik) di atas jumlah teks semata, menghindari file LRC versi MV yang memiliki offset intro drama.
4. **Native Window & Z-Order Control:**
   - Ukuran `LogicalSize` jendela Tauri mengikuti mode aktif + tinggi DevTrigger Bar tanpa memotong elemen (anti-clipping) dan tanpa memblokir klik di luar pulau.
   - Peluncuran Spotify menggunakan `HWND_BOTTOM` (`SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE`).
