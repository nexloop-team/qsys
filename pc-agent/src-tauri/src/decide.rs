//! Locked or unlocked? A pure function of the last check-in and the (server) clock, so the same
//! answer comes out online or offline, and it can be unit-tested.

use crate::api::SyncData;
use chrono::{DateTime, Utc};
use serde::Serialize;

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Screen {
    /// Not paired yet: the setup screen.
    Setup,
    Locked,
    Unlocked,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Reason {
    // Locked
    /// Starting up, nothing heard from the server yet.
    Starting,
    /// No session on this station.
    Free,
    Paused,
    /// Fixed time ran out.
    TimeUp,
    /// Station switched off in Stations.
    Disabled,
    // Unlocked
    Session,
    /// Station in maintenance: open for staff.
    Maintenance,
    /// Unlocked here with the staff PIN.
    Staff,
    // Setup
    NotPaired,
}

#[derive(Debug, PartialEq)]
pub struct Decision {
    pub screen: Screen,
    pub reason: Reason,
    /// When the unlocked time ends (fixed time, or a staff unlock). None = open-ended.
    pub ends_at: Option<DateTime<Utc>>,
    pub started_at: Option<DateTime<Utc>>,
}

impl Decision {
    fn locked(reason: Reason) -> Decision {
        Decision { screen: Screen::Locked, reason, ends_at: None, started_at: None }
    }
}

pub fn decide(
    paired: bool,
    sync: Option<&SyncData>,
    now: DateTime<Utc>,
    staff_until: Option<DateTime<Utc>>,
) -> Decision {
    // Staff PIN (or "skip setup for now" on an unpaired PC) wins for its few minutes.
    if let Some(until) = staff_until.filter(|u| *u > now) {
        return Decision { screen: Screen::Unlocked, reason: Reason::Staff, ends_at: Some(until), started_at: None };
    }
    if !paired {
        return Decision { screen: Screen::Setup, reason: Reason::NotPaired, ends_at: None, started_at: None };
    }
    let Some(sync) = sync else {
        return Decision::locked(Reason::Starting);
    };
    match sync.station.status.as_str() {
        "maintenance" => {
            return Decision { screen: Screen::Unlocked, reason: Reason::Maintenance, ends_at: None, started_at: None }
        }
        "disabled" => return Decision::locked(Reason::Disabled),
        _ => {}
    }
    let Some(s) = &sync.session else {
        return Decision::locked(Reason::Free);
    };
    if s.status == "paused" {
        return Decision::locked(Reason::Paused);
    }
    if s.status != "running" {
        return Decision::locked(Reason::Free);
    }
    let ends_at = if s.mode == "prepaid" { s.planned_end_at } else { None };
    if ends_at.is_some_and(|end| end <= now) {
        return Decision::locked(Reason::TimeUp);
    }
    Decision { screen: Screen::Unlocked, reason: Reason::Session, ends_at, started_at: Some(s.started_at) }
}

/// How long the timer pops up: when a session starts, and at the 5-minute mark.
pub const POPUP_SECONDS: i64 = 10;

/// The timer stays out of the way during a game. It pops up for a few seconds when the session
/// starts (so the player sees their time is running) and when 5 minutes are left, then stays for
/// the whole last minute. It also shows for a floor message, and during a staff unlock (it has
/// the "Lock now" button).
pub fn widget_visible(d: &Decision, now: DateTime<Utc>, has_message: bool) -> bool {
    if d.screen != Screen::Unlocked {
        return false;
    }
    if has_message || d.reason == Reason::Staff {
        return true;
    }
    if d.reason != Reason::Session {
        return false;
    }
    if d.started_at.is_some_and(|s| (now - s).num_seconds() < POPUP_SECONDS) {
        return true;
    }
    let Some(end) = d.ends_at else { return false };
    // Rounded up, the same way the timer shows it: 04:59.4 reads as 5:00.
    let left = ((end - now).num_milliseconds() + 999).div_euclid(1000);
    left <= 60 || (300 - POPUP_SECONDS < left && left <= 300)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::{Session, Station};
    use chrono::Duration;

    fn sync(status: &str, session: Option<Session>) -> SyncData {
        SyncData {
            server_now: Utc::now(),
            channel: "c".into(),
            venue: None,
            station: Station { id: "s".into(), name: "PC-01".into(), status: status.into() },
            lock_message: None,
            blocked_apps: vec![],
            player_login: true,
            session,
            commands: vec![],
            games: vec![],
            restrictions: vec![],
            orders: false,
            wallet: None,
            menu: vec![],
            requests: vec![],
        }
    }

    fn session(mode: &str, status: &str, end_in_min: Option<i64>, now: DateTime<Utc>) -> Session {
        Session {
            id: "x".into(),
            mode: mode.into(),
            status: status.into(),
            started_at: now - Duration::minutes(30),
            planned_end_at: end_in_min.map(|m| now + Duration::minutes(m)),
            paused_at: None,
            customer_name: None,
        }
    }

    #[test]
    fn not_paired_shows_setup() {
        assert_eq!(decide(false, None, Utc::now(), None).screen, Screen::Setup);
    }

    #[test]
    fn no_session_locks() {
        let now = Utc::now();
        assert_eq!(decide(true, Some(&sync("active", None)), now, None).reason, Reason::Free);
        assert_eq!(decide(true, None, now, None).reason, Reason::Starting);
    }

    #[test]
    fn running_unlocks_and_fixed_time_runs_out() {
        let now = Utc::now();
        let open = sync("active", Some(session("open", "running", None, now)));
        let d = decide(true, Some(&open), now, None);
        assert_eq!((d.screen, d.ends_at), (Screen::Unlocked, None));

        let fixed = sync("active", Some(session("prepaid", "running", Some(10), now)));
        assert_eq!(decide(true, Some(&fixed), now, None).screen, Screen::Unlocked);
        // Same cached data, 11 minutes later (e.g. internet down): locks on time.
        assert_eq!(decide(true, Some(&fixed), now + Duration::minutes(11), None).reason, Reason::TimeUp);
    }

    #[test]
    fn paused_locks() {
        let now = Utc::now();
        let s = sync("active", Some(session("prepaid", "paused", Some(10), now)));
        assert_eq!(decide(true, Some(&s), now, None).reason, Reason::Paused);
    }

    #[test]
    fn station_status_wins() {
        let now = Utc::now();
        assert_eq!(decide(true, Some(&sync("maintenance", None)), now, None).reason, Reason::Maintenance);
        let s = sync("disabled", Some(session("open", "running", None, now)));
        assert_eq!(decide(true, Some(&s), now, None).reason, Reason::Disabled);
    }

    #[test]
    fn staff_pin_unlock_expires() {
        let now = Utc::now();
        let s = sync("active", None);
        let until = Some(now + Duration::minutes(15));
        assert_eq!(decide(true, Some(&s), now, until).reason, Reason::Staff);
        assert_eq!(decide(true, Some(&s), now + Duration::minutes(16), until).reason, Reason::Free);
    }

    #[test]
    fn timer_hides_during_play() {
        let now = Utc::now();
        let fixed = sync("active", Some(session("prepaid", "running", Some(30), now)));
        let d = decide(true, Some(&fixed), now, None);
        let at = |left_s: i64| now + Duration::minutes(30) - Duration::seconds(left_s);
        assert!(!widget_visible(&d, at(20 * 60), false), "hidden mid-game");
        assert!(widget_visible(&d, at(300), false), "pops up at 5:00");
        assert!(widget_visible(&d, at(292), false), "still up at 4:52");
        assert!(!widget_visible(&d, at(280), false), "gone again at 4:40");
        assert!(!widget_visible(&d, at(61), false), "hidden at 1:01");
        assert!(widget_visible(&d, at(60), false), "last minute");
        assert!(widget_visible(&d, at(1), false), "last second");
        assert!(widget_visible(&d, at(20 * 60), true), "floor message");

        // The test session started 30 minutes ago; a fresh one pops up for a few seconds.
        let open = sync("active", Some(session("open", "running", None, now)));
        assert!(!widget_visible(&decide(true, Some(&open), now, None), now, false), "open time mid-game");
        let started = now - Duration::minutes(30);
        let d = decide(true, Some(&open), started + Duration::seconds(3), None);
        assert!(widget_visible(&d, started + Duration::seconds(3), false), "just logged in");
        assert!(!widget_visible(&d, started + Duration::seconds(12), false), "then hides");

        let staff = decide(true, Some(&sync("active", None)), now, Some(now + Duration::minutes(15)));
        assert!(widget_visible(&staff, now, false), "staff unlock shows Lock now");
        let locked = decide(true, Some(&sync("active", None)), now, None);
        assert!(!widget_visible(&locked, now, true));
    }
}
