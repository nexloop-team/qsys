//! Restrictions while a player has the PC (Settings › PC app): Task Manager, Control Panel and
//! Settings, the command line and registry editor, and USB drives.
//!
//! Each one sets the matching Windows policy where this app is allowed to (most live in the
//! player's own part of the registry; the USB one needs the app to run as administrator), and the
//! blocked-apps sweep closes the programs as a backstop. Staff unlock, maintenance and unpairing
//! lift them all, so staff get a normal PC.

use serde_json::{Map, Value};
use std::collections::BTreeSet;

pub const KINDS: [&str; 4] = ["task_manager", "control_panel", "command_line", "usb_drives"];

/// Programs closed for each restriction, on top of the policy.
pub fn programs(kind: &str) -> &'static [&'static str] {
    match kind {
        "task_manager" => &["taskmgr.exe", "procexp.exe", "procexp64.exe", "processhacker.exe", "systeminformer.exe"],
        "control_panel" => &["control.exe", "systemsettings.exe", "mmc.exe"],
        // Batch files keep working (some game launchers use them): only the windows are closed.
        "command_line" => &["cmd.exe", "powershell.exe", "pwsh.exe", "powershell_ise.exe", "windowsterminal.exe", "wt.exe", "regedit.exe"],
        _ => &[],
    }
}

/// Program names to close for these restrictions.
pub fn programs_for(kinds: &[String]) -> Vec<String> {
    kinds.iter().flat_map(|k| programs(k)).map(|p| p.to_string()).collect()
}

/// Applies the wanted set, touching the registry only when it changes.
#[derive(Default)]
pub struct Enforcer {
    applied: BTreeSet<String>,
    /// kind → "policy" (Windows enforces it), "apps" (closed by the sweep only) or "watch"
    /// (USB: plugging one in is reported, but not blocked).
    status: Map<String, Value>,
    initialised: bool,
}

impl Enforcer {
    pub fn set(&mut self, wanted: &[String]) {
        let wanted: BTreeSet<String> = wanted.iter().filter(|k| KINDS.contains(&k.as_str())).cloned().collect();
        if self.initialised && wanted == self.applied {
            return;
        }
        for kind in KINDS {
            let on = wanted.contains(kind);
            // Always clear on the first pass: a crash or power cut may have left a policy behind.
            if on || self.applied.contains(kind) || !self.initialised {
                let ok = policy(kind, on);
                if on {
                    let how = if ok { "policy" } else if kind == "usb_drives" { "watch" } else { "apps" };
                    self.status.insert(kind.to_string(), Value::String(how.into()));
                }
            }
            if !on {
                self.status.remove(kind);
            }
        }
        self.applied = wanted;
        self.initialised = true;
    }

    /// For the health readings: which restrictions are on, and how.
    pub fn status(&self) -> Value {
        Value::Object(self.status.clone())
    }

    /// Is USB blocking enforced by Windows (not just watched)?
    pub fn usb_blocked(&self) -> bool {
        self.status.get("usb_drives").and_then(Value::as_str) == Some("policy")
    }
}

#[cfg(windows)]
fn policy(kind: &str, on: bool) -> bool {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    const SYSTEM: &str = r"Software\Microsoft\Windows\CurrentVersion\Policies\System";
    const EXPLORER: &str = r"Software\Microsoft\Windows\CurrentVersion\Policies\Explorer";
    const CMD: &str = r"Software\Policies\Microsoft\Windows\System";
    // Removable disks (the device class of USB sticks and drives).
    const USB: &str = r"Software\Policies\Microsoft\Windows\RemovableStorageDevices\{53f5630d-b6bf-11d0-94f2-00a0c91efb8b}";

    fn write(root: &RegKey, path: &str, name: &str, value: u32, on: bool) -> bool {
        if on {
            root.create_subkey(path).and_then(|(k, _)| k.set_value(name, &value)).is_ok()
        } else {
            match root.open_subkey_with_flags(path, winreg::enums::KEY_SET_VALUE) {
                Ok(k) => match k.delete_value(name) {
                    Ok(()) => true,
                    Err(e) => e.kind() == std::io::ErrorKind::NotFound,
                },
                Err(e) => e.kind() == std::io::ErrorKind::NotFound,
            }
        }
    }

    let user = RegKey::predef(HKEY_CURRENT_USER);
    match kind {
        "task_manager" => write(&user, SYSTEM, "DisableTaskMgr", 1, on),
        "control_panel" => write(&user, EXPLORER, "NoControlPanel", 1, on),
        "command_line" => {
            let registry = write(&user, SYSTEM, "DisableRegistryTools", 1, on);
            // 2 = no command prompt window, but batch files still run. Often needs administrator.
            let _ = write(&user, CMD, "DisableCMD", 2, on);
            registry
        }
        "usb_drives" => {
            let machine = RegKey::predef(HKEY_LOCAL_MACHINE);
            let m = write(&machine, USB, "Deny_Read", 1, on) & write(&machine, USB, "Deny_Write", 1, on);
            let u = write(&user, USB, "Deny_Read", 1, on) & write(&user, USB, "Deny_Write", 1, on);
            m || u
        }
        _ => false,
    }
}

#[cfg(not(windows))]
fn policy(_kind: &str, _on: bool) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn programs_cover_each_restriction() {
        assert!(programs("task_manager").contains(&"taskmgr.exe"));
        assert!(programs("usb_drives").is_empty());
        let all = programs_for(&["task_manager".into(), "command_line".into()]);
        assert!(all.contains(&"regedit.exe".to_string()) && all.contains(&"taskmgr.exe".to_string()));
    }

    #[test]
    fn status_follows_the_wanted_set() {
        let mut e = Enforcer::default();
        e.set(&["task_manager".into(), "usb_drives".into(), "nonsense".into()]);
        // Not on Windows here: no policy, so the sweep closes them / USB is watched.
        assert_eq!(e.status()["task_manager"], "apps");
        assert_eq!(e.status()["usb_drives"], "watch");
        assert!(e.status().get("nonsense").is_none());
        e.set(&[]);
        assert_eq!(e.status(), Value::Object(Map::new()));
    }
}
