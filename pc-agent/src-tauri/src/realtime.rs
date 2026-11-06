//! Instant updates: listens on this PC's Realtime broadcast topic and, on any "poke" from the
//! database (session started/paused/ended, command queued, settings changed), wakes the sync loop.
//! If Realtime is unreachable nothing breaks: the app still checks in every 15 seconds.

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Notify;
use tokio_tungstenite::{connect_async, tungstenite::Message};

/// Runs forever, reconnecting with backoff. `channel` is read each time so a re-pair takes effect.
pub async fn run(url: impl Fn() -> Option<(String, String)>, poke: Arc<Notify>) {
    let mut backoff = 2u64;
    loop {
        if let Some((ws_url, channel)) = url() {
            match listen(&ws_url, &channel, &poke).await {
                Ok(()) => backoff = 2,
                Err(_) => backoff = (backoff * 2).min(60),
            }
        }
        tokio::time::sleep(Duration::from_secs(backoff)).await;
    }
}

async fn listen(ws_url: &str, channel: &str, poke: &Notify) -> Result<(), String> {
    let (ws, _) = connect_async(ws_url).await.map_err(|e| e.to_string())?;
    let (mut tx, mut rx) = ws.split();
    let topic = format!("realtime:qs-device-{channel}");
    let join = json!({
        "topic": topic,
        "event": "phx_join",
        "payload": { "config": { "broadcast": { "self": false }, "presence": { "key": "" }, "private": false } },
        "ref": "1",
    });
    tx.send(Message::Text(join.to_string())).await.map_err(|e| e.to_string())?;
    // Catch anything that happened while disconnected.
    poke.notify_one();

    let mut heartbeat = tokio::time::interval(Duration::from_secs(25));
    let mut n: u64 = 1;
    loop {
        tokio::select! {
            _ = heartbeat.tick() => {
                n += 1;
                let hb = json!({ "topic": "phoenix", "event": "heartbeat", "payload": {}, "ref": n.to_string() });
                tx.send(Message::Text(hb.to_string())).await.map_err(|e| e.to_string())?;
            }
            msg = rx.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        let v: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
                        if v["event"] == "broadcast" {
                            poke.notify_one();
                        } else if v["event"] == "phx_reply" && v["payload"]["status"] == "error" {
                            return Err("join refused".into());
                        }
                    }
                    Some(Ok(Message::Ping(p))) => { let _ = tx.send(Message::Pong(p)).await; }
                    Some(Ok(Message::Close(_))) | None => return Ok(()),
                    Some(Err(e)) => return Err(e.to_string()),
                    _ => {}
                }
            }
        }
    }
}
