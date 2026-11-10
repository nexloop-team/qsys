//! What the app remembers between restarts.
//!
//! `config.json` (in the app's data folder) holds the server address, the publishable key and the
//! staff PIN hash. The device key itself is kept in Windows Credential Manager, never in a file.
//!
//! The player's Windows account can write that folder, so nothing in it is trusted on its own:
//! release builds always use the server address baked in at build time, the staff PIN is checked
//! on the server whenever the PC is online (this copy is only the offline fallback), and the copy
//! is a slow PBKDF2 hash so it can't be brute-forced in seconds.

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
        // A release build with a baked-in server ignores the file: otherwise a player could point
        // the app at their own server (which would always say "unlocked") and collect the device key.
        if server_is_fixed() {
            c.server_url = DEFAULT_SERVER_URL.to_string();
            c.publishable_key = DEFAULT_PUBLISHABLE_KEY.to_string();
        }
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
            (Some(salt), Some(hash)) => match hash.strip_prefix(PBKDF2_PREFIX) {
                Some(rest) => constant_eq(&pbkdf2_hex(salt, pin, PBKDF2_ROUNDS), rest),
                // Saved by an earlier version (one SHA-256 round). Still accepted.
                None => constant_eq(&legacy_hash(salt, pin), hash),
            },
            _ => false,
        }
    }
}

/// Release builds that were given a server address at build time always use it.
pub fn server_is_fixed() -> bool {
    !cfg!(debug_assertions) && !DEFAULT_SERVER_URL.is_empty()
}

/// Only HTTPS, so the device key and player PINs never cross the café network in the clear.
/// Plain http is allowed only for a local development server in debug builds.
pub fn check_server_url(url: &str) -> Result<(), String> {
    let url = url.trim().to_ascii_lowercase();
    if url.starts_with("https://") && url.len() > "https://".len() {
        return Ok(());
    }
    let local = url.starts_with("http://localhost") || url.starts_with("http://127.0.0.1");
    if cfg!(debug_assertions) && local {
        return Ok(());
    }
    Err("The QueSys server address must start with https://".into())
}

const PBKDF2_PREFIX: &str = "pbkdf2-sha256$";
// About a tenth of a second per try on a gaming PC: unnoticeable at the lock screen, slow for guessing.
const PBKDF2_ROUNDS: u32 = 200_000;

fn hash_pin(salt: &str, pin: &str) -> String {
    format!("{PBKDF2_PREFIX}{}", pbkdf2_hex(salt, pin, PBKDF2_ROUNDS))
}

fn pbkdf2_hex(salt: &str, pin: &str, rounds: u32) -> String {
    let mut out = [0u8; 32];
    pbkdf2::pbkdf2_hmac::<Sha256>(pin.as_bytes(), salt.as_bytes(), rounds, &mut out);
    hex::encode(out)
}

fn legacy_hash(salt: &str, pin: &str) -> String {
    let mut h = Sha256::new();
    h.update(salt.as_bytes());
    h.update(b":");
    h.update(pin.as_bytes());
    hex::encode(h.finalize())
}

fn constant_eq(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Staff PINs: 6 to 8 digits (a 4-digit PIN falls quickly to guessing if this file is copied).
pub fn valid_pin(pin: &str) -> bool {
    (6..=8).contains(&pin.len()) && pin.chars().all(|c| c.is_ascii_digit())
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
        c.set_pin("482193");
        assert!(c.pin_hash.as_deref().unwrap().starts_with(PBKDF2_PREFIX));
        assert!(c.check_pin("482193"));
        assert!(!c.check_pin("482194"));
        assert!(!Config::default().check_pin("482193"));
    }

    #[test]
    fn pin_rules() {
        assert!(valid_pin("123456"));
        assert!(valid_pin("12345678"));
        assert!(!valid_pin("1234"));
        assert!(!valid_pin("123456789"));
        assert!(!valid_pin("12a456"));
    }

    #[test]
    fn legacy_pin_still_works() {
        let salt = "abc".to_string();
        let c = Config { pin_salt: Some(salt.clone()), pin_hash: Some(legacy_hash(&salt, "4821")), ..Default::default() };
        assert!(c.check_pin("4821"));
        assert!(!c.check_pin("4822"));
    }

    #[test]
    fn server_must_be_https() {
        assert!(check_server_url("https://abc.supabase.co").is_ok());
        assert!(check_server_url("http://abc.supabase.co").is_err());
        assert!(check_server_url("ftp://abc").is_err());
        assert!(check_server_url("https://").is_err());
    }
}
