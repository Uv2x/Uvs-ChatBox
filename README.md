# Uv's Chat Box

A cross-platform (Windows-first) desktop app that drives the **VRChat chatbox**
over OSC — a from-scratch, MagicChatbox-style clone built with Electron +
TypeScript + React.

It can send manual messages and continuously stream **now playing**, **clock**,
**CPU/GPU/RAM**, and **network** info into your in-game chatbox.

**⬇ [Download the latest version](https://github.com/Uv2x/Uvs-ChatBox/releases/latest)** · **💬 Contact:** Discord `Uv2x`

---

## Features

- **10 built-in themes** (Midnight Bloom, Charcoal, Synthwave Sunset, Cyber Lime,
  Deep Ocean, Ember Forge, Sakura Dusk, Matrix Terminal, Royal Gold, Arctic Light)
  plus a **custom photo/GIF background** with opacity + blur controls — all in the
  **Theme** tab.
- **Manual messages** with live character counter (VRChat's 144-char limit) and
  typing indicator (`/chatbox/typing`).
- **Lobby Avatar HUD** — an "ACTIVE OSC / Broadcasting via IP : … on target port …"
  banner that lights up while broadcasting.
- **Live OSC Telemetry — Network Flow** — real-time sparkline of broadcast
  frequency plus throughput readouts (msgs/sec and KB/sec, in and out, with
  cumulative totals).
- **Mute / Deaf Alert System** — listens to inbound `/avatar/parameters/MuteSelf`
  and `/avatar/parameters/Earmuffs` (a.k.a. Deafen) and dynamically prefixes /
  notifies your audio status. Live mic/mute/deaf pill in the header.
- **SteamVR Battery Monitor** — reads exact HMD / controller / tracker battery
  via the OpenVR API (optional binding; see below).
- **Smart AFK Detector** — global mouse + keyboard idle detection
  (Win32 `GetLastInputInfo`); auto-sets an AFK status after your threshold.
- **VRChat Local Instance Radar** — tails `output_log_*.txt` to announce player
  join / leave, world entry, and instance changes.
- **Timezone Converter for Friends** — cycles your local time alongside regions
  (US / EU / JP / any IANA zone) so your group sees your time.
- **Send target** — route to **Desktop**, **VR**, or **Both**.
- **Live modules**, each with an editable `{token}` template and reorder controls:
  Now Playing, Clock, CPU, GPU, RAM, Network, Custom text, plus all of the above.
- **Configurable endpoint** (send + listen ports), send-immediately toggle,
  notification-sound toggle, and adjustable update interval. Settings persist.

---

## Prerequisites

- **Node.js 18+** (LTS recommended) — <https://nodejs.org>
- Windows 10/11 for the media module (now-playing uses the Windows
  GlobalSystemMediaTransportControls API via a bundled PowerShell bridge — no
  native compilation required). Other modules work cross-platform.
- **VRChat with OSC enabled**: in VRChat open the Action/Quick Menu →
  Options → OSC → **Enable**. VRChat listens on UDP **9000** by default.

---

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Run in development (hot-reloading renderer + watched main process)
npm run dev
# in a second terminal, once the renderer dev server is up:
npx electron .

# …or simply build + launch in one shot:
npm start
```

`npm start` builds the main process (TypeScript → `dist/main`) and the renderer
(Vite → `dist/renderer`), then launches Electron.

---

## Building a Windows .exe

```bash
# Produces an NSIS installer in ./release
npm run package

# Or an unpacked folder build (no installer), handy for quick testing:
npm run package:dir
```

The installer is emitted to `release/` (e.g. `OSC Chatbox Setup 1.0.0.exe`).
electron-builder is configured for `--win --x64` in `package.json` under the
`build` key; adjust `target`/`arch` there if needed.

> **Icon:** a `build/icon.ico` generated from the app artwork is already included,
> so the packaged `.exe` uses it automatically. Replace it to customize.

After packaging completes, a SHA-256 checksum for the installer is printed to
the console and written next to it as `<installer>.sha256.txt`. Share that hash
with your downloaders so they can verify the file is intact:

```powershell
# Windows
Get-FileHash "Uv's Chat Box Setup 1.0.0.exe" -Algorithm SHA256
```

---

## Why does Windows warn me when I run the installer?

If you (or a friend) download the installer and Windows shows:

- **In Chrome / Edge:** *"Uv's Chat Box Setup 1.0.0.exe isn't commonly downloaded. Make sure you trust it before you open it."*
- **After running it:** a blue *"Windows protected your PC"* dialog from SmartScreen.

That is **normal for indie / unsigned apps** — it does **not** mean the file is malware.
Microsoft SmartScreen flags every Windows installer that:

1. Isn't signed with a commercial code-signing certificate, **and**
2. Hasn't been downloaded enough times to build up "reputation."

This app is currently unsigned (commercial EV code-signing certificates cost
$250+/yr), so it trips both conditions until enough people install it.

### How to install anyway (safe path)

1. In the browser download bar → click **⋯** (or *Keep*) → **Keep anyway**.
2. Double-click the installer. When the blue *Windows protected your PC* dialog
   appears → click **More info** → **Run anyway**.
3. *(Optional — verify integrity first)* Open PowerShell in the folder where you
   downloaded the file and run:
   ```powershell
   Get-FileHash "Uv's Chat Box Setup 1.0.0.exe" -Algorithm SHA256
   ```
   Compare the output to the SHA-256 published on the release page. If they
   match, the file is bit-for-bit the one I built.

The warning will quietly disappear over time as more people install the same
build, or sooner if/when the project moves to a signed installer.

---

## How it talks to VRChat

VRChat exposes these OSC addresses (UDP, default port 9000):

| Address           | Args                                   | Purpose                          |
|-------------------|----------------------------------------|----------------------------------|
| `/chatbox/input`  | `string`, `bool send`, `bool sound`    | Set chatbox text                 |
| `/chatbox/typing` | `bool`                                 | Show/hide the typing indicator   |



### Inbound OSC (for Mute/Deaf alerts)

VRChat can also *send* avatar parameters out via OSC. This app listens on a
separate **listen port** (default **9001**) for:

| Address                            | Arg    | Meaning                 |
|------------------------------------|--------|-------------------------|
| `/avatar/parameters/MuteSelf`      | `bool` | Microphone muted        |
| `/avatar/parameters/Earmuffs`      | `bool` | Deafened (name varies)  |

The exact deafen parameter name depends on your avatar; adjust matching in
`src/main/osc.ts` if yours differs.

### Optional: SteamVR battery readings

Real battery levels require an OpenVR binding. The app loads one at runtime if
present and otherwise reports "no devices" gracefully. To enable:

```bash
npm install openvr-nodejs   # or another OpenVR Node binding
```

Then verify the method names in `src/main/battery.ts` (`readWithBinding`) match
your chosen package — they're written defensively but binding APIs vary.

- When **send immediately** is on, text appears instantly. When off, it opens
  the in-game keyboard pre-filled instead.
- Messages are clamped to **144 characters** (counted by Unicode code points).

---

## Project structure

```
osc-chatbox/
├─ package.json            # deps + build/package scripts (electron-builder cfg)
├─ tsconfig.main.json      # TS config for the Electron main process
├─ tsconfig.renderer.json  # TS config for the React renderer
├─ vite.config.ts          # Vite build for the renderer
├─ build/                  # packaging resources (put icon.ico here)
└─ src/
   ├─ shared/
   │  └─ types.ts          # shared types + IPC channel names
   ├─ main/                # Electron main process
   │  ├─ main.ts           # window, IPC wiring, live update loop
   │  ├─ preload.ts        # contextBridge API exposed to the renderer
   │  ├─ osc.ts            # node-osc client (chatbox/typing/clear)
   │  ├─ stats.ts          # CPU/GPU/RAM/network via systeminformation
   │  ├─ media.ts          # Windows now-playing via GSMTC PowerShell bridge
   │  ├─ settings.ts       # persistent settings store
   │  └─ formatter.ts      # assembles enabled modules into the chatbox line
   └─ renderer/            # React UI
      ├─ index.html
      ├─ main.tsx
      ├─ App.tsx           # all UI + state
      ├─ widgets.tsx       # HUD, telemetry, battery, audio, status widgets
      ├─ themes.ts         # the 10 theme palettes
      ├─ appearance.tsx    # theme apply hook + theme/background pickers
      ├─ assets/logo.png   # app logo (your artwork, circular-cropped)
      ├─ assets.d.ts       # image import typings
      ├─ constants.ts
      ├─ styles.css        # synthwave-terminal theme
      └─ global.d.ts       # window.chatbox typing
```

---

## Customizing module output

Each enabled module has a template string. Available tokens:

| Module   | Tokens                                |
|----------|---------------------------------------|
| Custom   | `{custom}`                            |
| Media    | `{title}` `{artist}` `{album}` `{status}` |
| Clock    | `{time}`                              |
| CPU      | `{cpuLoad}` `{cpuTemp}`               |
| GPU      | `{gpuLoad}` `{gpuTemp}`               |
| RAM      | `{ramUsed}` `{ramTotal}`             |
| Network  | `{netDown}` `{netUp}`                |
| Mute/Deaf| `{status}`                            |
| Battery  | `{devices}`                           |
| AFK      | `{status}` `{idle}` (minutes)         |
| Timezone | `{label}` `{time}`                    |
| Instance | `{event}` `{type}` `{detail}`         |

Example media template: `🎵 {title} — {artist} {status}`

---

## Themes & custom background

Open the **Theme** tab (right-hand panel) to:

- Pick any of the **10 themes** — each instantly recolors the whole UI via CSS
  variables. The default is **Charcoal (Uv)**, a moody monochrome to match the
  app's artwork.
- **Upload a photo or GIF** as a background (PNG/JPEG/WebP/GIF, up to 8 MB). It's
  stored with your settings and re-applied on launch. Use the **opacity** and
  **blur** sliders to keep the interface readable over busy images.

To add your own theme, append an entry to `src/renderer/themes.ts` — copy an
existing object and change the palette; it shows up in the picker automatically.

## Notes & troubleshooting

- **Nothing shows in VRChat:** confirm OSC is enabled in-game, the IP/port match
  (`127.0.0.1:9000`), and try the **Test** button. If you've changed avatars,
  VRChat sometimes needs an OSC config reset (Options → OSC → Reset).
- **No "now playing":** the media module is Windows-only. Make sure something is
  actually playing through a Windows media session (Spotify desktop, Edge/Chrome,
  Groove, etc.). It silently no-ops elsewhere.
- **GPU temp/load missing:** availability depends on GPU vendor/driver; the field
  is simply omitted when the OS doesn't report it.
- **Cross-platform later:** the OSC core, stats, clock, and custom modules already
  run on macOS/Linux. To add their native "now playing," implement a MediaRemote
  (macOS) or MPRIS/D-Bus (Linux) branch in `src/main/media.ts`.



## Automation suite (Builder, Control & Settings tabs)

Beyond the live chatbox modules, Uv's Chat Box includes a full OSC automation suite:

- **Control tab** — live status switcher, smart-sorted quick phrases (favorites → most-used → recent), one-tap macro/timeline runners, profile switcher, variable editor, live OSC parameter monitor, connection health, and action history with undo.
- **Build tab** — visual editors for everything:
  - *Profiles*: PC / Quest / custom, each with its own IP, send/listen ports, and default status.
  - *Quick phrases*: folders, favorites, per-phrase global hotkeys, custom cooldowns, and multi-action chains.
  - *Macros*: ordered action sequences with delay steps, reordering, and a Test button.
  - *Timelines*: simulated text animation (e.g. "Hello" → "Hello." → "Hello..") with per-frame hold times and looping.
- **Settings tab** — launch mode (Desktop / SteamVR layout), visual modes (Compact, Streamer, OLED, Acrylic blur, Minimal UI), anti-spam (global rate limit, cooldowns, dedupe), refresh loop interval, auto-AFK responder, and a master enable/disable for every feature.

### Actions
Every phrase/macro step is one of: send text, set status, set avatar parameter, clear chatbox, set variable, switch profile, run macro, run timeline, or delay. Text supports `{variable}` substitution (e.g. `Hello {name}`).

### Global hotkeys
Phrases, macros, and profile switches can each bind a global hotkey (Ctrl/Alt/Shift + key) that works while VRChat is focused. Note: in exclusive-fullscreen, Windows may route some keys to the game first — borderless/windowed avoids this.

### Safety
All sends pass through a rate limiter, per-action cooldowns, and duplicate-suppression so you can't accidentally flood the chatbox. The optional refresh loop re-sends your current line every ~11s (through the same throttle) to survive VRChat OSC resets.



## Auto-responder, validation & updates (Phase 4)

- **Auto-AFK responder** (Settings tab): after X minutes of global input inactivity — or on mute, if enabled — it sends your AFK message once, then clears it when you return. Edge-triggered so it never spams; all sends still pass through the safety throttle.
- **Live length validation**: phrase/macro text actions and timeline frames show a live `n/144` counter that turns red past VRChat's limit, so you catch overflow before sending.
- **Auto-updates** from [GitHub Releases](https://github.com/Uv2x/Uvs-ChatBox/releases): checks in the background, then a banner offers **Download → Restart to update**. Settings → Updates and 🩺 System Check show the same state. Powered by `electron-updater`.

### Shipping an update
See **[RELEASING.md](RELEASING.md)**: bump the version, `npm run package`, and upload the three files from `release/` to a new GitHub release.

In development the updater is intentionally disabled (it reports "Updates are disabled in dev builds").

## Contact

Questions, bugs or ideas? Message me on **Discord: `Uv2x`**, or open an
[issue](https://github.com/Uv2x/Uvs-ChatBox/issues).

## License

MIT

---

## Automation Suite (v2)

Uv's Chat Box is a full VRChat OSC automation tool. All features are modular and
toggleable in **Settings → Features**.

### Control tab
Status switcher (Available / AFK / Busy / Talking / Gaming / Streaming), quick-
phrase buttons with smart sorting (favorites → most-used → recent), one-tap macro
and timeline runners, profile switcher, runtime variable editor, a live OSC
parameter monitor, connection-health indicator, and a 50-entry history log with
undo.

### Build tab — editors
- **Profiles**: PC / Quest / custom device setups, each with its own OSC endpoint,
  default status, and switch hotkey. Switching a profile swaps everything at once.
- **Quick Phrases**: label, folder, favorite, per-phrase global hotkey, and a
  multi-action body (a phrase can send text *and* set a status *and* fire a
  parameter).
- **Macros**: chain any actions with `delay` steps; reorder freely. Example
  "Streamer Mode": set status → send "Now live" → delay → set variable.
- **Timelines**: simulated text animation via timed frame swaps
  ("Hello" → "Hello." → "Hello..") — Unicode-safe, optional loop. VRChat has no
  real animation, so this is text-only by design.

### Action system
Every button/phrase/hotkey/macro step produces one of these actions, all routed
through a single safety-checked dispatcher: `sendText`, `setStatus`,
`setParameter` (avatar params/emotes), `clearChatbox`, `setVariable`,
`switchProfile`, `runMacro`, `runTimeline`, `delay`.

### Variables (spec §4)
Use `{name}`-style tokens in any text: `Hello {name}`, `I am {status}`.
`{status}` and `{time}` are built in; define your own in the Control tab.

### Safety & anti-spam
Global rate limiter (msgs/sec), per-action cooldowns, and duplicate-send
debounce. All sends — including the refresh loop and auto-responder — pass
through this guard. Tunable in Settings.

### Refresh loop
Re-sends the current chatbox state every 8–30 s (configurable) so your text
survives VRChat OSC resets. Respects the safety guard.

### Connection system
Live in/out parameter monitor, health indicator, automatic reconnect when VRChat
drops/resets OSC, separate send + listen ports, and a Test button.

### Global hotkeys
Per-phrase, per-macro, and per-profile accelerators via Electron `globalShortcut`
(work outside the app). Supports Ctrl/Alt/Shift modifiers. Capture them in the
Build tab. Note: in exclusive-fullscreen VRChat some keys may be captured by the
game — borderless/windowed avoids this.

### Auto AFK responder
Sends a predefined message after N minutes of inactivity (optionally also when
muted), and resets automatically when you return.

### Display & launch modes
Desktop and SteamVR (overlay-friendly, always-on-top, large targets) launch
modes, plus Compact, Streamer, OLED (pure black), Acrylic blur, and Minimal-UI
display modes. 10 color themes + custom image/GIF background.

### Updater
Auto-updates from GitHub Releases (electron-updater) — see
[RELEASING.md](RELEASING.md).

> **VRChat limitations respected:** no real animations, no rich media — text-only
> chatbox output, designed for reliability and speed during gameplay.
