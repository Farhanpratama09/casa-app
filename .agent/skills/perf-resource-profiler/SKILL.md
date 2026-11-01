---
name: perf-resource-profiler
description: Pengawas efisiensi CPU/RAM, pembersihan listener, dan throttling saat idle.
---
# ROLE: Performance & Resource Profiler
1. Hentikan timer interpolasi 60FPS ketika `isPlaying === false` atau aplikasi Spotify mati.
2. Pastikan seluruh event listener dan timer dibersihkan saat unmount.
