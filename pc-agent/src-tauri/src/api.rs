//! Calls to the QueSys database functions (Supabase PostgREST `/rest/v1/rpc/*`).
//!
//! Only the publishable key is sent (anon role). Each agent function checks the device key itself,
//! so this PC can read only its own station and acknowledge only its own commands.

use chrono::{DateTime, Utc};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;

#[derive(Debug)]
pub enum ApiError {
    /// The device key is no longer valid (unpaired or paired again elsewhere).
    Unpaired,
    /// The server answered with an error meant for people, e.g. "That code is wrong".
    Rejected(String),
    /// No internet / server unreachable.
    Network(String),
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ApiError::Unpaired => write!(f, "This PC is not paired. Pair it again from Stations."),
            ApiError::Rejected(m) => write!(f, "{m}"),
            ApiError::Network(m) => write!(f, "Can't reach QueSys: {m}"),
        }
    }
}

#[derive(Clone)]
pub struct Api {
    http: reqwest::Client,
    base: String,
    key: String,
}

impl Api {
    pub fn new(server_url: &str, publishable_key: &str) -> Api {
        Api {
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(10))
                .user_agent(concat!("QueSysPC/", env!("CARGO_PKG_VERSION")))
                .build()
                .expect("http client"),
            base: server_url.trim_end_matches('/').to_string(),
            key: publishable_key.to_string(),
        }
    }

    async fn call(&self, function: &str, body: Value) -> Result<String, ApiError> {
        let res = self
            .http
            .post(format!("{}/rest/v1/rpc/{function}", self.base))
            .header("apikey", &self.key)
            .json(&body)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.without_url().to_string()))?;
        let status = res.status();
        let text = res.text().await.map_err(|e| ApiError::Network(e.to_string()))?;
        if status.is_success() {
            return Ok(text);
        }
        let err: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
        if err["code"] == "28000" {
            return Err(ApiError::Unpaired);
        }
        if status.is_server_error() {
            return Err(ApiError::Network(format!("server error {status}")));
        }
        Err(ApiError::Rejected(
            err["message"].as_str().map(str::to_string).unwrap_or_else(|| format!("Request failed ({status})")),
        ))
    }

    async fn rpc<T: DeserializeOwned>(&self, function: &str, body: Value) -> Result<T, ApiError> {
        let text = self.call(function, body).await?;
        serde_json::from_str(&text).map_err(|e| ApiError::Network(format!("unexpected reply: {e}")))
    }

    pub async fn pair(&self, code: &str, info: &Value) -> Result<Paired, ApiError> {
        self.rpc("agent_pair", json!({ "p_code": code, "p_info": info })).await
    }

    pub async fn sync(&self, token: &str, info: &Value) -> Result<SyncData, ApiError> {
        self.rpc("agent_sync", json!({ "p_token": token, "p_info": info })).await
    }

    /// A player logs in on this PC with mobile + PIN. Wrong tries come back as `ok: false`.
    pub async fn player_login(&self, token: &str, mobile: &str, pin: &str) -> Result<LoginReply, ApiError> {
        self.rpc("agent_player_login", json!({ "p_token": token, "p_mobile": mobile, "p_pin": pin })).await
    }

    /// Store the staff PIN on the server, once, right after pairing.
    pub async fn set_staff_pin(&self, token: &str, pin: &str) -> Result<(), ApiError> {
        self.call("agent_set_staff_pin", json!({ "p_token": token, "p_pin": pin })).await.map(|_| ())
    }

    /// Check the staff PIN on the server (it logs the unlock and locks out repeated wrong PINs).
    pub async fn check_staff_pin(&self, token: &str, pin: &str) -> Result<StaffPinReply, ApiError> {
        self.rpc("agent_check_staff_pin", json!({ "p_token": token, "p_pin": pin })).await
    }

    /// From the games menu: order a snack, ask for 30 more minutes, or call staff.
    pub async fn request(&self, token: &str, kind: &str, product_id: Option<&str>, quantity: u32) -> Result<(), ApiError> {
        self.call(
            "agent_request",
            json!({ "p_token": token, "p_kind": kind, "p_product_id": product_id, "p_quantity": quantity }),
        )
        .await
        .map(|_| ())
    }

    /// From the games menu: a voucher into the session player's wallet.
    pub async fn redeem_voucher(&self, token: &str, code: &str) -> Result<VoucherReply, ApiError> {
        self.rpc("agent_redeem_voucher", json!({ "p_token": token, "p_code": code })).await
    }

    pub async fn ack(&self, token: &str, command_id: &str, result: &str) -> Result<(), ApiError> {
        self.call("agent_ack", json!({ "p_token": token, "p_command_id": command_id, "p_result": result }))
            .await
            .map(|_| ())
    }

    pub async fn report(&self, token: &str, kind: &str, details: Value) -> Result<(), ApiError> {
        self.call("agent_report", json!({ "p_token": token, "p_kind": kind, "p_details": details }))
            .await
            .map(|_| ())
    }

    /// Realtime websocket address for this server.
    pub fn realtime_url(&self) -> String {
        let ws = if let Some(rest) = self.base.strip_prefix("https://") {
            format!("wss://{rest}")
        } else if let Some(rest) = self.base.strip_prefix("http://") {
            format!("ws://{rest}")
        } else {
            self.base.clone()
        };
        format!("{ws}/realtime/v1/websocket?apikey={}&vsn=1.0.0", self.key)
    }
}

#[derive(Deserialize, Debug)]
pub struct StaffPinReply {
    pub ok: bool,
    /// The server has no staff PIN for this PC yet (paired before server checks existed).
    #[serde(default)]
    pub unset: bool,
    pub error: Option<String>,
}

#[derive(Deserialize, Debug)]
pub struct VoucherReply {
    pub ok: bool,
    pub amount: Option<f64>,
    pub error: Option<String>,
}

#[derive(Deserialize, Debug)]
pub struct LoginReply {
    pub ok: bool,
    pub name: Option<String>,
    pub error: Option<String>,
}

#[derive(Deserialize, Debug)]
pub struct Paired {
    pub token: String,
    pub channel: String,
    pub station: String,
}

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
pub struct Station {
    pub id: String,
    pub name: String,
    /// active | maintenance | disabled
    pub status: String,
}

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
pub struct Session {
    pub id: String,
    /// open | prepaid ("Fixed time")
    pub mode: String,
    /// running | paused
    pub status: String,
    pub started_at: DateTime<Utc>,
    pub planned_end_at: Option<DateTime<Utc>>,
    pub paused_at: Option<DateTime<Utc>>,
    pub customer_name: Option<String>,
}

/// A games-menu entry (Settings › PC app). The target never goes to the window, only its id.
#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
pub struct Game {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing)]
    pub target: String,
}

/// A snack or drink the player can order from the menu.
#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
pub struct MenuItem {
    pub id: String,
    pub name: String,
    pub price: f64,
    pub category: Option<String>,
}

/// An order / staff call from this session and what staff did with it.
#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
pub struct Request {
    pub id: String,
    /// snack | extend | call
    pub kind: String,
    pub label: String,
    /// pending | accepted | declined
    pub status: String,
}

#[derive(Deserialize, Clone, Debug)]
pub struct Command {
    pub id: String,
    /// message | restart | shutdown | wake
    pub kind: String,
    #[serde(default)]
    pub payload: Value,
}

#[derive(Deserialize, Clone, Debug)]
pub struct SyncData {
    pub server_now: DateTime<Utc>,
    pub channel: String,
    pub venue: Option<String>,
    pub station: Station,
    pub lock_message: Option<String>,
    #[serde(default)]
    pub blocked_apps: Vec<String>,
    /// The lock screen shows mobile + PIN login (Settings › PC app).
    #[serde(default)]
    pub player_login: bool,
    pub session: Option<Session>,
    #[serde(default)]
    pub commands: Vec<Command>,
    #[serde(default)]
    pub games: Vec<Game>,
    /// task_manager | control_panel | command_line | usb_drives
    #[serde(default)]
    pub restrictions: Vec<String>,
    /// Players can order snacks (Settings › Online, shared with the QR page).
    #[serde(default)]
    pub orders: bool,
    /// The session player's wallet balance, if the session has a player.
    #[serde(default)]
    pub wallet: Option<f64>,
    /// The session has a player: the menu offers "Have a voucher?".
    #[serde(default)]
    pub vouchers: bool,
    #[serde(default)]
    pub menu: Vec<MenuItem>,
    #[serde(default)]
    pub requests: Vec<Request>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_sync_reply() {
        let raw = r#"{
            "server_now": "2026-11-06T10:00:00.123456+05:30",
            "channel": "6d2a7f2e-6c1f-4d0e-9a59-3f0c1f7b9a10",
            "venue": "Arena", "branch": "Main",
            "station": {"id": "s1", "name": "PC-01", "status": "active"},
            "lock_message": null,
            "blocked_apps": ["taskmgr.exe"],
            "session": {"id": "x", "mode": "prepaid", "status": "running",
                        "started_at": "2026-11-06T09:00:00+05:30",
                        "planned_end_at": "2026-11-06T11:00:00+05:30",
                        "paused_at": null, "customer_name": "Asha"},
            "commands": [{"id": "c1", "kind": "message", "payload": {"text": "hi"}}],
            "games": [{"id": "g1", "name": "Valorant", "target": "C:\\Riot\\riot.exe"}],
            "restrictions": ["task_manager"],
            "orders": true, "wallet": 120.50,
            "menu": [{"id": "p1", "name": "Coke", "price": 40.00, "category": "Drinks"}],
            "requests": [{"id": "r1", "kind": "call", "label": "Call staff", "status": "pending"}]
        }"#;
        let s: SyncData = serde_json::from_str(raw).unwrap();
        assert_eq!(s.station.name, "PC-01");
        assert_eq!(s.commands[0].payload["text"], "hi");
        assert!(s.session.unwrap().planned_end_at.is_some());
        assert_eq!(s.games[0].target, "C:\\Riot\\riot.exe");
        // The window gets the name and id, never the program path.
        assert!(!serde_json::to_string(&s.games[0]).unwrap().contains("riot.exe"));
        assert_eq!(s.wallet, Some(120.5));
        assert_eq!(s.menu[0].price, 40.0);
        // An older server without these fields still parses.
        let old: SyncData = serde_json::from_str(
            r#"{"server_now": "2026-11-06T10:00:00Z", "channel": "c", "venue": null,
                "station": {"id": "s", "name": "PC", "status": "active"}, "lock_message": null, "session": null}"#,
        )
        .unwrap();
        assert!(old.games.is_empty() && old.wallet.is_none());
    }

    #[test]
    fn realtime_address() {
        let api = Api::new("https://abc.supabase.co/", "sb_publishable_x");
        assert_eq!(
            api.realtime_url(),
            "wss://abc.supabase.co/realtime/v1/websocket?apikey=sb_publishable_x&vsn=1.0.0"
        );
    }
}
