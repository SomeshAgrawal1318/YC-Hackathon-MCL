//! The UI Automation worker. Turns hook signals into events that name the element involved:
//! its role, name, AutomationId, ancestor path, screen rectangle and (for fields) its value.

use crate::{emit, emit_error, Signal};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::time::{Duration, Instant};
use windows::core::PWSTR;
use windows::Win32::Foundation::{CloseHandle, HWND, POINT};
use windows::Win32::System::Variant::VARIANT;
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationTreeWalker, IUIAutomationValuePattern,
    TreeScope_Descendants, UIA_ControlTypePropertyId, UIA_ValuePatternId,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetAncestor, GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId, WindowFromPoint, GA_ROOT,
};

/// Typing is reported as one `value` event once it pauses this long.
const TYPING_IDLE: Duration = Duration::from_millis(300);
/// After Ctrl+V the field's new value is read this long after the paste.
const PASTE_SETTLE: Duration = Duration::from_millis(200);
const MAX_WALK: usize = 30;
const MAX_PATH: usize = 10;
const MAX_VALUE_CHARS: usize = 500;

#[derive(Serialize, Default)]
struct Element {
    role: String,
    name: String,
    #[serde(rename = "automationId")]
    automation_id: String,
    #[serde(rename = "className")]
    class_name: String,
    path: Vec<String>,
    rect: [i32; 4],
    #[serde(skip_serializing_if = "Option::is_none")]
    value: Option<String>,
    #[serde(rename = "isPassword", skip_serializing_if = "std::ops::Not::not")]
    is_password: bool,
    /// The page URL when the element sits inside a browser document.
    #[serde(skip)]
    url: Option<String>,
}

#[derive(Serialize)]
struct Event {
    #[serde(rename = "type")]
    kind_type: &'static str,
    kind: &'static str,
    ts: u64,
    hwnd: isize,
    process: String,
    window: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    element: Option<Element>,
    #[serde(skip_serializing_if = "Option::is_none")]
    point: Option<[i32; 2]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    keys: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    button: Option<&'static str>,
    /// Page URL for browser windows (used to tell Gmail from Odoo).
    #[serde(skip_serializing_if = "Option::is_none")]
    url: Option<String>,
}

impl Event {
    fn new(kind: &'static str, ts: u64, hwnd: HWND) -> Self {
        let (process, window) = window_info(hwnd);
        Event {
            kind_type: "event",
            kind,
            ts,
            hwnd: hwnd.0 as isize,
            process,
            window,
            element: None,
            point: None,
            keys: None,
            text: None,
            button: None,
            url: None,
        }
    }
}

/// A field being typed into (or pasted into): read its value when the input settles.
struct Pending {
    element: IUIAutomationElement,
    hwnd: HWND,
    last_ts: u64,
    due: Instant,
    pasted: bool,
}

/// A field the person focused recently. Its value is re-read after clicks, so values that are
/// picked rather than typed (dropdowns, date pickers, catalogs) are reported too.
struct Tracked {
    element: IUIAutomationElement,
    hwnd: HWND,
    last: Option<String>,
}

/// Fields are re-checked this long after a click, once the app has applied the change.
const CHECK_DELAY: Duration = Duration::from_millis(600);
/// When a click lands on an unnamed container, use the element that got focus this soon after.
const FOCUS_FALLBACK: Duration = Duration::from_millis(120);
const MAX_TRACKED: usize = 8;

struct Uia {
    automation: IUIAutomation,
    walker: IUIAutomationTreeWalker,
}

pub fn run(rx: Receiver<Signal>) {
    let uia = unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let automation: IUIAutomation = match CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER) {
            Ok(a) => a,
            Err(e) => {
                emit_error(format!("UI Automation unavailable: {e}"));
                return;
            }
        };
        let walker = match automation.ControlViewWalker() {
            Ok(w) => w,
            Err(e) => {
                emit_error(format!("UI Automation walker unavailable: {e}"));
                return;
            }
        };
        Uia { automation, walker }
    };

    let mut pending: Option<Pending> = None;
    let mut tracked: Vec<Tracked> = Vec::new();
    let mut check_due: Option<Instant> = None;
    // Last title seen per window: a click that changes it (opening an email, say) is reported.
    let mut titles: HashMap<isize, String> = HashMap::new();
    loop {
        let due = match (pending.as_ref().map(|p| p.due), check_due) {
            (Some(a), Some(b)) => Some(a.min(b)),
            (a, b) => a.or(b),
        };
        let signal = match due {
            Some(d) => match rx.recv_timeout(d.saturating_duration_since(Instant::now())) {
                Ok(s) => Some(s),
                Err(RecvTimeoutError::Timeout) => None,
                Err(RecvTimeoutError::Disconnected) => return,
            },
            None => match rx.recv() {
                Ok(s) => Some(s),
                Err(_) => return,
            },
        };

        let Some(signal) = signal else {
            let now = Instant::now();
            if pending.as_ref().map(|p| p.due <= now).unwrap_or(false) {
                let p = pending.take().unwrap();
                uia.flush(p, &mut tracked);
            }
            if check_due.map(|d| d <= now).unwrap_or(false) {
                check_due = None;
                uia.check_fields(&mut tracked);
                let fg = unsafe { GetForegroundWindow() };
                let ev = Event::new("title", crate::now_ms(), fg);
                if titles.get(&ev.hwnd) != Some(&ev.window) {
                    titles.insert(ev.hwnd, ev.window.clone());
                    uia.send(ev);
                }
            }
            continue;
        };

        match signal {
            Signal::Typed { ts } => {
                let due = Instant::now() + TYPING_IDLE;
                match pending.as_mut() {
                    Some(p) => {
                        p.last_ts = ts;
                        p.due = due;
                    }
                    None => {
                        if let Some((element, hwnd)) = uia.focused() {
                            pending = Some(Pending { element, hwnd, last_ts: ts, due, pasted: false });
                        }
                    }
                }
            }
            Signal::Shortcut { ts, keys } => {
                // Tab and Enter move on from a field: report what was typed before the focus changes.
                if let Some(p) = pending.take() {
                    uia.flush(p, &mut tracked);
                }
                let focused = uia.focused();
                let hwnd = focused.as_ref().map(|f| f.1).unwrap_or_else(|| unsafe { GetForegroundWindow() });
                let mut ev = Event::new("shortcut", ts, hwnd);
                ev.keys = Some(keys);
                ev.element = focused.as_ref().map(|(el, h)| uia.describe(el, *h, false));
                uia.send(ev);
                if keys == "Ctrl+V" {
                    if let Some((element, hwnd)) = focused {
                        pending = Some(Pending { element, hwnd, last_ts: ts, due: Instant::now() + PASTE_SETTLE, pasted: true });
                    }
                }
                check_due = Some(Instant::now() + CHECK_DELAY);
            }
            Signal::Click { ts, x, y, double, button } => {
                if let Some(p) = pending.take() {
                    uia.flush(p, &mut tracked);
                }
                // The click may have changed a field used before (a dropdown pick, say).
                uia.check_fields(&mut tracked);
                let pt = POINT { x, y };
                let hwnd = unsafe { GetAncestor(WindowFromPoint(pt), GA_ROOT) };
                let mut ev = Event::new(if double { "dblclick" } else { "click" }, ts, hwnd);
                ev.point = Some([x, y]);
                ev.button = Some(button);
                let mut target = unsafe { uia.automation.ElementFromPoint(pt) }.ok();
                if target.as_ref().map(is_container).unwrap_or(false) {
                    std::thread::sleep(FOCUS_FALLBACK);
                    if let Some((focused, _)) = uia.focused() {
                        if is_field(&focused) || role_of(&focused) == 50000 {
                            target = Some(focused);
                        }
                    }
                }
                ev.element = target.map(|el| uia.describe(&el, hwnd, true));
                uia.send(ev);
                check_due = Some(Instant::now() + CHECK_DELAY);
            }
            Signal::Clipboard { ts, text } => {
                let focused = uia.focused();
                let hwnd = focused.as_ref().map(|f| f.1).unwrap_or_else(|| unsafe { GetForegroundWindow() });
                let mut ev = Event::new("clipboard", ts, hwnd);
                ev.text = Some(text);
                ev.element = focused.map(|(el, h)| uia.describe(&el, h, false));
                uia.send(ev);
            }
            Signal::Foreground { ts, hwnd } => {
                if let Some(p) = pending.take() {
                    uia.flush(p, &mut tracked);
                }
                uia.check_fields(&mut tracked);
                let ev = Event::new("foreground", ts, HWND(hwnd as *mut _));
                titles.insert(ev.hwnd, ev.window.clone());
                uia.send(ev);
            }
        }
    }
}

fn role_of(el: &IUIAutomationElement) -> i32 {
    unsafe { el.CurrentControlType().map(|t| t.0).unwrap_or(0) }
}

/// Text fields and combo boxes (Chrome inputs, Odoo's search-and-pick fields), never passwords.
fn is_field(el: &IUIAutomationElement) -> bool {
    matches!(role_of(el), 50003 | 50004) && unsafe { !el.CurrentIsPassword().map(|b| b.as_bool()).unwrap_or(true) }
}

/// An unnamed layout element: a click on it says little about what the person meant.
fn is_container(el: &IUIAutomationElement) -> bool {
    let unnamed = unsafe { el.CurrentName().map(|n| n.to_string().trim().is_empty()).unwrap_or(true) };
    unnamed && matches!(role_of(el), 50025 | 50026 | 50030 | 50033 | 0)
}

impl Uia {
    fn focused(&self) -> Option<(IUIAutomationElement, HWND)> {
        unsafe {
            let el = self.automation.GetFocusedElement().ok()?;
            Some((el, GetForegroundWindow()))
        }
    }

    fn same(&self, a: &IUIAutomationElement, b: &IUIAutomationElement) -> bool {
        unsafe { self.automation.CompareElements(a, b).map(|r| r.as_bool()).unwrap_or(false) }
    }

    fn value_of(&self, el: &IUIAutomationElement) -> Option<String> {
        unsafe {
            el.GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
                .ok()?
                .CurrentValue()
                .ok()
                .map(|v| v.to_string().chars().take(MAX_VALUE_CHARS).collect())
        }
    }

    /// Remembers the focused field, and reports any tracked field whose value changed.
    fn check_fields(&self, tracked: &mut Vec<Tracked>) {
        if let Some((el, hwnd)) = self.focused() {
            if is_field(&el) && !tracked.iter().any(|t| self.same(&t.element, &el)) {
                let last = self.value_of(&el);
                tracked.push(Tracked { element: el, hwnd, last });
                if tracked.len() > MAX_TRACKED {
                    tracked.remove(0);
                }
            }
        }
        let mut gone = Vec::new();
        for (i, t) in tracked.iter_mut().enumerate() {
            let Some(now) = self.value_of(&t.element) else {
                gone.push(i);
                continue;
            };
            if t.last.as_deref() != Some(now.as_str()) {
                t.last = Some(now);
                let mut ev = Event::new("value", crate::now_ms(), t.hwnd);
                ev.element = Some(self.describe(&t.element, t.hwnd, true));
                self.send(ev);
            }
        }
        for i in gone.into_iter().rev() {
            tracked.remove(i);
        }
    }

    fn flush(&self, p: Pending, tracked: &mut Vec<Tracked>) {
        let mut ev = Event::new("value", p.last_ts, p.hwnd);
        let el = self.describe(&p.element, p.hwnd, true);
        if el.is_password {
            return;
        }
        if p.pasted {
            ev.keys = Some("Ctrl+V");
        }
        // Remember what was reported, so the next field check doesn't report it again.
        match tracked.iter_mut().find(|t| self.same(&t.element, &p.element)) {
            Some(t) => t.last = el.value.clone(),
            None if is_field(&p.element) => tracked.push(Tracked { element: p.element.clone(), hwnd: p.hwnd, last: el.value.clone() }),
            None => {}
        }
        ev.element = Some(el);
        self.send(ev);
    }

    fn describe(&self, el: &IUIAutomationElement, top: HWND, with_value: bool) -> Element {
        unsafe {
            let is_password = el.CurrentIsPassword().map(|b| b.as_bool()).unwrap_or(false);
            let rect = el.CurrentBoundingRectangle().map(|r| [r.left, r.top, r.right - r.left, r.bottom - r.top]).unwrap_or_default();
            let value = if with_value && !is_password {
                el.GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
                    .ok()
                    .and_then(|p| p.CurrentValue().ok())
                    .map(|v| v.to_string().chars().take(MAX_VALUE_CHARS).collect())
            } else {
                None
            };
            let control_type = el.CurrentControlType().map(|t| t.0).unwrap_or(0);
            let (path, mut url) = self.path(el, top);
            if control_type == DOCUMENT {
                url = url_of(el).or(url);
            }
            Element {
                role: role_name(control_type).to_string(),
                name: el.CurrentName().map(|s| s.to_string()).unwrap_or_default(),
                automation_id: el.CurrentAutomationId().map(|s| s.to_string()).unwrap_or_default(),
                class_name: el.CurrentClassName().map(|s| s.to_string()).unwrap_or_default(),
                path,
                rect,
                value,
                is_password,
                url,
            }
        }
    }

    /// Ancestors from the top-level window down to (not including) the element, by name.
    /// Unnamed containers are skipped, so the path reads like a breadcrumb.
    fn path(&self, el: &IUIAutomationElement, top: HWND) -> (Vec<String>, Option<String>) {
        let mut names = Vec::new();
        let mut url = None;
        unsafe {
            let root = self.automation.GetRootElement().ok();
            let mut cur = self.walker.GetParentElement(el).ok();
            let mut steps = 0;
            while let Some(node) = cur {
                if steps >= MAX_WALK {
                    break;
                }
                steps += 1;
                if let Some(r) = &root {
                    if self.automation.CompareElements(&node, r).map(|b| b.as_bool()).unwrap_or(false) {
                        break;
                    }
                }
                let name = node.CurrentName().map(|s| s.to_string()).unwrap_or_default();
                let name = name.trim();
                if !name.is_empty() && name.len() <= 80 && names.last().map(|l: &String| l != name).unwrap_or(true) {
                    names.push(name.to_string());
                }
                if url.is_none() && node.CurrentControlType().map(|t| t.0).unwrap_or(0) == DOCUMENT {
                    url = url_of(&node);
                }
                let native = node.CurrentNativeWindowHandle().map(|h| h.0 as isize).unwrap_or(0);
                if native != 0 && native == top.0 as isize {
                    break;
                }
                cur = self.walker.GetParentElement(&node).ok();
            }
        }
        names.reverse();
        if names.len() > MAX_PATH {
            // Keep the window name plus the closest ancestors.
            let tail = names.split_off(names.len() - (MAX_PATH - 1));
            names.truncate(1);
            names.extend(tail);
        }
        (names, url)
    }

    /// Emits an event. For browser windows without a URL yet, finds the page's document first.
    fn send(&self, mut ev: Event) {
        if ev.url.is_none() {
            ev.url = ev.element.as_ref().and_then(|e| e.url.clone());
        }
        if ev.url.is_none() && is_browser(&ev.process) && ev.hwnd != 0 {
            ev.url = self.document_url(HWND(ev.hwnd as *mut _));
        }
        emit(&ev);
    }

    /// The URL of the first web document inside a top-level browser window.
    fn document_url(&self, hwnd: HWND) -> Option<String> {
        unsafe {
            let root = self.automation.ElementFromHandle(hwnd).ok()?;
            let cond = self
                .automation
                .CreatePropertyCondition(UIA_ControlTypePropertyId, &VARIANT::from(DOCUMENT))
                .ok()?;
            let doc = root.FindFirst(TreeScope_Descendants, &cond).ok()?;
            url_of(&doc)
        }
    }
}

const DOCUMENT: i32 = 50030;

fn is_browser(process: &str) -> bool {
    let p = process.to_ascii_lowercase();
    p == "chrome.exe" || p == "msedge.exe"
}

/// Chromium exposes a web document's URL as its UI Automation value.
fn url_of(el: &IUIAutomationElement) -> Option<String> {
    unsafe {
        let v = el
            .GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
            .ok()?
            .CurrentValue()
            .ok()?
            .to_string();
        if v.contains("://") { Some(v) } else { None }
    }
}

fn window_info(hwnd: HWND) -> (String, String) {
    unsafe {
        let mut buf = [0u16; 512];
        let n = GetWindowTextW(hwnd, &mut buf);
        let title = String::from_utf16_lossy(&buf[..n.max(0) as usize]);
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        let mut process = String::new();
        if pid != 0 {
            if let Ok(h) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
                let mut path = [0u16; 1024];
                let mut size = path.len() as u32;
                if QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, PWSTR(path.as_mut_ptr()), &mut size).is_ok() {
                    let full = String::from_utf16_lossy(&path[..size as usize]);
                    process = full.rsplit('\\').next().unwrap_or("").to_string();
                }
                let _ = CloseHandle(h);
            }
        }
        (process, title)
    }
}

fn role_name(id: i32) -> &'static str {
    match id {
        50000 => "Button",
        50001 => "Calendar",
        50002 => "CheckBox",
        50003 => "ComboBox",
        50004 => "Edit",
        50005 => "Hyperlink",
        50006 => "Image",
        50007 => "ListItem",
        50008 => "List",
        50009 => "Menu",
        50010 => "MenuBar",
        50011 => "MenuItem",
        50012 => "ProgressBar",
        50013 => "RadioButton",
        50014 => "ScrollBar",
        50015 => "Slider",
        50016 => "Spinner",
        50017 => "StatusBar",
        50018 => "Tab",
        50019 => "TabItem",
        50020 => "Text",
        50021 => "ToolBar",
        50022 => "ToolTip",
        50023 => "Tree",
        50024 => "TreeItem",
        50025 => "Custom",
        50026 => "Group",
        50027 => "Thumb",
        50028 => "DataGrid",
        50029 => "DataItem",
        50030 => "Document",
        50031 => "SplitButton",
        50032 => "Window",
        50033 => "Pane",
        50034 => "Header",
        50035 => "HeaderItem",
        50036 => "Table",
        50037 => "TitleBar",
        50038 => "Separator",
        _ => "Element",
    }
}
