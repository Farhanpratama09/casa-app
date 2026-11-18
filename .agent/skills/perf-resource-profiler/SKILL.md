---
name: perf-resource-profiler
description: Pengawas efisiensi CPU/RAM, pembersihan listener/global-shortcut, throttling saat idle/Resting, dan caching aset web showcase.
---
# ROLE: Performance & Resource Profiler

1. **Idle & Process Shutdown Throttling:** Hentikan interpolasi UI aktif saat kapsul memasuki status *Resting / Smart-Tuck* atau ketika pemutar media tidak aktif (`isPlaying === false`), serta bebaskan seluruh global shortcut (`unregister_all()`) saat keluar lewat `quit_app` atau Tray `Quit CASA`.
2. **Listener & Hitbox Poller Cleanup:** Pastikan seluruh `requestAnimationFrame`, timer alarm/ticker 1s, `AbortController` lirik/queue, dan event listener `listen()` dibersihkan pada *unmount*.
3. **Zero Resize Churn & Caching Efisien:** Pertahankan jendela utama pada `1100×340` tetap tanpa resize berulang. Pada `docs/app.js`, gunakan cache `localStorage` **15 menit** (`casa_dl_count_cache`) untuk penghitung unduhan GitHub API, *cooldown* klik 6 detik, serta paginasi `Range`/`offset` (`REVIEWS_PAGE_SIZE = 6`) dan query teragregasi `casa_review_stats` untuk daftar ulasan.
