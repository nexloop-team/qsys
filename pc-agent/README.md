# QueSys PC app

A small Windows app for each gaming PC. It is built with Tauri 2: a Rust core and a plain HTML window.

- **Player login:** on a free PC, players type their mobile number and 4-digit PIN to start open time in their own name. They pay at the counter at the end. Staff set the PIN on the player's page; owners can turn this off in Settings › PC app.
- **Locked** until a session starts, from the QueSys floor or by player login. The lock covers every monitor and blocks Win, Alt+Tab, Alt+F4, Alt+Esc, Ctrl+Esc and Ctrl+Shift+Esc.
- **Unlocks** when a session runs. The timer stays out of the way during games: it pops up for 10 seconds when the session starts and at 5 minutes left, then stays for the last minute (red). It never takes focus from the game.
- **Locks again** when the session is paused or ended, or when fixed time runs out. It minimizes the game first so the lock shows over full-screen games.
- **Commands from the floor:** message, restart, shut down, and turn on. Turn on is sent as Wake-on-LAN from another online PC on the same network.
- **Games menu:** when a session starts, a window lists the venue's games (Settings › PC app), the player's wallet balance, snacks to order, *30 more minutes* (fixed time) and *Call staff*. Orders and calls show up on the floor like QR-page requests. The menu stays in the taskbar, and the timer has a *Menu* link.
- **Restrictions:** Task Manager, Control Panel / Settings, command prompt / PowerShell / Registry Editor, and USB drives can be turned off for players (Settings › PC app). The app sets the Windows policy and also closes those programs. Staff unlock lifts them. USB blocking needs the app to run as administrator; otherwise a plugged-in USB drive is reported in Activity.
- **Tamper alerts:** each check-in says how long Windows and the app have been running. After two minutes of silence the server works out why (app closed, PC switched off, or no connection) and flags it on the floor if it happened during a session, or if the app was closed while the PC was locked.
- **Vouchers:** a player with a session can type a voucher code in the games menu to add it to their wallet.
- **Health:** each check-in carries CPU, memory, GPU (NVIDIA, via `nvidia-smi`) and disk readings. The floor shows them in the station sheet and flags a hot GPU, a full disk, full memory or a USB drive.
- **Blocked apps:** listed under Settings › PC app. They are closed every 5 seconds while a player has the PC, and each one closed is logged in Activity.
- **Time comes from the server.** Changing the PC clock does nothing. If the internet drops, the last known end time is still enforced.
- **Light on games.** No game hooks, no screen capture, nothing anti-cheat cares about. The keyboard hook exists only while locked.

## How it talks to QueSys

The app uses only the Supabase **URL and publishable key**, the same values as the website. Never put the secret key in this app.

Pairing trades a one-time code for a random device key. The device key is stored in Windows Credential Manager. The database keeps only its SHA-256 hash. Every call carries the device key, so a PC can read only its own station and acknowledge only its own commands.

| Database function | When |
|---|---|
| `agent_pair(code, info)` | Setup screen → returns the device key |
| `agent_sync(key, info)` | Every 15 s, and instantly on a Realtime "poke" → station, session, settings, commands |
| `agent_ack(key, command, result)` | After running a command |
| `agent_report(key, kind, details)` | A blocked app was closed, or the PC was opened with the staff PIN while offline |
| `agent_set_staff_pin(key, pin)` | Right after pairing: stores the staff PIN (bcrypt). Can't be changed without pairing again |
| `agent_check_staff_pin(key, pin)` | Staff unlock or unpair → checks the PIN, logs it, locks after 5 wrong tries |
| `agent_player_login(key, mobile, pin)` | A player logs in on the lock screen → starts open time in their name |
| `agent_request(key, kind, product, qty)` | From the games menu: order a snack, ask for 30 more minutes, call staff |
| `agent_redeem_voucher(key, code)` | From the games menu: a voucher into the session player's wallet |

### Security

- **HTTPS only.** The app refuses an `http://` server address (only `localhost` in debug builds), so the device key and PINs never cross the café network in clear text.
- **Release builds use the baked-in server.** The settings file lives in the player's Windows profile, so it can be edited during a paid session. When the build has a server URL and key from `.env`, the file's values are ignored, so nobody can point a PC at another server.
- **The staff PIN is checked by the server** whenever the PC is online, for the same reason. The copy in the settings file (PBKDF2-SHA256, 200,000 rounds, salted) is used only when there is no internet.
- **Pairing can't be repeated on a paired PC.** Unpair first, which needs the staff PIN.
- **Wrong PINs lock for longer each time.** Staff PIN: 5 wrong → 15 min, 1 h, 4 h, 24 h on the server (5 min doubling to 1 h offline). Player PIN: 5 wrong → 15 min, 1 h, 4 h, 24 h. Every lock shows in Activity.

Instant updates use a Realtime broadcast on a private topic per PC (`qs-device-<uuid>`). If that is unavailable, the 15-second check-in still covers everything.

## Build (on a Windows PC)

The dev machine has these installed (Build Tools 2022, Rust 1.99, tauri-cli 2.12).

1. **Microsoft C++ Build Tools.** Install Visual Studio Build Tools with the workload **Desktop development with C++**.
2. **Rust:** <https://rustup.rs> → run `rustup-init.exe` and accept the defaults (stable, MSVC).
3. **Tauri CLI:** `cargo install tauri-cli --version "^2" --locked`
4. **WebView2** comes with Windows 10/11. The installer downloads it if it is missing.

Put your Supabase URL and **publishable** key in `pc-agent/.env` (copy `.env.example`). The build bakes them in, so venues only type the pairing code. The file is git-ignored. Shell variables with the same names override it, and the build stops if a `sb_secret_` key is put there.

Then, from `pc-agent/src-tauri`:

```powershell
cargo test          # lock/unlock rules, parsing, PIN hashing, game links, health readings
cargo tauri dev     # run it (debug: not added to Windows start-up)
cargo tauri build   # installers in target/release/bundle/{msi,nsis}/
```

On Linux you can type-check the Windows code without a Windows PC: install `gcc-mingw-w64-x86-64`, run `rustup target add x86_64-pc-windows-gnu`, then `cargo check --target x86_64-pc-windows-gnu`.

Without the `.env`, open **Server settings** on the setup screen and paste the URL and publishable key there.

## Set up a PC

1. Install the `.msi` and open **QueSys PC**. It starts on the setup screen.
2. On the website, go to **Stations**, find the PC row and press **Pair**. Type the 8-character code into the PC app.
3. Choose a **staff PIN** (6–8 digits). Staff can tap *Staff* on the lock screen to open the PC for 15 minutes without a session, for example for updates or when the internet is down. Each use is logged in Activity. The same PIN is needed to unpair the PC.
4. Done. The PC locks, and starting a session on the floor unlocks it within a second or two.

The release build adds itself to Windows start-up as `quesys-pc.exe --watchdog`. The watchdog restarts the app within seconds if it is closed or crashes.

### Harden the player account

No app can block Ctrl+Alt+Del. Make the PCs locked down as well:

- Players use a **standard (non-admin)** Windows account that signs in automatically.
- Group Policy › User Configuration › Administrative Templates › System › Ctrl+Alt+Del Options: remove **Task Manager**, **Lock**, **Change password** and **Log off**.
- Add `taskmgr.exe`, `regedit.exe` and `cmd.exe` to *Blocked apps* in Settings › PC app.
- BIOS: enable **Wake on LAN**. In Windows Device Manager › network adapter › Power Management, allow it to wake the computer. This makes **Turn on** work.

## Files

```
src-tauri/src/lib.rs        windows, loops (sync, 1 s tick, blocked-apps sweep), commands
src-tauri/src/decide.rs     locked or unlocked? (pure, unit-tested)
src-tauri/src/api.rs        database calls
src-tauri/src/realtime.rs   instant "poke" listener
src-tauri/src/keyboard.rs   key blocking while locked (Windows)
src-tauri/src/system.rs     PC details, restart/shutdown, Wake-on-LAN, blocked apps
src-tauri/src/config.rs     settings file + device key in Credential Manager
src-tauri/src/watchdog.rs   keeps the app running
ui/                         lock screen, extra-monitor covers, timer widget
```

## Not in this version

- Auto-update. Install new versions with the `.msi`.
- Screen view or remote control.
z