use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

#[derive(Clone, Copy, Debug, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct HitRect {
    /// Horizontal offset from window horizontal center in logical pixels.
    /// Center card/pill = 0.0, left detached pod < 0.0, right detached pod > 0.0.
    #[serde(default)]
    pub center_offset_x: f64,
    /// Vertical offset from window top in logical pixels.
    #[serde(default)]
    pub top_offset: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Copy, Debug)]
#[allow(dead_code)]
pub struct IslandHitbox {
    pub width: f64,
    pub height: f64,
}

static ACTIVE_HITBOXES: std::sync::LazyLock<Mutex<Vec<HitRect>>> = std::sync::LazyLock::new(|| {
    Mutex::new(vec![HitRect {
        center_offset_x: 0.0,
        top_offset: 0.0,
        width: 310.0,
        height: 42.0,
    }])
});

/// When Mode 6 is pinned/locked (`expanded`), disable global outside-click auto-dismiss
/// so the user can interact with other desktop apps while Mode 6 stays open.
static IS_EXPANDED_PINNED: AtomicBool = AtomicBool::new(false);

/// Tracks whether an OS native file drag-out (`DoDragDrop`) is currently running from DropZone.
/// While active, transparent regions outside the DropZone card immediately stay click-through
/// so Windows Desktop, File Explorer, and Electron targets (e.g. WhatsApp Desktop) accept drops.
static IS_INTERNAL_DRAG_OUT: AtomicBool = AtomicBool::new(false);

pub fn set_internal_drag_out(active: bool) {
    IS_INTERNAL_DRAG_OUT.store(active, Ordering::Relaxed);
}

pub fn set_hitbox(width: f64, height: f64) {
    set_hitboxes(vec![HitRect {
        center_offset_x: 0.0,
        top_offset: 0.0,
        width: width.max(10.0),
        height: height.max(4.0),
    }]);
}

pub fn set_hitboxes(rects: Vec<HitRect>) {
    let normalized: Vec<HitRect> = if rects.is_empty() {
        vec![HitRect {
            center_offset_x: 0.0,
            top_offset: 0.0,
            width: 310.0,
            height: 42.0,
        }]
    } else {
        rects
            .into_iter()
            .take(6)
            .map(|r| HitRect {
                center_offset_x: r.center_offset_x,
                top_offset: r.top_offset.max(0.0),
                width: r.width.max(10.0),
                height: r.height.max(4.0),
            })
            .collect()
    };

    if let Ok(mut hbs) = ACTIVE_HITBOXES.lock() {
        *hbs = normalized;
    }
}

#[allow(dead_code)]
pub fn get_hitbox() -> (f64, f64) {
    if let Ok(hbs) = ACTIVE_HITBOXES.lock() {
        if let Some(primary) = hbs
            .iter()
            .next()
            .or_else(|| hbs.first())
        {
            return (primary.width, primary.height);
        }
    }
    (310.0, 42.0)
}

pub fn get_hitboxes() -> Vec<HitRect> {
    if let Ok(hbs) = ACTIVE_HITBOXES.lock() {
        hbs.clone()
    } else {
        vec![HitRect {
            center_offset_x: 0.0,
            top_offset: 0.0,
            width: 310.0,
            height: 42.0,
        }]
    }
}

#[tauri::command]
pub fn update_island_hitbox(width: f64, height: f64) -> Result<(), String> {
    set_hitbox(width, height);
    Ok(())
}

#[tauri::command]
pub fn update_island_hitboxes(rects: Vec<HitRect>) -> Result<(), String> {
    set_hitboxes(rects);
    Ok(())
}

#[tauri::command]
pub fn set_island_pinned(pinned: bool) -> Result<(), String> {
    IS_EXPANDED_PINNED.store(pinned, Ordering::Relaxed);
    Ok(())
}

#[cfg(windows)]
pub fn start_hitbox_poller(window: tauri::WebviewWindow) {
    use tauri::Emitter;
    use windows_sys::Win32::Foundation::{HWND, POINT, RECT};
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetCursorPos, GetWindowRect};

    if let Ok(hwnd) = window.hwnd() {
        let hwnd_raw = hwnd.0 as HWND;
        let hwnd_val = hwnd_raw as isize;
        let window_clone = window.clone();

        std::thread::spawn(move || {
            let hwnd_raw = hwnd_val as HWND;
            let mut was_transparent = false;
            let mut was_lbutton_down = false;
            let mut pressed_outside_expanded = false;
            let mut poll_interval_ms: u64 = 16;

            loop {
                std::thread::sleep(std::time::Duration::from_millis(poll_interval_ms));

                let rects = get_hitboxes();
                let scale = window_clone.scale_factor().unwrap_or(1.0);

                unsafe {
                    let mut cursor = POINT { x: 0, y: 0 };
                    if GetCursorPos(&mut cursor) == 0 {
                        poll_interval_ms = 50;
                        continue;
                    }

                    let mut win_rect = RECT {
                        left: 0,
                        top: 0,
                        right: 0,
                        bottom: 0,
                    };
                    if GetWindowRect(hwnd_raw, &mut win_rect) == 0 {
                        poll_interval_ms = 50;
                        continue;
                    }

                    let win_width = win_rect.right - win_rect.left;
                    if win_width <= 0 {
                        poll_interval_ms = 50;
                        continue;
                    }

                    let internal_drag_out = IS_INTERNAL_DRAG_OUT.load(Ordering::Relaxed);

                    // 60Hz adaptive cursor polling (~16ms) inside top 140 logical px lip (or during DropZone drag-out), 50ms elsewhere
                    let top_zone_bottom = win_rect.top + (140.0 * scale).round() as i32;
                    poll_interval_ms = if internal_drag_out || cursor.y <= top_zone_bottom {
                        16
                    } else {
                        50
                    };

                    let center_x = (win_rect.left + win_rect.right) / 2;
                    let multi_rect_mode = rects.len() > 1;
                    // Keep inter-pod gaps (10px) strictly click-through when satellite pods are open,
                    // and keep exact bounds during native DropZone drag-out.
                    let safety_buffer = if internal_drag_out {
                        0
                    } else if multi_rect_mode {
                        (2.0 * scale).round() as i32
                    } else {
                        (4.0 * scale).round() as i32
                    };
                    let shoulder_buffer = (12.0 * scale).round() as i32;
                    let shoulder_band_h = (14.0 * scale).round() as i32;
                    let drag_x_margin = (24.0 * scale).round() as i32;
                    let drag_y_margin = (48.0 * scale).round() as i32;

                    let is_lbutton_down =
                        (GetAsyncKeyState(VK_LBUTTON as i32) as u16 & 0x8000) != 0;

                    // Magnetic Top-Notch Drag Corridor: active ONLY while mouse button is held
                    // so dragging a file from Explorer toward the notch reliably disables WS_EX_TRANSPARENT
                    // before cursor touches the narrow idle/tucked capsule.
                    let primary_rect = rects.first();
                    let primary_center_x = primary_rect
                        .map(|r| center_x + (r.center_offset_x * scale).round() as i32)
                        .unwrap_or(center_x);
                    let primary_top = primary_rect
                        .map(|r| win_rect.top + (r.top_offset * scale).round() as i32)
                        .unwrap_or(win_rect.top);
                    let notch_drag_half_w = (340.0 * scale).round() as i32;
                    let notch_drag_h = (88.0 * scale).round() as i32;
                    let in_magnetic_top_drag_corridor = !internal_drag_out
                        && is_lbutton_down
                        && primary_rect.is_some()
                        && cursor.x >= (primary_center_x - notch_drag_half_w)
                        && cursor.x <= (primary_center_x + notch_drag_half_w)
                        && cursor.y >= primary_top
                        && cursor.y <= (primary_top + notch_drag_h).min(win_rect.bottom);

                    let mut is_cursor_inside = false;
                    let mut is_approaching_drag = in_magnetic_top_drag_corridor;
                    let mut is_expanded_mode = false;

                    for (idx, r) in rects.iter().enumerate() {
                        if r.height >= 120.0 {
                            is_expanded_mode = true;
                        }

                        let phys_hb_w = (r.width * scale).round() as i32;
                        let phys_hb_h = (r.height * scale).round() as i32;
                        let rect_center_x = center_x + (r.center_offset_x * scale).round() as i32;

                        let left = rect_center_x - (phys_hb_w / 2) - safety_buffer;
                        let right = rect_center_x + (phys_hb_w / 2) + safety_buffer;
                        let top = win_rect.top + (r.top_offset * scale).round() as i32;
                        let bottom = top + phys_hb_h + safety_buffer;

                        let in_rect = cursor.x >= left
                            && cursor.x <= right
                            && cursor.y >= top
                            && cursor.y <= bottom;

                        // Concave top-bezel shoulders only span the top 14px of the full-height center card,
                        // leaving tucked hover strips (<= 24px) and 10px pod gaps strictly compact.
                        let is_top_center_card = idx == 0 && r.top_offset <= 2.0 && r.height > 24.0;
                        let in_top_shoulder = !internal_drag_out
                            && is_top_center_card
                            && cursor.x >= (left - shoulder_buffer)
                            && cursor.x <= (right + shoulder_buffer)
                            && cursor.y >= top
                            && cursor.y <= (top + shoulder_band_h);

                        if in_rect || in_top_shoulder {
                            is_cursor_inside = true;
                        }

                        if !internal_drag_out
                            && is_lbutton_down
                            && cursor.x >= (left - drag_x_margin)
                            && cursor.x <= (right + drag_x_margin)
                            && cursor.y >= top
                            && cursor.y <= (bottom + drag_y_margin).min(win_rect.bottom)
                        {
                            is_approaching_drag = true;
                        }
                    }

                    // Global Click-Outside Detection for non-pinned expanded/peek modes:
                    // Skips emission while Mode 6 is explicitly pinned (`IS_EXPANDED_PINNED = true`).
                    let is_pinned = IS_EXPANDED_PINNED.load(Ordering::Relaxed);
                    if is_expanded_mode && !is_pinned {
                        if !was_lbutton_down && is_lbutton_down {
                            pressed_outside_expanded = !is_cursor_inside;
                        } else if was_lbutton_down && !is_lbutton_down {
                            if pressed_outside_expanded && !is_cursor_inside {
                                let _ = window_clone.emit("casa://outside-click", ());
                            }
                            pressed_outside_expanded = false;
                        }
                    } else {
                        pressed_outside_expanded = false;
                    }
                    was_lbutton_down = is_lbutton_down;

                    let should_be_transparent = if internal_drag_out {
                        !is_cursor_inside
                    } else if is_cursor_inside || is_approaching_drag {
                        false
                    } else if !was_transparent && is_lbutton_down {
                        false // maintain active window while user is dragging
                    } else {
                        true
                    };

                    if should_be_transparent != was_transparent {
                        // Use official Tauri API which propagates click-through down to child WebView2 layers
                        let _ = window_clone.set_ignore_cursor_events(should_be_transparent);
                        was_transparent = should_be_transparent;
                    }
                }
            }
        });
    }
}

#[cfg(not(windows))]
pub fn start_hitbox_poller(_window: tauri::WebviewWindow) {}
