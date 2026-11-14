//! This PC's details, power commands, Wake-on-LAN and the blocked-apps sweep.

use serde_json::{json, Value};
use std::collections::HashSet;
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

static STARTED: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();

/// Call once when the app starts: check-ins report how long the app has been running.
pub fn mark_start() {
    STARTED.get_or_init(std::time::Instant::now);
}

/// Sent with every check-in: lets the dashboard show the PC's name, and lets another PC wake it.
/// The two uptimes let the server tell, after a gap in check-ins, whether the PC was switched off
/// (Windows restarted) or only this app was closed (Windows kept running): a tamper alert.
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
        "uptime_s": sysinfo::System::uptime(),
        "app_uptime_s": STARTED.get_or_init(std::time::Instant::now).elapsed().as_secs(),
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

/// Launcher links the games menu may open (Steam, Epic, Ubisoft, EA, Battle.net, Riot, Roblox…).
const LINK_SCHEMES: &[&str] = &[
    "steam", "com.epicgames.launcher", "uplay", "ubisoft", "origin", "origin2", "link2ea", "battlenet",
    "riotclient", "roblox", "roblox-player", "minecraft",
];

#[derive(Debug, PartialEq)]
pub enum Target {
    /// A program: started directly, in its own folder.
    Program(String),
    /// A shortcut (.lnk / .url) or a launcher link: opened the way Windows opens it.
    Open(String),
}

/// What a games-menu entry points at, if it is something this app will start. The list comes from
/// the owner's settings, but is still checked here: a program on a drive, a shortcut, or a known
/// launcher link. Nothing else (no web pages, no scripts, no command lines).
pub fn check_target(target: &str) -> Option<Target> {
    let t = target.trim();
    if t.is_empty() || t.len() > 300 || t.chars().any(|c| c.is_control() || c == '"') {
        return None;
    }
    if let Some((scheme, rest)) = t.split_once("://") {
        let scheme = scheme.to_ascii_lowercase();
        return (LINK_SCHEMES.contains(&scheme.as_str()) && !rest.is_empty()).then(|| Target::Open(t.to_string()));
    }
    let bytes = t.as_bytes();
    let on_drive = bytes.len() > 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'\\';
    if !on_drive || t.contains("..") {
        return None;
    }
    let lower = t.to_ascii_lowercase();
    if lower.ends_with(".exe") {
        Some(Target::Program(t.to_string()))
    } else if lower.ends_with(".lnk") || lower.ends_with(".url") {
        Some(Target::Open(t.to_string()))
    } else {
        None
    }
}

/// Start a game from the menu.
pub fn launch(target: &str) -> Result<(), String> {
    match check_target(target).ok_or("This game's link isn't valid. Ask at the counter.")? {
        Target::Program(path) => {
            let mut cmd = Command::new(&path);
            if let Some(dir) = std::path::Path::new(&path).parent() {
                cmd.current_dir(dir);
            }
            cmd.spawn().map(|_| ()).map_err(|_| "Couldn't start this game. Ask at the counter.".to_string())
        }
        Target::Open(link) => Command::new("explorer.exe")
            .arg(&link)
            .spawn()
            .map(|_| ())
            .map_err(|_| "Couldn't start this game. Ask at the counter.".to_string()),
    }
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
    fn game_targets() {
        assert_eq!(check_target("steam://rungameid/730"), Some(Target::Open("steam://rungameid/730".into())));
        assert_eq!(
            check_target(r"C:\Riot Games\Riot Client\RiotClientServices.exe"),
            Some(Target::Program(r"C:\Riot Games\Riot Client\RiotClientServices.exe".into()))
        );
        assert_eq!(check_target(r"D:\Games\GTA V.lnk"), Some(Target::Open(r"D:\Games\GTA V.lnk".into())));
        for bad in [
            "https://example.com",
            "file:///C:/Windows/System32/cmd.exe",
            r"C:\Windows\System32\cmd.exe /c del",
            r"C:\Games\run.bat",
            r"\\server\share\game.exe",
            r"C:\Games\..\Windows\x.exe",
            "notepad.exe",
            "steam://",
            "",
        ] {
            assert_eq!(check_target(bad), None, "{bad}");
        }
    }

    #[test]
    fn never_targets_protected_processes() {
        let mut s = Sweeper::new();
        assert!(s.sweep(&["explorer.exe".into(), "svchost.exe".into()]).is_empty());
    }
}
