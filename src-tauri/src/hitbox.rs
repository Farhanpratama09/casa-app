use std::sync::Mutex;

#[derive(Clone, Copy, Debug)]
pub struct IslandHitbox {
    pub width: f64,
    pub height: f64,
}

static ACTIVE_HITBOX: std::sync::LazyLock<Mutex<IslandHitbox>> = std::sync::LazyLock::new(|| {
    Mutex::new(IslandHitbox {
        width: 310.0,
        height: 42.0,
    })
});

pub fn set_hitbox(width: f64, height: f64) {
    if let Ok(mut hb) = ACTIVE_HITBOX.lock() {
        hb.width = width.max(10.0);
        hb.height = height.max(10.0);
    }
}

pub fn get_hitbox() -> (f64, f64) {
    if let Ok(hb) = ACTIVE_HITBOX.lock() {
        (hb.width, hb.height)
    } else {
        (310.0, 42.0)
    }
}

#[tauri::command]
pub fn update_island_hitbox(width: f64, height: f64) -> Result<(), String> {
    set_hitbox(width, height);
    Ok(())
}

#[cfg(windows)]
pub fn start_hitbox_poller(window: tauri::WebviewWindow) {
    use windows_sys::Win32::Foundation::{HWND, POINT, RECT};
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetCursorPos, GetWindowRect};
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};

    if let Ok(hwnd) = window.hwnd() {
        let hwnd_raw = hwnd.0 as HWND;
        let hwnd_val = hwnd_raw as isize;
        let window_clone = window.clone();

        std::thread::spawn(move || {
            let hwnd_raw = hwnd_val as HWND;
            let mut was_transparent = false;

            loop {
                std::thread::sleep(std::time::Duration::from_millis(20)); // 50Hz polling rate

                let (hb_w, hb_h) = get_hitbox();
                let scale = window_clone.scale_factor().unwrap_or(1.0);

                unsafe {
                    let mut cursor = POINT { x: 0, y: 0 };
                    if GetCursorPos(&mut cursor) == 0 {
                        continue;
                    }

                    let mut win_rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };
                    if GetWindowRect(hwnd_raw, &mut win_rect) == 0 {
                        continue;
                    }

                    let win_width = win_rect.right - win_rect.left;
                    if win_width <= 0 {
                        continue;
                    }

                    // Physical dimensions calculated from frontend logical hitbox and screen scale factor
                    let phys_hb_w = (hb_w * scale).round() as i32;
                    let phys_hb_h = (hb_h * scale).round() as i32;

                    let center_x = (win_rect.left + win_rect.right) / 2;
                    let safety_buffer = (4.0 * scale).round() as i32;

                    let left = center_x - (phys_hb_w / 2) - safety_buffer;
                    let right = center_x + (phys_hb_w / 2) + safety_buffer;
                    let top = win_rect.top;
                    let bottom = win_rect.top + phys_hb_h + safety_buffer;

                    let is_cursor_inside = cursor.x >= left
                        && cursor.x <= right
                        && cursor.y >= top
                        && cursor.y <= bottom;

                    // Anti-Drag Protection:
                    // If left mouse button is pressed and we were previously NOT transparent (user is clicking or dragging),
                    // maintain interactive state until the user releases the mouse button.
                    let is_lbutton_down = (GetAsyncKeyState(VK_LBUTTON as i32) as u16 & 0x8000) != 0;
                    let should_be_transparent = if !is_cursor_inside {
                        if !was_transparent && is_lbutton_down {
                            false // maintain active window while user is dragging
                        } else {
                            true
                        }
                    } else {
                        false
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
