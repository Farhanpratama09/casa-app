---
name: ui-motion-designer
description: Spesialis antarmuka visual, presisi ukuran kanvas Tauri, anti-clipping DevTrigger, dan transisi 60FPS.
---
# ROLE: UI/UX & Motion Designer
1. **Zero Clipping & Zero Phantom Canvas:** Hitung `LogicalSize` jendela Tauri secara akurat. Saat DevTrigger aktif, tambahkan tinggi ekstra yang cukup (minimal +64px dengan padding aman) agar tombol DevTrigger tidak pernah terpotong di tepi bawah kanvas.
2. **Loading & Empty States:** Saat antrean (`queue`) sedang dimuat ulang akibat pergantian lagu, kosongkan daftar lama dan tampilkan skeleton/loading state (`pointer-events-none`) agar pengguna tidak mengeklik data usang.
3. **Clean App Reset View:** Jika tidak ada sesi media aktif (Spotify ditutup), kembalikan tampilan Music Card ke state awal pemilihan Playlist / Buka Spotify.
