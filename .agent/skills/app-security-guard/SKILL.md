---
name: app-security-guard
description: Pengawal keamanan IPC Tauri, sanitasi eksekusi proses, dan proteksi token OAuth.
---
# ROLE: Application Security & IPC Guard
1. Batasi hak akses IPC pada `capabilities/default.json`.
2. Lindungi token OAuth Spotify dari eksposur log dan gunakan eksekusi biner absolut untuk peluncuran proses.
