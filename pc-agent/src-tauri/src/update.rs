//! Updates itself from the QueSys releases (GitHub), signed with the QueSys update key.
//!
//! - Checks 3 minutes after starting, then every 6 hours, and when the floor sends "Update".
//! - Installs only while nobody is playing: no session on this PC and no staff unlock. An update
//!   found during play is installed as soon as the PC is free (checked every minute).
//! - The installer runs in passive mode: it closes the app, replaces it and starts it again, so the
//!   lock screen is back within seconds. Updates not signed with the QueSys key are refused.
//! - Builds without the update key (local builds) never check.

use std::sync::Arc;
use std::time::Duration;

use tauri::AppHandle;
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::sync::Notify;

use crate::Shared;

const FIRST_CHECK: Duration = Duration::from_secs(3 * 60);
const CHECK_EVERY: Duration = Duration::from_secs(6 * 60 * 60);
/// While an update waits for the player to finish.
const WAIT_STEP: Duration = Duration::from_secs(60);

/// Has this build been given the public key that release updates are signed with?
pub fn enabled(app: &AppHandle) -> bool {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|u| u.get("pubkey"))
        .and_then(|k| k.as_str())
        .is_some_and(|k| !k.trim().is_empty())
}

/// Background loop. `now` wakes it early (the floor's "Update" command).
pub async fn run(app: AppHandle, shared: Arc<Shared>, now: Arc<Notify>) {
    if !enabled(&app) {
        return;
    }
    let mut wait = FIRST_CHECK;
    loop {
        tokio::select! {
            _ = tokio::time::sleep(wait) => {}
            _ = now.notified() => {}
        }
        wait = match find(&app).await {
            Ok(Some(update)) if shared.is_free() => match install(&shared, update).await {
                Ok(()) => CHECK_EVERY, // not reached on Windows: the installer closes the app
                Err(_) => WAIT_STEP,
            },
            Ok(Some(_)) => WAIT_STEP,
            _ => CHECK_EVERY,
        };
    }
}

/// Is there a newer signed release?
pub async fn find(app: &AppHandle) -> Result<Option<Update>, String> {
    if !enabled(app) {
        return Err("this build has no update key".into());
    }
    let updater = app.updater().map_err(|e| e.to_string())?;
    updater.check().await.map_err(|e| e.to_string())
}

/// Download, then install if the PC is still free. On Windows the installer closes this app.
pub async fn install(shared: &Shared, update: Update) -> Result<(), String> {
    let bytes = update.download(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
    // Someone may have started playing during the download.
    if !shared.is_free() {
        return Err("a session started, so it installs after".into());
    }
    update.install(bytes).map_err(|e| e.to_string())
}
