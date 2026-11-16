//! `quesys-pc.exe --watchdog` (what Windows starts at sign-in) keeps the app running: if the app
//! is closed or crashes, it is started again within seconds.

use std::process::Command;
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

pub fn run() {
    let Ok(exe) = std::env::current_exe() else { return };
    let mut quick_exits = 0u32;
    loop {
        let started = Instant::now();
        let mut cmd = Command::new(&exe);
        cmd.arg("--app");
        #[cfg(windows)]
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        let _ = cmd.status();

        // Exiting straight away usually means another copy is already running: back off.
        if started.elapsed() < Duration::from_secs(5) {
            quick_exits += 1;
        } else {
            quick_exits = 0;
        }
        let wait = if quick_exits >= 3 { 30 } else { 2 };
        std::thread::sleep(Duration::from_secs(wait));
    }
}

/// Starts `quesys-pc.exe --watchdog` in the background. Used when the app was started without the
/// watchdog (the updater restarts the app directly). A second watchdog is harmless: the app it
/// starts finds the first copy running and exits, and the watchdog backs off.
#[cfg_attr(debug_assertions, allow(dead_code))]
pub fn spawn() {
    let Ok(exe) = std::env::current_exe() else { return };
    let mut cmd = Command::new(exe);
    cmd.arg("--watchdog");
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000 | 0x0000_0008); // CREATE_NO_WINDOW | DETACHED_PROCESS
    let _ = cmd.spawn();
}
