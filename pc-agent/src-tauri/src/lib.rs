//! QueSys PC app.
//!
//! What it does on a gaming PC:
//! - Shows a full-screen lock (on every monitor) until staff start a session for this station on
//!   the QueSys floor; locks again when the session is paused or ends, or fixed time runs out.
//! - While unlocked, shows a small timer and closes the venue's blocked apps.
//! - A games menu for the player: the venue's games, their wallet balance, snack orders, more time
//!   and "Call staff".
//! - Restrictions while a player has the PC (Task Manager, Control Panel, command line, USB drives).
//! - Sends CPU, memory, GPU and disk readings with each check-in, for the floor.
//! - Runs staff commands: message, restart, shut down, and wake another PC on the same network.
//!
//! Time comes from the server (offset measured on each check-in), so changing the PC clock does
//! nothing. If the internet drops, the last known end time is still enforced.

mod api;
mod config;
mod decide;
mod health;
mod keyboard;
mod realtime;
mod restrict;
mod system;
pub mod watchdog;

use api::{Api, ApiError, SyncData};
use chrono::{DateTime, Duration as ChronoDuration, Utc};
use config::Config;
use decide::{decide, widget_visible, Reason, Screen};
use serde::Serialize;
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, State, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};
use tokio::sync::Notify;

const SYNC_EVERY: Duration = Duration::from_secs(15);
const STAFF_UNLOCK_MINUTES: i64 = 15;
const MESSAGE_SECONDS: u64 = 20;
const WIDGET: (f64, f64) = (236.0, 64.0);
const WIDGET_WITH_MESSAGE: (f64, f64) = (320.0, 132.0);

/// Everything the windows need to draw themselves. Sent as the "view" event when it changes.
#[derive(Serialize, Clone, PartialEq, Debug)]
pub struct View {
    screen: Screen,
    reason: Reason,
    venue: Option<String>,
    station: Option<String>,
    lock_message: Option<String>,
    customer: Option<String>,
    started_at: Option<DateTime<Utc>>,
    ends_at: Option<DateTime<Utc>>,
    /// server clock − PC clock, in ms; the windows add it to Date.now().
    offset_ms: i64,
    online: bool,
    message: Option<String>,
    server_url: String,
    has_key: bool,
    /// The lock screen shows the mobile + PIN login (free PC, online, turned on in Settings).
    player_login: bool,
    /// Show the small timer now? Hidden during play except at 5 min and in the last minute.
    widget: bool,
    /// Debug build (`cargo tauri dev`): the lock screen shows a Quit button so testing on your own PC is safe.
    dev: bool,
    // The games menu (filled only while a player's session runs).
    games: Vec<api::Game>,
    /// The session has a player, so a voucher can go into their wallet.
    vouchers: bool,
    wallet: Option<f64>,
    orders: bool,
    menu: Vec<api::MenuItem>,
    requests: Vec<api::Request>,
    /// open | prepaid | frames
    mode: Option<String>,
}

pub struct Shared {
    data_dir: PathBuf,
    config: Mutex<Config>,
    token: Mutex<Option<String>>,
    sync: Mutex<Option<SyncData>>,
    offset_ms: AtomicI64,
    online: Mutex<bool>,
    staff_until: Mutex<Option<DateTime<Utc>>>,
    message: Mutex<Option<(String, Instant)>>,
    handled: Mutex<HashSet<String>>,
    reported: Mutex<HashMap<String, Instant>>,
    /// Local staff PIN tries: (wrong in a row, lockouts so far, locked until).
    pin_failures: Mutex<(u32, u32, Option<Instant>)>,
    last_view: Mutex<Option<View>>,
    poke: Arc<Notify>,
    /// Latest performance readings, sent with the next check-in.
    health: Mutex<serde_json::Value>,
    restrictions: Mutex<restrict::Enforcer>,
}

impl Shared {
    fn api(&self) -> Api {
        let c = self.config.lock().unwrap();
        Api::new(&c.server_url, &c.publishable_key)
    }

    fn token(&self) -> Option<String> {
        self.token.lock().unwrap().clone()
    }

    fn server_now(&self) -> DateTime<Utc> {
        Utc::now() + ChronoDuration::milliseconds(self.offset_ms.load(Ordering::Relaxed))
    }

    fn view(&self) -> View {
        let paired = self.token.lock().unwrap().is_some();
        let sync = self.sync.lock().unwrap();
        let staff_until = *self.staff_until.lock().unwrap();
        let d = decide(paired, sync.as_ref(), self.server_now(), staff_until);
        let config = self.config.lock().unwrap();
        let message = self
            .message
            .lock()
            .unwrap()
            .as_ref()
            .filter(|(_, at)| at.elapsed() < Duration::from_secs(MESSAGE_SECONDS))
            .map(|(m, _)| m.clone());
        let widget = widget_visible(&d, self.server_now(), message.is_some());
        let online = *self.online.lock().unwrap();
        let playing = d.reason == Reason::Session;
        let live = sync.as_ref().filter(|_| playing);
        View {
            screen: d.screen,
            reason: d.reason,
            venue: sync.as_ref().and_then(|s| s.venue.clone()),
            station: sync.as_ref().map(|s| s.station.name.clone()).or_else(|| config.station.clone()),
            lock_message: sync.as_ref().and_then(|s| s.lock_message.clone()),
            customer: sync.as_ref().and_then(|s| s.session.as_ref()).and_then(|s| s.customer_name.clone()),
            started_at: d.started_at,
            ends_at: d.ends_at,
            // Rounded so tiny clock corrections don't count as a change.
            offset_ms: (self.offset_ms.load(Ordering::Relaxed) / 500) * 500,
            online,
            message,
            server_url: config.server_url.clone(),
            has_key: !config.publishable_key.is_empty(),
            player_login: d.reason == Reason::Free && online && sync.as_ref().is_some_and(|s| s.player_login),
            widget,
            dev: cfg!(debug_assertions),
            games: live.map(|s| s.games.clone()).unwrap_or_default(),
            vouchers: live.is_some_and(|s| s.vouchers),
            wallet: live.and_then(|s| s.wallet),
            orders: live.is_some_and(|s| s.orders),
            menu: live.map(|s| s.menu.clone()).unwrap_or_default(),
            requests: live.map(|s| s.requests.clone()).unwrap_or_default(),
            mode: live.and_then(|s| s.session.as_ref()).map(|s| s.mode.clone()),
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("lock") {
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--watchdog"]),
        ))
        .setup(|app| {
            system::mark_start();
            let data_dir = app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from("."));
            let shared = Arc::new(Shared {
                config: Mutex::new(Config::load(&data_dir)),
                data_dir,
                token: Mutex::new(config::load_token()),
                sync: Mutex::new(None),
                offset_ms: AtomicI64::new(0),
                online: Mutex::new(false),
                staff_until: Mutex::new(None),
                message: Mutex::new(None),
                handled: Mutex::new(HashSet::new()),
                reported: Mutex::new(HashMap::new()),
                pin_failures: Mutex::new((0, 0, None)),
                last_view: Mutex::new(None),
                poke: Arc::new(Notify::new()),
                health: Mutex::new(serde_json::Value::Null),
                restrictions: Mutex::new(restrict::Enforcer::default()),
            });
            app.manage(shared.clone());

            #[cfg(not(debug_assertions))]
            {
                use tauri_plugin_autostart::ManagerExt;
                let _ = app.autolaunch().enable();
            }

            keyboard::start();
            create_covers(app.handle());
            place_widget(app.handle());

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(sync_loop(handle.clone(), shared.clone()));
            tauri::async_runtime::spawn(tick_loop(handle.clone(), shared.clone()));
            tauri::async_runtime::spawn(sweep_loop(handle.clone(), shared.clone()));
            tauri::async_runtime::spawn(health_loop(shared.clone()));
            let rt = shared.clone();
            tauri::async_runtime::spawn(realtime::run(
                move || {
                    rt.token()?;
                    let channel = rt.config.lock().unwrap().channel.clone()?;
                    Some((rt.api().realtime_url(), channel))
                },
                shared.poke.clone(),
            ));
            Ok(())
        })
        .on_window_event(|window, event| {
            // Players can't close the lock or the timer. Closing the games menu only hides it.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if window.label() == "menu" {
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_view,
            pair,
            skip_setup,
            staff_unlock,
            staff_lock,
            player_login,
            unpair,
            dev_quit,
            open_menu,
            launch_game,
            send_request,
            redeem_voucher
        ])
        .run(tauri::generate_context!())
        .expect("QueSys PC failed to start");
}

// --- Windows -----------------------------------------------------------------------------------

/// A plain cover window on every extra monitor, so a second screen can't be used while locked.
fn create_covers(app: &AppHandle) {
    let Some(lock) = app.get_webview_window("lock") else { return };
    let primary = lock.primary_monitor().ok().flatten();
    let Ok(monitors) = lock.available_monitors() else { return };
    for (i, m) in monitors.iter().enumerate() {
        if primary.as_ref().is_some_and(|p| p.position() == m.position()) {
            continue;
        }
        let scale = m.scale_factor();
        let pos = m.position();
        let size = m.size();
        let built = WebviewWindowBuilder::new(app, format!("cover-{i}"), WebviewUrl::App("index.html".into()))
            .title("QueSys")
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .closable(false)
            .position(pos.x as f64 / scale, pos.y as f64 / scale)
            .inner_size(size.width as f64 / scale, size.height as f64 / scale)
            .visible(false)
            .build();
        if let Ok(w) = built {
            let _ = w.set_fullscreen(true);
        }
    }
}

fn place_widget(app: &AppHandle) {
    let Some(w) = app.get_webview_window("widget") else { return };
    let Some(m) = w.primary_monitor().ok().flatten() else { return };
    let scale = m.scale_factor();
    let margin = 16.0 * scale;
    let (width, _) = WIDGET_WITH_MESSAGE;
    let x = m.position().x as f64 + m.size().width as f64 - width * scale - margin;
    let y = m.position().y as f64 + margin;
    let _ = w.set_position(PhysicalPosition::new(x as i32, y as i32));
}

fn lock_windows(app: &AppHandle) -> Vec<WebviewWindow> {
    app.webview_windows()
        .into_iter()
        .filter(|(label, _)| label == "lock" || label.starts_with("cover-"))
        .map(|(_, w)| w)
        .collect()
}

/// Shows or hides windows to match the view. Called every second; cheap when nothing changed.
fn apply(app: &AppHandle, shared: &Shared) {
    let view = shared.view();
    let locked = view.screen != Screen::Unlocked;
    let (changed, started) = {
        let mut last = shared.last_view.lock().unwrap();
        let was_unlocked = last.as_ref().is_some_and(|v| v.screen == Screen::Unlocked);
        let started = view.reason == Reason::Session && !last.as_ref().is_some_and(|v| v.reason == Reason::Session);
        let changed = last.as_ref() != Some(&view);
        if changed && locked && was_unlocked {
            // Time's up mid-game: get the game out of the way first.
            keyboard::minimize_foreground();
        }
        *last = Some(view.clone());
        (changed, started)
    };

    keyboard::set_blocking(locked);
    // Restrictions apply while the PC is the player's (locked or playing); staff get a normal PC.
    {
        let staff = matches!(view.reason, Reason::Staff | Reason::Maintenance | Reason::NotPaired);
        let wanted = if staff {
            vec![]
        } else {
            shared.sync.lock().unwrap().as_ref().map(|s| s.restrictions.clone()).unwrap_or_default()
        };
        shared.restrictions.lock().unwrap().set(&wanted);
    }
    if let Some(w) = app.get_webview_window("menu") {
        if view.reason != Reason::Session {
            if w.is_visible().unwrap_or(false) {
                let _ = w.hide();
            }
        } else if started && (!view.games.is_empty() || view.orders) {
            // A new session: offer the games menu once. After that it lives in the taskbar.
            let _ = w.unminimize();
            let _ = w.show();
            let _ = w.set_focus();
        }
    }
    for w in lock_windows(app) {
        if locked {
            if !w.is_visible().unwrap_or(false) {
                let _ = w.show();
            }
            let _ = w.set_always_on_top(true);
        } else if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        }
    }
    if locked {
        if let Some(w) = app.get_webview_window("lock") {
            if !w.is_focused().unwrap_or(false) {
                let _ = w.set_focus();
            }
        }
    }
    if let Some(w) = app.get_webview_window("widget") {
        if !view.widget {
            if w.is_visible().unwrap_or(false) {
                let _ = w.hide();
            }
        } else {
            if changed {
                let (width, height) = if view.message.is_some() { WIDGET_WITH_MESSAGE } else { WIDGET };
                let _ = w.set_size(LogicalSize::new(width, height));
            }
            if !w.is_visible().unwrap_or(false) {
                // Never take focus from the game: that would minimise a full-screen game.
                // (hwnd() exists only on Windows; elsewhere, e.g. a Linux test build, just show it.)
                #[cfg(windows)]
                match w.hwnd() {
                    Ok(h) => keyboard::show_without_focus(h.0 as isize),
                    Err(_) => {
                        let _ = w.show();
                    }
                }
                #[cfg(not(windows))]
                {
                    let _ = w.show();
                }
            }
        }
    }
    if changed {
        let _ = app.emit("view", &view);
    }
}

// --- Loops -------------------------------------------------------------------------------------

async fn sync_loop(app: AppHandle, shared: Arc<Shared>) {
    loop {
        sync_once(&app, &shared).await;
        tokio::select! {
            _ = tokio::time::sleep(SYNC_EVERY) => {}
            _ = shared.poke.notified() => {}
        }
    }
}

async fn sync_once(app: &AppHandle, shared: &Arc<Shared>) {
    let Some(token) = shared.token() else {
        *shared.online.lock().unwrap() = false;
        apply(app, shared);
        return;
    };
    let locked = shared.last_view.lock().unwrap().as_ref().map_or(true, |v| v.screen != Screen::Unlocked);
    let mut info = system::info(locked);
    let health = shared.health.lock().unwrap().clone();
    if !health.is_null() {
        info["health"] = health;
    }
    let api = shared.api();
    let sent = Instant::now();
    match api.sync(&token, &info).await {
        Ok(data) => {
            // Server clock at the midpoint of the request.
            let rtt = sent.elapsed();
            let local_mid = Utc::now() - ChronoDuration::milliseconds((rtt.as_millis() / 2) as i64);
            shared
                .offset_ms
                .store((data.server_now - local_mid).num_milliseconds(), Ordering::Relaxed);
            *shared.online.lock().unwrap() = true;
            {
                let mut c = shared.config.lock().unwrap();
                if c.channel.as_deref() != Some(&data.channel) || c.station.as_deref() != Some(&data.station.name) {
                    c.channel = Some(data.channel.clone());
                    c.station = Some(data.station.name.clone());
                    let _ = c.save(&shared.data_dir);
                }
            }
            let commands = data.commands.clone();
            *shared.sync.lock().unwrap() = Some(data);
            apply(app, shared);
            for c in commands {
                run_command(app, shared, &api, &token, c).await;
            }
        }
        Err(ApiError::Unpaired) => {
            config::delete_token();
            *shared.token.lock().unwrap() = None;
            *shared.sync.lock().unwrap() = None;
            *shared.online.lock().unwrap() = true;
            apply(app, shared);
        }
        Err(_) => {
            // Offline: keep enforcing the last known session (and its end time).
            *shared.online.lock().unwrap() = false;
            apply(app, shared);
        }
    }
}

async fn run_command(app: &AppHandle, shared: &Arc<Shared>, api: &Api, token: &str, c: api::Command) {
    if !shared.handled.lock().unwrap().insert(c.id.clone()) {
        return;
    }
    let result = match c.kind.as_str() {
        "message" => {
            let text = c.payload["text"].as_str().unwrap_or("").chars().take(140).collect::<String>();
            *shared.message.lock().unwrap() = Some((text, Instant::now()));
            apply(app, shared);
            "shown".to_string()
        }
        // Acknowledge first: a restart must not run again after the PC comes back.
        "restart" | "shutdown" => {
            let _ = api.ack(token, &c.id, "starting").await;
            let r = if c.kind == "restart" { system::restart() } else { system::shutdown() };
            if let Err(e) = r {
                let _ = api.ack(token, &c.id, &format!("failed: {e}")).await;
            }
            return;
        }
        "wake" => match c.payload["mac"].as_str().map(system::wake) {
            Some(Ok(())) => "sent".to_string(),
            Some(Err(e)) => format!("failed: {e}"),
            None => "failed: no address".to_string(),
        },
        other => format!("unknown command {other}"),
    };
    let _ = api.ack(token, &c.id, &result).await;
}

async fn tick_loop(app: AppHandle, shared: Arc<Shared>) {
    let mut every = tokio::time::interval(Duration::from_secs(1));
    loop {
        every.tick().await;
        apply(&app, &shared);
    }
}

/// Every 5 seconds, close blocked apps (the owner's list, plus the programs behind each
/// restriction) and watch for USB drives, except while staff have the PC (maintenance / staff PIN).
async fn sweep_loop(_app: AppHandle, shared: Arc<Shared>) {
    let mut sweeper = system::Sweeper::new();
    let mut disks = sysinfo::Disks::new();
    let mut usb_seen: HashSet<String> = HashSet::new();
    let mut every = tokio::time::interval(Duration::from_secs(5));
    loop {
        every.tick().await;
        let view = shared.last_view.lock().unwrap().clone();
        if view.as_ref().map_or(true, |v| matches!(v.reason, Reason::Maintenance | Reason::Staff | Reason::NotPaired)) {
            usb_seen.clear();
            continue;
        }
        let (mut blocked, restrictions) = shared
            .sync
            .lock()
            .unwrap()
            .as_ref()
            .map(|s| (s.blocked_apps.clone(), s.restrictions.clone()))
            .unwrap_or_default();
        blocked.extend(restrict::programs_for(&restrictions));

        // USB drives: reported in Activity when plugged in during the player's time.
        if restrictions.iter().any(|r| r == "usb_drives") {
            disks.refresh_list();
            let now: HashSet<String> = health::removable(&disks).into_iter().collect();
            let new: Vec<String> = now.difference(&usb_seen).cloned().collect();
            usb_seen = now;
            if let (false, Some(token)) = (new.is_empty(), shared.token()) {
                let blocked_by_windows = shared.restrictions.lock().unwrap().usb_blocked();
                for drive in new {
                    let _ = shared
                        .api()
                        .report(&token, "usb_drive", json!({ "drive": drive, "blocked": blocked_by_windows }))
                        .await;
                }
            }
        }

        if blocked.is_empty() {
            continue;
        }
        let closed = sweeper.sweep(&blocked);
        if closed.is_empty() {
            continue;
        }
        let Some(token) = shared.token() else { continue };
        let api = shared.api();
        for app_name in closed {
            // Report each app at most every 10 minutes, so a retry loop doesn't flood Activity.
            let due = {
                let mut r = shared.reported.lock().unwrap();
                let due = r.get(&app_name).map_or(true, |at| at.elapsed() > Duration::from_secs(600));
                if due {
                    r.insert(app_name.clone(), Instant::now());
                }
                due
            };
            if due {
                let _ = api.report(&token, "blocked_app", json!({ "app": app_name })).await;
            }
        }
    }
}

/// Performance readings every 15 s (off the async threads: nvidia-smi is a separate program).
async fn health_loop(shared: Arc<Shared>) {
    let monitor = Arc::new(Mutex::new(health::Monitor::new()));
    let mut every = tokio::time::interval(SYNC_EVERY);
    loop {
        every.tick().await;
        let m = monitor.clone();
        let Ok(mut reading) = tokio::task::spawn_blocking(move || m.lock().unwrap().sample()).await else {
            continue;
        };
        reading["restrictions"] = shared.restrictions.lock().unwrap().status();
        *shared.health.lock().unwrap() = reading;
    }
}

// --- Commands from the windows -----------------------------------------------------------------

// All commands are async so they run off the main thread: apply() asks the windows for their
// state, which must not block the UI thread.
#[tauri::command]
async fn get_view(shared: State<'_, Arc<Shared>>) -> Result<View, String> {
    Ok(shared.view())
}

/// Debug builds only: close the app. Release builds (the .msi) refuse.
#[tauri::command]
async fn dev_quit(app: AppHandle) -> Result<(), String> {
    if !cfg!(debug_assertions) {
        return Err("Not available in this build.".into());
    }
    keyboard::set_blocking(false);
    shared_lift_restrictions(&app);
    app.exit(0);
    Ok(())
}

fn shared_lift_restrictions(app: &AppHandle) {
    if let Some(shared) = app.try_state::<Arc<Shared>>() {
        shared.restrictions.lock().unwrap().set(&[]);
    }
}

/// The games menu: from the timer's "Menu" link (it also stays in the taskbar).
#[tauri::command]
async fn open_menu(app: AppHandle, shared: State<'_, Arc<Shared>>) -> Result<(), String> {
    if shared.view().reason != Reason::Session {
        return Err("The menu opens while your session runs.".into());
    }
    let w = app.get_webview_window("menu").ok_or("No menu window.")?;
    let _ = w.unminimize();
    let _ = w.show();
    let _ = w.set_focus();
    Ok(())
}

/// Start a game from the menu. Only ids from the venue's list: the window never sends a path.
#[tauri::command]
async fn launch_game(app: AppHandle, shared: State<'_, Arc<Shared>>, id: String) -> Result<(), String> {
    if !matches!(shared.view().reason, Reason::Session | Reason::Staff) {
        return Err("Games start while your session runs.".into());
    }
    let target = shared
        .sync
        .lock()
        .unwrap()
        .as_ref()
        .and_then(|s| s.games.iter().find(|g| g.id == id).map(|g| g.target.clone()))
        .ok_or("This game isn't on the list any more.")?;
    system::launch(&target)?;
    if let Some(w) = app.get_webview_window("menu") {
        let _ = w.minimize();
    }
    Ok(())
}

/// From the menu: order a snack ("snack" + product), 30 more minutes ("extend") or call staff ("call").
#[tauri::command]
async fn send_request(
    app: AppHandle,
    shared: State<'_, Arc<Shared>>,
    kind: String,
    product_id: Option<String>,
    quantity: Option<u32>,
) -> Result<(), String> {
    let token = shared.token().ok_or("This PC is not paired.")?;
    if !matches!(kind.as_str(), "snack" | "extend" | "call") {
        return Err("Unknown request.".into());
    }
    shared
        .api()
        .request(&token, &kind, product_id.as_deref(), quantity.unwrap_or(1).clamp(1, 10))
        .await
        .map_err(|e| e.to_string())?;
    sync_once(&app, &shared).await;
    Ok(())
}

/// From the menu: a voucher code goes into the session player's wallet. Returns the amount added.
#[tauri::command]
async fn redeem_voucher(app: AppHandle, shared: State<'_, Arc<Shared>>, code: String) -> Result<f64, String> {
    let token = shared.token().ok_or("This PC is not paired.")?;
    let code: String = code.chars().filter(|c| c.is_ascii_alphanumeric()).take(12).collect();
    if code.len() != 8 {
        return Err("A voucher code has 8 letters and numbers.".into());
    }
    let reply = shared.api().redeem_voucher(&token, &code).await.map_err(|e| e.to_string())?;
    if !reply.ok {
        return Err(reply.error.unwrap_or_else(|| "That voucher code isn't valid.".into()));
    }
    sync_once(&app, &shared).await;
    Ok(reply.amount.unwrap_or_default())
}

#[tauri::command]
async fn pair(
    app: AppHandle,
    shared: State<'_, Arc<Shared>>,
    code: String,
    pin: String,
    server_url: Option<String>,
    publishable_key: Option<String>,
) -> Result<String, String> {
    // The lock screen only shows pairing on an unpaired PC; refuse here too, so pairing can never
    // replace the staff PIN or the server on a PC that is in use. Unpair first (needs the PIN).
    if shared.token().is_some() {
        return Err("This PC is already paired. Unpair it with the staff PIN first.".into());
    }
    if !config::valid_pin(&pin) {
        return Err("Choose a staff PIN of 6 to 8 digits.".into());
    }
    let (url, key) = {
        let mut c = shared.config.lock().unwrap();
        // Release builds with a baked-in server don't take another address from the screen.
        if !config::server_is_fixed() {
            if let Some(u) = server_url.map(|u| u.trim().to_string()).filter(|u| !u.is_empty()) {
                config::check_server_url(&u)?;
                c.server_url = u;
            }
            if let Some(k) = publishable_key.map(|k| k.trim().to_string()).filter(|k| !k.is_empty()) {
                if k.starts_with("sb_secret_") {
                    return Err("That is the secret key. Use the publishable key (sb_publishable_…).".into());
                }
                c.publishable_key = k;
            }
        }
        (c.server_url.clone(), c.publishable_key.clone())
    };
    if url.is_empty() || key.is_empty() {
        return Err("Enter the QueSys server address and publishable key.".into());
    }
    config::check_server_url(&url)?;
    let api = Api::new(&url, &key);
    let paired = api.pair(code.trim(), &system::info(true)).await.map_err(|e| e.to_string())?;
    config::save_token(&paired.token)?;
    // The server keeps its own copy of the staff PIN; this one is only for when the PC is offline.
    if let Err(e) = api.set_staff_pin(&paired.token, &pin).await {
        eprintln!("staff PIN not stored on the server: {e}");
    }
    {
        let mut c = shared.config.lock().unwrap();
        c.channel = Some(paired.channel.clone());
        c.station = Some(paired.station.clone());
        c.set_pin(&pin);
        c.save(&shared.data_dir).map_err(|e| format!("Couldn't save settings: {e}"))?;
    }
    *shared.token.lock().unwrap() = Some(paired.token);
    *shared.sync.lock().unwrap() = None;
    shared.handled.lock().unwrap().clear();
    shared.poke.notify_one();
    apply(&app, &shared);
    Ok(paired.station)
}

/// Before pairing there is no staff PIN yet: whoever installs the app can use the PC for
/// 15 minutes (e.g. to fix the internet), once per app start.
#[tauri::command]
async fn skip_setup(app: AppHandle, shared: State<'_, Arc<Shared>>) -> Result<(), String> {
    if shared.token().is_some() {
        return Err("This PC is paired. Use the staff PIN.".into());
    }
    static USED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    if USED.swap(true, Ordering::SeqCst) {
        return Err("Already used. Restart the PC to skip again.".into());
    }
    *shared.staff_until.lock().unwrap() = Some(shared.server_now() + ChronoDuration::minutes(STAFF_UNLOCK_MINUTES));
    apply(&app, &shared);
    Ok(())
}

/// The local copy of the staff PIN (used when the server can't be reached). Five wrong PINs lock it
/// for 5 minutes, then 10, 20, 40, up to an hour.
fn check_pin_locally(shared: &Shared, pin: &str) -> Result<(), String> {
    let mut f = shared.pin_failures.lock().unwrap();
    if let Some(until) = f.2 {
        if Instant::now() < until {
            return Err("Too many wrong PINs. Try again later.".into());
        }
        f.2 = None;
    }
    if shared.config.lock().unwrap().check_pin(pin) {
        *f = (0, 0, None);
        return Ok(());
    }
    f.0 += 1;
    if f.0 >= 5 {
        let minutes = (5u64 << f.1.min(4)).min(60);
        f.0 = 0;
        f.1 += 1;
        f.2 = Some(Instant::now() + Duration::from_secs(minutes * 60));
    }
    Err("Wrong PIN.".into())
}

/// Staff PIN: the server decides whenever it can be reached (the local file could have been edited
/// during a paid session). Only with no internet does the local copy count. Returns whether the
/// server checked it (and so already logged the unlock).
async fn verify_staff_pin(shared: &Shared, pin: &str) -> Result<bool, String> {
    let Some(token) = shared.token() else {
        return check_pin_locally(shared, pin).map(|_| false);
    };
    match shared.api().check_staff_pin(&token, pin).await {
        Ok(r) if r.ok => Ok(true),
        Ok(r) if r.unset => {
            // Paired before server checks existed: trust the local copy once, then store it there.
            check_pin_locally(shared, pin)?;
            if config::valid_pin(pin) {
                let _ = shared.api().set_staff_pin(&token, pin).await;
            }
            Ok(false)
        }
        Ok(r) => Err(r.error.unwrap_or_else(|| "Wrong PIN.".into())),
        Err(api::ApiError::Network(_)) => check_pin_locally(shared, pin).map(|_| false),
        Err(e) => Err(e.to_string()),
    }
}

/// Staff PIN: opens the PC for 15 minutes without a session (e.g. updates, or the internet is down).
/// Logged in Activity when online.
#[tauri::command]
async fn staff_unlock(app: AppHandle, shared: State<'_, Arc<Shared>>, pin: String) -> Result<(), String> {
    let logged = verify_staff_pin(&shared, &pin).await?;
    *shared.staff_until.lock().unwrap() = Some(shared.server_now() + ChronoDuration::minutes(STAFF_UNLOCK_MINUTES));
    apply(&app, &shared);
    if !logged {
        if let Some(token) = shared.token() {
            let _ = shared.api().report(&token, "staff_unlock", json!({})).await;
        }
    }
    Ok(())
}

/// A player logs in on the lock screen with mobile + PIN. The server starts open time in their
/// name; checking in right away unlocks the PC without waiting for the next poll.
#[tauri::command]
async fn player_login(app: AppHandle, shared: State<'_, Arc<Shared>>, mobile: String, pin: String) -> Result<String, String> {
    let token = shared.token().ok_or("This PC is not paired.")?;
    let mobile: String = mobile.chars().filter(|c| c.is_ascii_digit()).collect();
    if mobile.len() < 10 {
        return Err("Enter your 10-digit mobile number.".into());
    }
    if pin.len() != 4 || !pin.chars().all(|c| c.is_ascii_digit()) {
        return Err("Enter your 4-digit PIN.".into());
    }
    let reply = shared.api().player_login(&token, &mobile, &pin).await.map_err(|e| e.to_string())?;
    if !reply.ok {
        return Err(reply.error.unwrap_or_else(|| "Couldn't log in. Ask at the counter.".into()));
    }
    sync_once(&app, &shared).await;
    Ok(reply.name.unwrap_or_default())
}

#[tauri::command]
async fn staff_lock(app: AppHandle, shared: State<'_, Arc<Shared>>) -> Result<(), String> {
    *shared.staff_until.lock().unwrap() = None;
    apply(&app, &shared);
    Ok(())
}

/// Forget this PC's pairing (e.g. moving it to another station). Needs the staff PIN.
#[tauri::command]
async fn unpair(app: AppHandle, shared: State<'_, Arc<Shared>>, pin: String) -> Result<(), String> {
    verify_staff_pin(&shared, &pin).await?;
    config::delete_token();
    *shared.token.lock().unwrap() = None;
    *shared.sync.lock().unwrap() = None;
    *shared.staff_until.lock().unwrap() = None;
    {
        let mut c = shared.config.lock().unwrap();
        c.channel = None;
        c.station = None;
        let _ = c.save(&shared.data_dir);
    }
    apply(&app, &shared);
    Ok(())
}
