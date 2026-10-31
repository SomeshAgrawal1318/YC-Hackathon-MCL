//! trace-helper: the Trace event sampler for Windows.
//!
//! Hooks the mouse, keyboard shortcuts, window focus and the clipboard across the OS,
//! asks UI Automation which element each event touched, and writes one JSON object per line
//! to stdout. Raw keystrokes are never logged: typing produces a key-free ping, and the field's
//! value is read through UI Automation once typing pauses. Password fields are skipped.
//!
//! stdin commands: `start`, `stop`, `quit`.  `--print` starts at once and pretty-prints.

mod hooks;
mod uia;

use serde::Serialize;
use std::io::{BufRead, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

/// True while Trace is recording. Hook callbacks drop everything when false.
pub static RECORDING: AtomicBool = AtomicBool::new(false);
static PRETTY: AtomicBool = AtomicBool::new(false);
static OUT: OnceLock<Mutex<std::io::Stdout>> = OnceLock::new();

/// What the hook thread hands to the UI Automation worker.
pub enum Signal {
    Click { ts: u64, x: i32, y: i32, double: bool, button: &'static str },
    Typed { ts: u64 },
    Shortcut { ts: u64, keys: &'static str },
    Clipboard { ts: u64, text: String },
    Foreground { ts: u64, hwnd: isize },
}

pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

pub fn emit<T: Serialize>(value: &T) {
    let line = if PRETTY.load(Ordering::Relaxed) {
        serde_json::to_string_pretty(value)
    } else {
        serde_json::to_string(value)
    };
    let Ok(line) = line else { return };
    let out = OUT.get_or_init(|| Mutex::new(std::io::stdout()));
    if let Ok(mut o) = out.lock() {
        let _ = writeln!(o, "{line}");
        let _ = o.flush();
    }
}

#[derive(Serialize)]
struct Hello<'a> {
    #[serde(rename = "type")]
    kind: &'a str,
    version: &'a str,
    pid: u32,
    recording: bool,
}

#[derive(Serialize)]
pub struct ErrorLine {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub message: String,
}

pub fn emit_error(message: impl Into<String>) {
    emit(&ErrorLine { kind: "error", message: message.into() });
}

fn main() {
    let print = std::env::args().any(|a| a == "--print");
    if print {
        PRETTY.store(true, Ordering::Relaxed);
        RECORDING.store(true, Ordering::Relaxed);
    }

    let (tx, rx) = mpsc::channel::<Signal>();
    std::thread::Builder::new()
        .name("uia".into())
        .spawn(move || uia::run(rx))
        .expect("spawn uia worker");

    std::thread::Builder::new()
        .name("stdin".into())
        .spawn(|| {
            let stdin = std::io::stdin();
            for line in stdin.lock().lines() {
                let Ok(line) = line else { break };
                match line.trim() {
                    "start" => RECORDING.store(true, Ordering::Relaxed),
                    "stop" => RECORDING.store(false, Ordering::Relaxed),
                    "quit" => std::process::exit(0),
                    _ => {}
                }
            }
            // Parent closed our stdin (Electron quit): leave, unless we're in --print mode.
            if !PRETTY.load(Ordering::Relaxed) {
                std::process::exit(0);
            }
        })
        .expect("spawn stdin reader");

    emit(&Hello {
        kind: "hello",
        version: env!("CARGO_PKG_VERSION"),
        pid: std::process::id(),
        recording: RECORDING.load(Ordering::Relaxed),
    });
    if print {
        eprintln!("trace-helper: recording. Click, copy, paste and type anywhere; Ctrl+C in this console to quit.");
    }

    // Runs the Windows message loop on this thread until the process exits.
    if let Err(e) = hooks::run(tx) {
        emit_error(format!("hooks failed: {e}"));
        std::process::exit(1);
    }
}
