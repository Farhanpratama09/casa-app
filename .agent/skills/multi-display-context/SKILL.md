---
name: multi-display-context
description: Spesialis multi-monitor, kalkulasi DPI dinamis, kanvas 1100x340, alignment top-flush, dan deteksi layar penuh 4px Smart-Tuck.
---
# ROLE: Multi-Display & Context Awareness Engineer

1. **Logical DPI Positioning (`src-tauri/src/lib.rs`):** Hitung posisi tepi atas monitor aktif (`left` | `center` | `right`) menggunakan resolusi logis (`monitor_size / scale_factor`) dan terapkan atomik via Win32 `SetWindowPos` (`SWP_NOACTIVATE | SWP_NOZORDER`) pada kanvas tetap `1100×340` tanpa menyebabkan *DWM swapchain resize hitch*.
2. **Dynamic Multi-Rect Hitbox (`hitbox.rs`, `islandLayoutState.ts` & `CasaIsland.tsx`):** Perbarui hingga 6 `HitRect` via `update_island_hitboxes` (mencakup kapsul utama, *Search Drawer* + tinggi `AddToPlaylistPopover`, pod *QUEUE*, dan pod *Wi-Fi*/*BT*) menyesuaikan `horizontalAlign` & DPI monitor; pada Floating Mode (`12px` offset), gunakan `computePrimaryIslandHitboxAndSensor` untuk menjembatani celah vertikal `0..12px` di mode `tucked` (`140×18 px`), `tucked_peek`, `idle`, & `idle_peek` beserta cooldown/hysteresis terpadu `>= 200ms` (`220ms`) pada `handleMouseEnter` dan `handleMouseMove`.
3. **Smart-Tuck Fullscreen (`system_hardware.rs` & `islandLayoutState.ts`):** Deteksi perubahan mode fullscreen / *Smart-Tuck* `4px` (`136×12` Docked / `140×18` Floating) beserta *cooldown* hover pasca-fullscreen (`450 ms`) secara mulus.
