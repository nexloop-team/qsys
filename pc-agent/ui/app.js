// QueSys PC app windows. The Rust side decides locked/unlocked and sends a "view" event when it
// changes; this file only draws it. Clocks use the server time (Date.now() + offset_ms).
"use strict";

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const label = window.__TAURI__.window.getCurrentWindow().label;

const $ = (id) => document.getElementById(id);
let view = null;

const LOCK_TEXT = {
  starting: "Connecting…",
  free: null, // the venue's lock message, or the default below
  paused: "Session paused. Ask at the counter to continue.",
  time_up: "Time's up. Please see the counter to add more time.",
  disabled: "This PC is out of service.",
  not_paired: "",
};
const DEFAULT_FREE = "Ask at the counter to start your session.";

const now = () => Date.now() + (view ? view.offset_ms : 0);

function pad(n) {
  return String(n).padStart(2, "0");
}
function hms(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

// --- Lock screen -------------------------------------------------------------------------------
function drawLock() {
  $("lock").hidden = false;
  $("venue").textContent = view.venue || "QueSys";
  $("net").hidden = view.online || view.screen === "setup";
  $("net-text").textContent = "Offline · reconnecting";

  const setup = view.screen === "setup";
  $("setup").hidden = !setup;
  $("locked").hidden = setup;
  $("staff-btn").hidden = setup;
  $("dev-quit").hidden = !view.dev;

  if (setup) {
    if (!$("server").value) $("server").value = view.server_url || "";
    $("server-box").open = !view.server_url || !view.has_key;
    return;
  }

  $("station").textContent = view.station || "This PC";
  const text = $("lock-text");
  text.className = "lock-text" + (view.reason === "time_up" ? " over" : view.reason === "paused" ? " paused" : "");
  text.textContent =
    view.reason === "free" ? view.lock_message || DEFAULT_FREE : LOCK_TEXT[view.reason] ?? DEFAULT_FREE;
  $("lock-eyebrow").textContent = view.reason === "time_up" ? "Time's up" : "Locked";
  $("lock-banner").hidden = !view.message;
  $("lock-banner").textContent = view.message || "";

  const login = $("login-form");
  const showLogin = Boolean(view.player_login);
  if (showLogin && login.hidden) {
    login.reset();
    showError($("login-error"), "");
  }
  login.hidden = !showLogin;
  // With the login showing, the plain "ask at the counter" line is noise.
  if (showLogin && view.reason === "free" && !view.lock_message) text.hidden = true;
  else text.hidden = false;
  if (showLogin && !dialog.open && document.activeElement?.tagName !== "INPUT") $("login-mobile").focus();
}

function tickLock() {
  const d = new Date(now());
  $("clock").textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function showError(el, message) {
  el.textContent = message;
  el.hidden = !message;
}

$("code").addEventListener("input", (e) => {
  const raw = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  e.target.value = raw.length > 4 ? `${raw.slice(0, 4)} ${raw.slice(4)}` : raw;
});

$("setup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const pin = $("pin").value;
  if (!/^\d{4,8}$/.test(pin)) return showError($("setup-error"), "Choose a staff PIN of 4 to 8 digits.");
  if (pin !== $("pin2").value) return showError($("setup-error"), "The two PINs don't match.");
  showError($("setup-error"), "");
  $("pair-btn").disabled = true;
  $("pair-btn").textContent = "Pairing…";
  try {
    await invoke("pair", {
      code: $("code").value,
      pin,
      serverUrl: $("server").value || null,
      publishableKey: $("key").value || null,
    });
    $("setup-form").reset();
  } catch (err) {
    showError($("setup-error"), String(err));
  } finally {
    $("pair-btn").disabled = false;
    $("pair-btn").textContent = "Pair";
  }
});

$("dev-quit").addEventListener("click", () => invoke("dev_quit"));

$("login-pin").addEventListener("input", (e) => {
  e.target.value = e.target.value.replace(/\D/g, "").slice(0, 4);
});
$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const mobile = $("login-mobile").value.replace(/\D/g, "");
  const pin = $("login-pin").value;
  if (mobile.length < 10) return showError($("login-error"), "Enter your 10-digit mobile number.");
  if (!/^\d{4}$/.test(pin)) return showError($("login-error"), "Enter your 4-digit PIN.");
  showError($("login-error"), "");
  $("login-btn").disabled = true;
  $("login-btn").textContent = "Starting…";
  try {
    await invoke("player_login", { mobile, pin });
    $("login-form").reset(); // the PC unlocks on the next view
  } catch (err) {
    $("login-pin").value = "";
    showError($("login-error"), String(err));
    $("login-pin").focus();
  } finally {
    $("login-btn").disabled = false;
    $("login-btn").textContent = "Start playing";
  }
});

$("skip-btn").addEventListener("click", async () => {
  try {
    await invoke("skip_setup");
  } catch (err) {
    showError($("setup-error"), String(err));
  }
});

const dialog = $("pin-dialog");
$("staff-btn").addEventListener("click", () => {
  $("staff-pin").value = "";
  showError($("pin-error"), "");
  dialog.showModal();
  $("staff-pin").focus();
});
$("pin-cancel").addEventListener("click", () => dialog.close());
$("pin-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await invoke("staff_unlock", { pin: $("staff-pin").value });
    dialog.close();
  } catch (err) {
    showError($("pin-error"), String(err));
  }
});
$("unpair-btn").addEventListener("click", async () => {
  if (!confirm("Unpair this PC? It stays locked on the setup screen until it is paired again.")) return;
  try {
    await invoke("unpair", { pin: $("staff-pin").value });
    dialog.close();
  } catch (err) {
    showError($("pin-error"), String(err));
  }
});

// --- Timer widget ------------------------------------------------------------------------------
function tickWidget() {
  if (!view || view.screen !== "unlocked") return;
  const w = $("widget");
  const staff = view.reason === "staff" || view.reason === "maintenance";
  let state = "";
  let sub = "";

  if (view.ends_at) {
    const left = (Date.parse(view.ends_at) - now()) / 1000;
    $("w-clock").textContent = hms(left);
    if (!staff) {
      if (left <= 60) state = "last";
      else if (left <= 300) state = "ending";
      sub = left <= 60 ? "Last minute: save your game" : left <= 300 ? `${Math.ceil(left / 60)} minutes left` : "Time left";
    } else {
      sub = "Staff unlock · time left";
    }
  } else if (view.started_at) {
    $("w-clock").textContent = hms((now() - Date.parse(view.started_at)) / 1000);
    sub = "Open time · playing for";
  } else {
    $("w-clock").textContent = "";
    sub = view.reason === "maintenance" ? "Maintenance · open for staff" : "";
  }

  w.className = "widget" + (state ? ` ${state}` : "") + (staff ? " staff" : "");
  $("w-label").textContent = [view.station, view.customer].filter(Boolean).join(" · ") || "QueSys";
  $("w-sub").textContent = sub;
}

function drawWidget() {
  $("widget").hidden = false;
  $("w-lock").hidden = view.reason !== "staff";
  $("w-message").hidden = !view.message;
  $("w-message").textContent = view.message || "";
  tickWidget();
}

$("w-lock").addEventListener("click", () => invoke("staff_lock"));

// --- Wiring ------------------------------------------------------------------------------------
function draw() {
  if (!view) return;
  if (label === "widget") drawWidget();
  else if (label.startsWith("cover-")) {
    $("cover").hidden = false;
    $("cover-station").textContent = view.station || "";
  } else drawLock();
}

if (label === "widget") document.body.classList.add("is-widget");
// No right-click menu, no reload shortcuts.
document.addEventListener("contextmenu", (e) => e.preventDefault());
document.addEventListener("keydown", (e) => {
  if (e.key === "F5" || (e.ctrlKey && ["r", "R", "p", "P", "u", "U"].includes(e.key))) e.preventDefault();
});

listen("view", (e) => {
  view = e.payload;
  draw();
});
invoke("get_view").then((v) => {
  view = v;
  draw();
});
setInterval(() => {
  if (label === "widget") tickWidget();
  else if (label === "lock") tickLock();
}, 1000);
tickLock();
