//! Low-level hooks and the clipboard listener. Everything here runs on the thread that owns the
//! message loop, so callbacks only read what they must (clipboard text) and queue a signal.

use crate::{now_ms, Signal, RECORDING};
use std::sync::atomic::Ordering;
use std::sync::mpsc::Sender;
use std::sync::{Mutex, OnceLock};
use windows::core::{w, Result};
use windows::Win32::Foundation::{HANDLE, HGLOBAL, HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::DataExchange::{
    AddClipboardFormatListener, CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};
use windows::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
use windows::Win32::UI::HiDpi::{SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, GetDoubleClickTime, VK_CONTROL, VK_MENU};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, RegisterClassW,
    SetWindowsHookExW, TranslateMessage, EVENT_SYSTEM_FOREGROUND, HHOOK, HWND_MESSAGE, KBDLLHOOKSTRUCT, MSG,
    MSLLHOOKSTRUCT, WH_KEYBOARD_LL, WH_MOUSE_LL, WINDOW_EX_STYLE, WINDOW_STYLE, WINEVENT_OUTOFCONTEXT, WM_KEYDOWN,
    WM_LBUTTONDOWN, WM_RBUTTONDOWN, WM_SYSKEYDOWN, WNDCLASSW,
};

const WM_CLIPBOARDUPDATE: u32 = 0x031D;
const CF_UNICODETEXT: u32 = 13;
const LLKHF_INJECTED: u32 = 0x10;
const LLMHF_INJECTED: u32 = 0x01;
const MAX_CLIPBOARD_CHARS: usize = 2000;

static TX: OnceLock<Sender<Signal>> = OnceLock::new();
static LAST_CLICK: Mutex<(u64, i32, i32)> = Mutex::new((0, 0, 0));
static LAST_CLIP: Mutex<(u64, String)> = Mutex::new((0, String::new()));

fn send(s: Signal) {
    if let Some(tx) = TX.get() {
        let _ = tx.send(s);
    }
}

fn recording() -> bool {
    RECORDING.load(Ordering::Relaxed)
}

pub fn run(tx: Sender<Signal>) -> Result<()> {
    let _ = TX.set(tx);
    unsafe {
        // Physical pixels everywhere, so UI Automation rectangles line up with the screen video.
        let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);

        let module = GetModuleHandleW(None)?;
        let _mouse: HHOOK = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_proc), Some(module.into()), 0)?;
        let _keys: HHOOK = SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_proc), Some(module.into()), 0)?;
        let _fg: HWINEVENTHOOK = SetWinEventHook(
            EVENT_SYSTEM_FOREGROUND,
            EVENT_SYSTEM_FOREGROUND,
            None,
            Some(foreground_proc),
            0,
            0,
            WINEVENT_OUTOFCONTEXT,
        );

        // A message-only window that receives clipboard change notifications.
        let class = w!("MclTraceClipboard");
        let wc = WNDCLASSW { lpfnWndProc: Some(clip_wndproc), hInstance: module.into(), lpszClassName: class, ..Default::default() };
        RegisterClassW(&wc);
        let hwnd = CreateWindowExW(
            WINDOW_EX_STYLE(0),
            class,
            w!("Trace clipboard"),
            WINDOW_STYLE(0),
            0,
            0,
            0,
            0,
            Some(HWND_MESSAGE),
            None,
            Some(module.into()),
            None,
        )?;
        AddClipboardFormatListener(hwnd)?;

        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
    Ok(())
}

unsafe extern "system" fn mouse_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 && recording() {
        let msg = wparam.0 as u32;
        if msg == WM_LBUTTONDOWN || msg == WM_RBUTTONDOWN {
            let info = &*(lparam.0 as *const MSLLHOOKSTRUCT);
            if info.flags & LLMHF_INJECTED == 0 {
                let ts = now_ms();
                let (x, y) = (info.pt.x, info.pt.y);
                let mut double = false;
                if msg == WM_LBUTTONDOWN {
                    if let Ok(mut last) = LAST_CLICK.lock() {
                        let window = GetDoubleClickTime() as u64;
                        double = ts.saturating_sub(last.0) <= window && (x - last.1).abs() <= 4 && (y - last.2).abs() <= 4;
                        *last = if double { (0, 0, 0) } else { (ts, x, y) };
                    }
                }
                let button = if msg == WM_LBUTTONDOWN { "left" } else { "right" };
                send(Signal::Click { ts, x, y, double, button });
            }
        }
    }
    CallNextHookEx(None, code, wparam, lparam)
}

unsafe extern "system" fn keyboard_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 && recording() {
        let msg = wparam.0 as u32;
        if msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN {
            let info = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
            if info.flags.0 & LLKHF_INJECTED == 0 {
                let ts = now_ms();
                let ctrl = GetAsyncKeyState(VK_CONTROL.0 as i32) < 0;
                let alt = GetAsyncKeyState(VK_MENU.0 as i32) < 0;
                let vk = info.vkCode;
                let shortcut = match (ctrl, vk) {
                    (true, 0x43) => Some("Ctrl+C"),
                    (true, 0x56) => Some("Ctrl+V"),
                    (true, 0x58) => Some("Ctrl+X"),
                    (true, 0x53) => Some("Ctrl+S"),
                    (true, 0x41) => Some("Ctrl+A"),
                    (true, 0x5A) => Some("Ctrl+Z"),
                    (_, 0x0D) => Some("Enter"),
                    (_, 0x09) => Some("Tab"),
                    (_, 0x1B) => Some("Escape"),
                    _ => None,
                };
                if let Some(keys) = shortcut {
                    send(Signal::Shortcut { ts, keys });
                } else if !ctrl && !alt && is_typing_key(vk) {
                    // Which key is never sent: only that something was typed.
                    send(Signal::Typed { ts });
                }
            }
        }
    }
    CallNextHookEx(None, code, wparam, lparam)
}

/// Keys that change a text field's value: letters, digits, space, punctuation, backspace, delete.
fn is_typing_key(vk: u32) -> bool {
    matches!(vk, 0x08 | 0x20 | 0x2E | 0x30..=0x39 | 0x41..=0x5A | 0x60..=0x6F | 0xBA..=0xC0 | 0xDB..=0xDF | 0xE2)
}

unsafe extern "system" fn foreground_proc(
    _hook: HWINEVENTHOOK,
    _event: u32,
    hwnd: HWND,
    _id_object: i32,
    _id_child: i32,
    _thread: u32,
    _time: u32,
) {
    if recording() && !hwnd.is_invalid() {
        send(Signal::Foreground { ts: now_ms(), hwnd: hwnd.0 as isize });
    }
}

unsafe extern "system" fn clip_wndproc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if msg == WM_CLIPBOARDUPDATE {
        if recording() {
            let ts = now_ms();
            if let Some(text) = read_clipboard_text(hwnd) {
                // Many apps update the clipboard twice per copy; report it once.
                let repeat = LAST_CLIP
                    .lock()
                    .map(|mut last| {
                        let same = last.1 == text && ts.saturating_sub(last.0) < 500;
                        *last = (ts, text.clone());
                        same
                    })
                    .unwrap_or(false);
                if !repeat {
                    send(Signal::Clipboard { ts, text });
                }
            }
        }
        return LRESULT(0);
    }
    DefWindowProcW(hwnd, msg, wparam, lparam)
}

unsafe fn read_clipboard_text(hwnd: HWND) -> Option<String> {
    if IsClipboardFormatAvailable(CF_UNICODETEXT).is_err() {
        return None;
    }
    // The app that just copied may still hold the clipboard for a moment.
    let mut opened = false;
    for _ in 0..5 {
        if OpenClipboard(Some(hwnd)).is_ok() {
            opened = true;
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(15));
    }
    if !opened {
        return None;
    }
    let mut out = None;
    if let Ok(handle) = GetClipboardData(CF_UNICODETEXT) {
        let global = HGLOBAL(handle.0);
        let ptr = GlobalLock(global) as *const u16;
        if !ptr.is_null() {
            let max = GlobalSize(global) / 2;
            let mut len = 0usize;
            while len < max && *ptr.add(len) != 0 {
                len += 1;
            }
            let slice = std::slice::from_raw_parts(ptr, len);
            let text: String = String::from_utf16_lossy(slice).chars().take(MAX_CLIPBOARD_CHARS).collect();
            out = Some(text);
            let _ = GlobalUnlock(global);
        }
        let _: HANDLE = handle;
    }
    let _ = CloseClipboard();
    out
}
