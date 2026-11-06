//! What the app remembers between restarts.
//!
//! `config.json` (in the app's data folder) holds the server address, the publishable key and the
//! staff PIN hash. The device key itself is kept in Windows Credential Manager, never in a file.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

const KEYRING_SERVICE: &str = "QueSys PC";
const KEYRING_USER: &str = "device-key";

/// Baked in at build time for the hosted QueSys service; the setup screen can override them.
pub const DEFAULT_SERVER_URL: &str = match option_env!("QUESYS_SUPABASE_URL") {
    Some(v) => v,
    None => "",
};
pub const DEFAULT_PUBLISHABLE_KEY: &str = match option_env!("QUESYS_SUPABASE_KEY") {
    Some(v) => v,
    None => "",
};

#[derive(Serialize, Deserialize, Clone, Default, Debug)]
pub struct Config {
    pub server_url: String,
    /// The project's *publishable* key (sb_publishable_…). Never the secret key.
    pub publishable_key: String,
    /// Realtime topic for instant updates, from the server.
    pub channel: Option<String>,
    pub station: Option<String>,
    pub pin_salt: Option<String>,
    pub pin_hash: Option<String>,
}

impl Config {
    pub fn path(dir: &Path) -> PathBuf {
        dir.join("config.json")
    }

    pub fn load(dir: &Path) -> Config {
        let mut c: Config = std::fs::read_to_string(Self::path(dir))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        if c.server_url.is_empty() {
            c.server_url = DEFAULT_SERVER_URL.to_string();
        }
        if c.publishable_key.is_empty() {
            c.publishable_key = DEFAULT_PUBLISHABLE_KEY.to_string();
        }
        c
    }

    pub fn save(&self, dir: &Path) -> std::io::Result<()> {
        std::fs::create_dir_all(dir)?;
        let tmp = dir.join("config.json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(self).unwrap_or_default())?;
        std::fs::rename(tmp, Self::path(dir))
    }

    pub fn set_pin(&mut self, pin: &str) {
        let salt = hex::encode(rand::random::<[u8; 16]>());
        self.pin_hash = Some(hash_pin(&salt, pin));
        self.pin_salt = Some(salt);
    }

    pub fn check_pin(&self, pin: &str) -> bool {
        match (&self.pin_salt, &self.pin_hash) {
            (Some(salt), Some(hash)) => constant_eq(&hash_pin(salt, pin), hash),
            _ => false,
        }
    }
}

fn hash_pin(salt: &str, pin: &str) -> String {
    let mut h = Sha256::new();
    h.update(salt.as_bytes());
    h.update(b":");
    h.update(pin.as_bytes());
    hex::encode(h.finalize())
}

fn constant_eq(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

pub fn valid_pin(pin: &str) -> bool {
    (4..=8).contains(&pin.len()) && pin.chars().all(|c| c.is_ascii_digit())
}

// --- Device key in Windows Credential Manager -------------------------------------------------

fn entry() -> Option<keyring::Entry> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).ok()
}

pub fn load_token() -> Option<String> {
    entry()?.get_password().ok().filter(|t| !t.is_empty())
}

pub fn save_token(token: &str) -> Result<(), String> {
    entry()
        .ok_or("Couldn't open Windows Credential Manager.")?
        .set_password(token)
        .map_err(|e| format!("Couldn't save the device key: {e}"))
}

pub fn delete_token() {
    if let Some(e) = entry() {
        let _ = e.delete_credential();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pin_round_trip() {
        let mut c = Config::default();
        c.set_pin("4821");
        assert!(c.check_pin("4821"));
        assert!(!c.check_pin("4822"));
        assert!(!Config::default().check_pin("4821"));
    }

    #[test]
    fn pin_rules() {
        assert!(valid_pin("1234"));
        assert!(valid_pin("12345678"));
        assert!(!valid_pin("123"));
        assert!(!valid_pin("12a4"));
    }
}
