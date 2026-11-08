# QueSys plan

Management for gaming cafes (PC, PS5, Xbox) and snooker / 8-ball pool halls.
One live floor, server-side timers and billing. PC lock/unlock and hardware come later.

Stack: Next.js 16 (App Router) + Supabase (Postgres, Auth, RLS, Realtime). India: INR, GST, cash and UPI.

Sessions store timestamps. Clients show remaining or elapsed time from `planned_end_at` and the server clock. Pricing is one Postgres function (`private.session_charge`). Dashboard, bills, and (later) the PC agent all use it.

## Phase 1: Foundation (done)

- Sign up, log in, password reset.
- Create a cafe and the first branch, or join with an invite code.
- Stations, including bulk add (`PC-01` … `PC-20`). Status: active, maintenance, disabled.
- Rate plans, time-of-day / weekday rules, fixed-time packages.
- Roles: owner and staff. Row-level security on every table. A cafe always keeps one owner.
- Light and dark theme.

## Phase 2: Timers and billing (done)

This replaces paper timing for every station type. Payments are cash, UPI (paid on the venue's own counter QR; staff mark it paid) or a player's wallet. There is no payment gateway.

**Floor.** Grid or floor map (owner can place stations). Cards by state: free, in use, ending soon, overtime, paused, off (maintenance or disabled). Live timer, player name, running charge. Actions: start, pause, resume, add time, move to another station of the same type, change player count, end and bill. Sound when fixed time runs out (can be muted). “Ended, not paid” list; the owner can write a session off with a reason. If the internet drops, a reconnect banner shows, timers keep ticking from the last data, and the floor resyncs on its own. The same screens work on a phone, so staff can run tables from mobile data when cafe broadband is down.

**Two timer modes.** Both are paid at the end. The owner picks which modes a station type allows, and which one Start uses.

- Open time: counts up. The player pays the minutes played (minimum charge and rounding apply).
- Fixed time: counts down from a package or a custom length. Alert at zero, then overtime. A grace period (default 2 minutes) is free. Collecting the booking up front is optional; if it was collected, only the extra is billed later.

**Fixed time stopped early** (owner setting): charge the full booking, or only the time played at the hourly rate, never more than the booking. A booking already paid up front stays final.

**Bills.** One or more sessions on one bill (a group that played PS5 then pool). Discount, cash, UPI, or a split. GST off: a receipt with no tax. GST on: a tax invoice with CGST and SGST, prices inclusive or exclusive. The bill stores the tax settings from checkout, so changing GST later does not change old bills. Separate number series for tax invoices and receipts. Printable. Day list and CSV export.

**Players.** One player per mobile number per cafe. Name and phone are required to start. Visit history, amount paid, amount owed.

**Reports** (owner). Today, 7 days, 30 days, this month, last month, or a custom range. Revenue, sessions by hour, station types, payment mix, peak-time heatmap, top stations, top players.

**Counter controls.** The owner can cancel a wrong bill (with a reason): it leaves every total, its sessions go back to "Ended, not paid" for re-billing, wallet money returns to the wallet, and counter-sale items can go back in stock. Every discount needs a reason; staff are capped at a % the owner sets. Snacks & drinks can track stock (sales take it down; deliveries and shelf counts are logged, and a short count shows as missing). Wallet top-up offers ("pay ₹500, get ₹50") are applied by the database. Time's-up alerts sound on every page, with a system notification when the tab is in the background.

**Expenses** (owner). Rent, electricity, internet, salaries linked to a team member, and other costs. Repeating expenses. Net profit in Reports.

**Settings.** Branch details and which station types the venue offers. Billing (bill prefix, overtime grace, GST, timer modes, early-end rule). PC app (blocked apps, lock-screen message). Team invites. Extra branches. Activity log. Account and password.

## Phase 3: PC agent

**Status (2026-11-06):** built. Migration `20261118000001_pc_agent.sql`, test `07_pc_agent`, dashboard pairing / status / commands, and the Tauri app in `pc-agent/` (not compiled yet: needs Rust + MSVC build tools). Built differently from the first draft: device keys instead of a Supabase login per PC, and a watchdog process instead of a Windows service. Player mobile + PIN login on the lock screen: migration `20261119000001_player_pc_login.sql`, test `08_player_pc_login` (starts open time, pay at the counter; time packs dropped since the wallet covers prepaid money). Still to do: auto-update.

A Tauri app on each gaming PC: full-screen lock, timer widget, and remote start / pause / lock from the floor.

- Pairing code from the dashboard. The agent gets its own login, limited to that station. Credentials stay in Windows Credential Manager.
- Staff start on the floor unlocks the PC. Pause locks the screen and stops the clock. Add time updates the end time live. At zero the screen locks again.
- Prepaid time packs, separate from today’s fixed-time sessions: staff sell minutes (name, mobile, 4-digit PIN). The player logs in with mobile and PIN on any free PC. Logout deducts the minutes used. Leftover minutes follow the branch setting: keep for N days, same day only, or forfeit on logout. Five wrong PINs lock that number for 15 minutes. Staff can reset the PIN.
- Shutdown, restart, and Wake-on-LAN so one online PC can power the others on.
- Optional blocked-apps list. No remote screen view.
- If the internet drops mid-session, the agent still locks at the cached end time.
- MSI installer (Windows service plus the lock UI) and auto-update while the PC is locked or idle.
- While a game is running: under 60 MB RAM, under 1% CPU, keyboard hook installed only while locked.

## Phase 4: Hardware hub

A small service on a Raspberry Pi or the counter PC, paired to the branch. Timers and billing keep working if it is offline; staff switch hardware by hand.

- PS5 wake and rest over the LAN (`playactor`). Each PS5 stays connected in rest mode, with network power-on enabled and HDMI device link off.
- TV and table lights through Shelly relays: one channel per table, on at start and off at end. Address stored on the station.

## Phase 5: Growth

**Built (2026-11-08):** migrations `20261123000001` to `20261126000001`, tests `09` to `12`.

- Player choices on a rate (2 / 4 players or controllers, each with its own price) or one price for any number. Happy hour moves the smallest choice; the others keep their gap.
- Frames timer mode for tables (+ Frame / − Frame), per-frame price per choice.
- Who pays: a bill (or its khata) moves to another player at checkout, e.g. the losing side.
- Khata limit, venue-wide and per player; over it, staff can't start that player (the owner can). WhatsApp dues reminders (click-to-chat) on Players.
- Player QR page per station (`/s/<code>`): timer, bill, snack orders, 30 more minutes, call staff. Staff accept each request on the Floor. No payment on the page.
- Bookings: public page per branch (`/book/<address>`, no payment), phone bookings, confirm / station / arrived / no-show; upcoming bookings on the Floor.
- Knockout tournaments: singles or teams (captain pays one fee per team), on tables, PCs or consoles with a station per match (time not billed). Entry fee as a bill, random draw with byes, results by tap. Staff only. Migration `20261127000001`, test `13`.

Still to do:

- Snacks on the same bill: done earlier (session items).
- Loyalty; automatic WhatsApp or SMS ("10 minutes left", bills) through a Business API.
- Booking deposits (needs Razorpay), tournament leagues and a public bracket page.
- Multi-branch analytics.
- SaaS subscription billing for cafe owners, with plan limits by station count.

## Checks

- Database: pgTAP for tenant isolation, pricing (rounding, minimum, happy hour, pauses, extra players), GST on and off, early end, and expenses. CI runs these plus lint, type-check, and `next build`.
- Floor: two browsers; a start in one shows in the other within about a second. Go offline: the banner shows and timers keep moving. Come back: the floor matches without a reload.
- PC agent and hub: checked when those phases are built.
