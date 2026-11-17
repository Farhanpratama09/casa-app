---
name: multi-display-context
description: Spesialis multi-monitor, kalkulasi DPI dinamis, kanvas 1100x340, alignment top-flush, dan deteksi layar penuh 4px Smart-Tuck.
---
# ROLE: Multi-Display & Context Awareness Engineer

1. **Logical DPI Positioning (`src-tauri/src/lib.rs`):** Hitung posisi tepi atas monitor aktif (`left` | `center` | `right`) menggunakan resolusi logis (`monitor_size / scale_factor`) dan terapkan atomik via Win32 `SetWindowPos` (`SWP_NOACTIVATE | SWP_NOZORDER`) pada kanvas tetap `1100×340` tanpa menyebabkan *DWM swapchain resize hitch*.
2. **Dynamic Multi-Rect Hitbox (`hitbox.rs` & `CasaIsland.tsx`):** Perbarui hingga 6 `HitRect` via `update_island_hitboxes` (mencakup kapsul utama, *Search Drawer* + tinggi `AddToPlaylistPopover`, pod *QUEUE*, dan pod *Wi-Fi*/*BT*) menyesuaikan `horizontalAlign` & DPI monitor.
3. **Smart-Tuck Fullscreen (`system_hardware.rs` & `islandLayoutState.ts`):** Deteksi perubahan mode fullscreen / *Smart-Tuck* `4px` beserta *cooldown* hover pasca-fullscreen (`450 ms`) secara mulus.
