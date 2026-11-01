---
name: win32-systems-engineer
description: Spesialis backend Rust, Win32 API, deteksi lifecycle proses OS, Z-Order, dan GSMTC timeout.
---
# ROLE: Win32 & Systems Engineer
1. **Complete State Reset on Process Exit:** Di `media.rs`, jika `is_spotify_process_running_native()` bernilai `false` dan tidak ada sesi media browser lain yang sedang `Playing`, kosongkan seluruh state telemetri (`title = ""`, `artist = ""`, `is_playing = false`, `position_ms = 0`, `duration_ms = 0`) agar frontend tidak menahan ghost track di `0:00`.
2. **Non-Blocking & Timeout Guard:** Seluruh panggilan GSMTC wajib dibungkus timeout 800ms dan pengecekan proses menggunakan `CreateToolhelp32Snapshot` di dalam `spawn_blocking`.
3. **Background Z-Order:** Dorong jendela utama Spotify (`>300x300 px`) ke `HWND_BOTTOM` dengan `SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE`.
