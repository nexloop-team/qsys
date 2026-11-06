//! This PC's details, power commands, Wake-on-LAN and the blocked-apps sweep.

use serde_json::{json, Value};
use std::collections::HashSet;
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Sent with every check-in: lets the dashboard show the PC's name, and lets another PC wake it.
pub fn info(locked: bool) -> Value {
    let hostname = hostname::get().ok().map(|h| h.to_string_lossy().into_owned());
    let mac = mac_address::get_mac_address().ok().flatten().map(|m| m.to_string());
    let ip = local_ip_address::local_ip().ok().map(|ip| ip.to_string());
    let os = sysinfo::System::long_os_version();
    json!({
        "hostname": hostname,
        "version": env!("CARGO_PKG_VERSION"),
        "os": os,
        "mac": mac,
        "ip": ip,
        "locked": locked,
    })
}

fn run_hidden(program: &str, args: &[&str]) -> std::io::Result<()> {
    let mut cmd = Command::new(program);
    cmd.args(args);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.spawn().map(|_| ())
}

pub fn restart() -> std::io::Result<()> {
    run_hidden("shutdown", &["/r", "/t", "5", "/c", "Restarted from the QueSys floor"])
}

pub fn shutdown() -> std::io::Result<()> {
    run_hidden("shutdown", &["/s", "/t", "5", "/c", "Shut down from the QueSys floor"])
}

/// Wake-on-LAN magic packet to the local network for `mac` ("AA:BB:CC:DD:EE:FF").
pub fn wake(mac: &str) -> Result<(), String> {
    let bytes: Vec<u8> = mac
        .split([':', '-'])
        .map(|p| u8::from_str_radix(p, 16))
        .collect::<Result<_, _>>()
        .map_err(|_| "bad network address".to_string())?;
    if bytes.len() != 6 {
        return Err("bad network address".into());
    }
    let mut packet = vec![0xFFu8; 6];
    for _ in 0..16 {
        packet.extend_from_slice(&bytes);
    }
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
    socket.set_broadcast(true).map_err(|e| e.to_string())?;
    for port in [9, 7] {
        socket.send_to(&packet, ("255.255.255.255", port)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Never closed, whatever the owner lists: Windows needs these, and so does this app.
const PROTECTED: &[&str] = &[
    "explorer.exe", "csrss.exe", "winlogon.exe", "wininit.exe", "services.exe", "lsass.exe", "smss.exe",
    "svchost.exe", "dwm.exe", "system", "quesys-pc.exe", "quesys pc.exe", "msedgewebview2.exe",
];

pub struct Sweeper {
    sys: sysinfo::System,
}

impl Sweeper {
    pub fn new() -> Sweeper {
        Sweeper { sys: sysinfo::System::new() }
    }

    /// Closes running programs on the list. Returns the names it closed.
    pub fn sweep(&mut self, blocked: &[String]) -> Vec<String> {
        let wanted: HashSet<String> = blocked
            .iter()
            .map(|b| b.trim().to_ascii_lowercase())
            .filter(|b| !b.is_empty() && !PROTECTED.contains(&b.as_str()))
            .collect();
        if wanted.is_empty() {
            return vec![];
        }
        self.sys.refresh_processes_specifics(
            sysinfo::ProcessesToUpdate::All,
            true,
            sysinfo::ProcessRefreshKind::new(),
        );
        let mut closed = vec![];
        for process in self.sys.processes().values() {
            let name = process.name().to_string_lossy().to_ascii_lowercase();
            if wanted.contains(&name) && process.kill() {
                closed.push(name);
            }
        }
        closed.sort();
        closed.dedup();
        closed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_bad_mac() {
        assert!(wake("not-a-mac").is_err());
        assert!(wake("AA:BB:CC").is_err());
    }

    #[test]
    fn never_targets_protected_processes() {
        let mut s = Sweeper::new();
        assert!(s.sweep(&["explorer.exe".into(), "svchost.exe".into()]).is_empty());
    }
}
