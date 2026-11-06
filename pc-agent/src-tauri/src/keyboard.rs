//! Blocks the keys that escape a full-screen window (Win, Alt+Tab, Alt+F4, Alt+Esc, Ctrl+Esc,
//! Ctrl+Shift+Esc, the menu key), only while the PC is locked.
//!
//! The low-level hook is installed when the lock screen shows and removed as soon as the PC unlocks,
//! so it adds no input delay during games. Ctrl+Alt+Del can't be blocked by any app; that is handled
//! with Windows policy (see pc-agent/README.md).

#[cfg(windows)]
mod imp {
    use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
    use windows::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::System::Threading::GetCurrentThreadId;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, VK_APPS, VK_CONTROL, VK_ESCAPE, VK_F4, VK_LWIN, VK_RWIN, VK_TAB,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, DispatchMessageW, GetForegroundWindow, GetMessageW, GetWindowThreadProcessId,
        PeekMessageW, PostThreadMessageW, SetWindowsHookExW, ShowWindow, TranslateMessage,
        UnhookWindowsHookEx, HHOOK, KBDLLHOOKSTRUCT, LLKHF_ALTDOWN, MSG, PM_NOREMOVE, SW_MINIMIZE, WH_KEYBOARD_LL,
        WM_APP,
    };

    static THREAD_ID: AtomicU32 = AtomicU32::new(0);
    static BLOCKING: AtomicBool = AtomicBool::new(false);
    const WM_SET: u32 = WM_APP + 1;

    unsafe extern "system" fn hook_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code == 0 {
            let kb = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
            let vk = kb.vkCode;
            let alt = (kb.flags.0 & LLKHF_ALTDOWN.0) != 0;
            let ctrl = GetAsyncKeyState(VK_CONTROL.0 as i32) < 0;
            let is = |k: u16| vk == k as u32;
            let block = is(VK_LWIN.0)
                || is(VK_RWIN.0)
                || is(VK_APPS.0)
                || (alt && (is(VK_TAB.0) || is(VK_F4.0) || is(VK_ESCAPE.0)))
                || (ctrl && is(VK_ESCAPE.0));
            if block {
                return LRESULT(1);
            }
        }
        CallNextHookEx(HHOOK(std::ptr::null_mut()), code, wparam, lparam)
    }

    /// Starts the hook thread (once). It owns the hook and its message loop.
    pub fn start() {
        std::thread::spawn(|| unsafe {
            let mut msg = MSG::default();
            // Create this thread's message queue before anyone posts to it.
            let _ = PeekMessageW(&mut msg, HWND(std::ptr::null_mut()), 0, 0, PM_NOREMOVE);
            THREAD_ID.store(GetCurrentThreadId(), Ordering::SeqCst);

            let mut hook: Option<HHOOK> = None;
            let apply = |hook: &mut Option<HHOOK>| {
                let want = BLOCKING.load(Ordering::SeqCst);
                if want && hook.is_none() {
                    let module = GetModuleHandleW(None).map(|m| HINSTANCE(m.0)).unwrap_or(HINSTANCE(std::ptr::null_mut()));
                    *hook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook_proc), module, 0).ok();
                } else if !want {
                    if let Some(h) = hook.take() {
                        let _ = UnhookWindowsHookEx(h);
                    }
                }
            };
            apply(&mut hook);
            while GetMessageW(&mut msg, HWND(std::ptr::null_mut()), 0, 0).as_bool() {
                if msg.message == WM_SET {
                    apply(&mut hook);
                } else {
                    let _ = TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            }
        });
    }

    pub fn set_blocking(on: bool) {
        if BLOCKING.swap(on, Ordering::SeqCst) == on {
            return;
        }
        let tid = THREAD_ID.load(Ordering::SeqCst);
        if tid != 0 {
            unsafe {
                let _ = PostThreadMessageW(tid, WM_SET, WPARAM(0), LPARAM(0));
            }
        }
    }

    /// Shows the timer on top without activating it, so a game in front keeps focus. The window
    /// is also marked "no activate", so clicking or dragging it doesn't steal focus either.
    pub fn show_without_focus(raw: isize) {
        use windows::Win32::UI::WindowsAndMessaging::{
            GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, HWND_TOPMOST, SWP_NOACTIVATE,
            SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW, SW_SHOWNOACTIVATE, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
        };
        let hwnd = HWND(raw as *mut core::ffi::c_void);
        unsafe {
            let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            let want = style | (WS_EX_NOACTIVATE.0 | WS_EX_TOOLWINDOW.0) as isize;
            if want != style {
                SetWindowLongPtrW(hwnd, GWL_EXSTYLE, want);
            }
            let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
            let _ = SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW);
        }
    }

    /// Minimizes the game in front (unless it is this app) so the lock screen can show over
    /// exclusive full-screen games.
    pub fn minimize_foreground() {
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.0.is_null() {
                return;
            }
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            if pid != std::process::id() {
                let _ = ShowWindow(hwnd, SW_MINIMIZE);
            }
        }
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn start() {}
    pub fn set_blocking(_on: bool) {}
    pub fn minimize_foreground() {}
    pub fn show_without_focus(_raw: isize) {}
}

pub use imp::{minimize_foreground, set_blocking, show_without_focus, start};
