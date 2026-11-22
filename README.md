# Uv's Chat Box

A Windows desktop app that runs your **VRChat chatbox** over OSC: what you're
listening to, the time, your status, your headset and tracker batteries, and
anything you type — kept fresh while you play.

**⬇ [Download the latest version](https://github.com/Uv2x/Uvs-ChatBox/releases/latest)** · **💬 Contact:** Discord `Uv2x`

---

## Features

**Chatbox**
- Type and send messages with a live preview and a 144-character counter
  (counted the way VRChat does, so an emoji uses 2).
- 27 ready-made statuses with emoji, pinned lines that rotate, Keep alive, and
  scheduled statuses (e.g. "Sleeping" at 23:00).

**Live lines** — each one can be turned on, reordered and reworded
- **Now Playing** from any Windows music app, with a progress bar and live
  synced lyrics (LRCLib).
- Clock and timezones (with day/night icons), weather, session timer, custom
  text.
- PC components (CPU / GPU / RAM / VRAM) and network speed.
- **Battery** of your headset, controllers and trackers from SteamVR (Quest
  over Link, Index, Vive, SlimeVR…), named by body position.
- Mute / deafen alerts and **Smart AFK**: VRChat's own AFK flag, your headset
  being worn and keyboard/mouse idle combined, with an optional AFK reply.

**Extras**
- Speech-to-text (Windows, or offline Whisper) and voice commands.
- ChatBox Clips: lines that show only when a condition is true.
- AI personality presets, and an optional ✨ line generator using your own
  Anthropic API key (stored only on your PC).
- SteamVR overlay (dashboard or wrist), in-headset notifications, and
  auto-start when VRChat launches.
- Discord Rich Presence, 13 themes plus a theme editor and custom backgrounds.

**Looking after itself**
- 🩺 **System Check** shows every outside service with a plain-English fix.
- **Auto-updates** from GitHub Releases: a banner offers Download → Restart.
- Settings backup, export and import.

A companion iPhone app for standalone headsets lives in [`mobile/`](mobile/).

## Install

1. Download `Uvs-Chat-Box-Setup-<version>.exe` from the
   [latest release](https://github.com/Uv2x/Uvs-ChatBox/releases/latest).
2. Run it. Updates after that arrive inside the app.
3. In VRChat, turn on OSC: **Action Menu → Options → OSC → Enabled**.

### "Windows protected your PC"?

That's normal for apps without a paid code-signing certificate; it doesn't
mean the file is unsafe. Click **More info → Run anyway**. To check the file
is exactly the one published, compare its hash with the SHA-256 on the
release page:

```powershell
Get-FileHash "Uvs-Chat-Box-Setup-1.1.1.exe" -Algorithm SHA256
```

## How it talks to VRChat

| Direction | Port | Used for |
| --- | --- | --- |
| App → VRChat | 9000 | `/chatbox/input` (text) and `/chatbox/typing` |
| VRChat → App | 9001 | avatar parameters: `MuteSelf`, `Earmuffs`, `AFK`, `VRMode` |

For a standalone Quest, set the IP on the **Connection** tab to the headset's
Wi-Fi IP. Only one app can receive VRChat's messages on port 9001 — System
Check tells you if another one (e.g. VRCOSC) is using it.

## Development

Requires Node.js 20+ on Windows.

```bash
npm install
npm run dev          # app with hot reload
npm run typecheck
npm run lint
npm test             # unit tests (builds first)
npm run package      # installer in release/
npm run stats        # release download counts
```

Shipping a new version: see **[RELEASING.md](RELEASING.md)**.

### Project layout

| Folder | What's there |
| --- | --- |
| `src/main/` | Electron main process: OSC (`osc.ts`), chatbox composer (`formatter.ts`), actions (`engine.ts`), settings, and the services (media, lyrics, weather, battery, AFK, SteamVR, Discord, updates…) |
| `src/renderer/` | The React UI |
| `src/shared/` | Types and IPC channels shared by both |
| `native/` | C# harness for the SteamVR overlay (uses Valve's `openvr_api.cs`) |
| `tests/` | Unit tests (Node's built-in test runner) |
| `mobile/` | iPhone companion app |

## License

MIT. `native/openvr_api.cs` is Valve's OpenVR binding under the BSD 3-Clause
license (see `native/LICENSE-openvr.txt`).
