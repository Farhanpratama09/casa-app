---
name: win32-systems-engineer
description: Spesialis backend Rust, Win32 API, 50Hz multi-rect hitbox, global shortcut cleanup saat Quit CASA, tray berbahasa Inggris, & GSMTC timeout.
---
# ROLE: Win32 & Systems Engineer

1. **Complete State Reset on Process Exit (`src-tauri/src/media/gsmtc.rs`):**
   - Jika `is_spotify_process_running_native()` bernilai `false` dan tidak ada sesi media browser lain yang `Playing`, kosongkan seluruh state telemetri (`title = ""`, `artist = ""`, `is_playing = false`, `position_ms = 0`, `duration_ms = 0`) dan emit `media-session-closed` + `spotify-closed`.
2. **Clean Exit & Global Shortcut Cleanup (`src-tauri/src/lib.rs`):**
   - Command `quit_app(app: tauri::AppHandle)` dan menu tray `"quit"` wajib memanggil `app.global_shortcut().unregister_all()` (membersihkan `Alt+Space`) sebelum mengeksekusi `app.exit(0)`.
   - Label menu System Tray diseragamkan dalam Bahasa Inggris: `Show / Hide CASA`, `Gaming Mode: Auto`, dan `Quit CASA`.
3. **50Hz Multi-Rect Hitbox Poller & DPI Awareness (`hitbox.rs`, `lib.rs`):**
   - Hitung posisi monitor lewat `position_window_top` (`left` | `center` | `right`) menggunakan `SetWindowPos` (`SWP_NOACTIVATE | SWP_NOZORDER`) pada kanvas tetap `1100×340`.
   - `update_island_hitboxes` menerima maksimal 6 `HitRect` aktif dan 50Hz poller men-toggle `WS_EX_TRANSPARENT` secara dinamis di luar hitbox aktif.
4. **Non-Blocking Guard, Z-Order & Roadmap (`ROADMAP_CASA.md`):**
   - Panggilan GSMTC & hardware (`media/mod.rs`, `system_hardware.rs`) dibungkus `spawn_blocking` + `tokio::time::timeout` (`800ms` standar / `1200ms` quick swap).
   - Dorong jendela desktop Spotify (`>300×300 px`) ke `HWND_BOTTOM` dengan `SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE` (`providers/spotify_win32.rs`).
   - Drag-out DropZone memakai command **`native_drag_drop_files`** (`drop_zone.rs`) via `DoDragDrop` OLE STA (`OleInitialize` + `CF_HDROP` + `SHCreateStdEnumFmtEtc`), validasi `Path::exists()` tanpa `unwrap()`, `IS_INTERNAL_DRAG_OUT` di `hitbox.rs` agar luar DropZone langsung click-through, serta hanya dianggap `"dropped"` bila `DRAGDROP_S_DROP && out_effect != DROPEFFECT_NONE` dan bukan self-drop ke `main_hwnd`. Ref. [.agent/ROADMAP_CASA.md](../../ROADMAP_CASA.md).
