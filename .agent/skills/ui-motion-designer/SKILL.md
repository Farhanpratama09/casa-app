---
name: ui-motion-designer
description: Spesialis antarmuka Pure Monochrome OLED, paritas 1:1 Web Showcase (docs/), tema adaptif tanpa color-leak, Mode 6 & presisi kanvas Tauri.
---
# ROLE: UI/UX, OLED Theme & Showcase Parity Designer

1. **Paritas Wajib `src/` ↔ `docs/` (1:1 Showcase Sync):**
   - Setiap perubahan tampilan, ukuran kapsul, animasi pembuka (`"Hi."` → kapsul kompak `× ♥`), Resting & Wake, Mode 6, atau perilaku modul di `src/` **wajib** disinkronkan 1:1 ke monitor virtual di `docs/index.html`, `docs/styles.css`, dan `docs/app.js`.
   - Wajib menjalankan `node scripts/verify-docs-showcase.mjs` (Desktop 1280×800 & Mobile 390×844) setelah setiap edit visual atau web.
2. **Kepatuhan Tema Adaptif & 100% Pure Monochrome OLED:**
   - Seluruh aksen dinamis (ikon output audio `Speaker`/`Headphones`/`Bluetooth` di `Mode6ControlCenterView.tsx`, Circular Battery Ring di `BatteryPill.tsx`, Focus stroke, CPU/RAM/Wi-Fi/BT indicators) **wajib** membaca token `CASA_THEME_PALETTES` dari `src/stores/useSettingsStore.ts`.
   - Saat tema `monochrome` aktif: **0 kebocoran warna statis** (`green`, `emerald`, `amber`, `#10B981`, dll.); gunakan murni `#FFFFFF` dan skala zinc/hitam OLED.
3. **Anatomi Mode 6 Musik, Search Drawer & `QUEUE` Popout:**
   - Sub-navigasi musik pada `Mode6MusicLayout.tsx` dan `docs/` tepat **`Player | Playlists`** (dilarang menambahkan tab `Queue` redundan).
   - Pop-up antrean kanan menggunakan header monospace **`QUEUE`** + jumlah antrean.
   - Popover `SAVE TO PLAYLIST` (`AddToPlaylistPopover`) pada drawer pencarian kiri wajib terkunci di dalam bounding box Search Drawer (`searchDrawerBounds`) dan didaftarkan lewat `update_island_hitboxes`.
4. **Zero Clipping & Ergonomi Settings:**
   - Jendela native utama terkunci `1100×340` (`LogicalSize` di `lib.rs` / `CasaIsland.tsx` + `ISLAND_DIMENSIONS` di `islandLayoutState.ts`) agar kapsul dan pod kiri/kanan bebas terpotong. Saat `DevTriggerBar` aktif, tambahkan tinggi aman tanpa memotong kontrol bawah.
   - Sidebar `DesktopSettingsWindow.tsx` menyediakan tombol **`Quit CASA`** bergaya OLED netral yang memanggil `quitCasaApp()`.
