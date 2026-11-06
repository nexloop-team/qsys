// Reads pc-agent/.env (QUESYS_SUPABASE_URL, QUESYS_SUPABASE_KEY) and bakes them into the app, so
// venues only type the pairing code. Variables already set in the shell win over the file.
use std::{env, fs, path::Path};

const KEYS: [&str; 2] = ["QUESYS_SUPABASE_URL", "QUESYS_SUPABASE_KEY"];

fn main() {
    let file = Path::new(env!("CARGO_MANIFEST_DIR")).join("../.env");
    println!("cargo:rerun-if-changed={}", file.display());
    for key in KEYS {
        println!("cargo:rerun-if-env-changed={key}");
    }

    let from_file = fs::read_to_string(&file).unwrap_or_default();
    for key in KEYS {
        let value = env::var(key).ok().filter(|v| !v.trim().is_empty()).or_else(|| {
            from_file.lines().find_map(|line| {
                let (k, v) = line.trim().split_once('=')?;
                (k.trim() == key).then(|| v.trim().trim_matches('"').to_string())
            })
        });
        let Some(value) = value.filter(|v| !v.is_empty()) else { continue };
        if value.starts_with("sb_secret_") {
            panic!("{key} is a Supabase SECRET key. The PC app must only use the publishable key (sb_publishable_…).");
        }
        println!("cargo:rustc-env={key}={value}");
    }

    tauri_build::build()
}
