# Uv's Chat Box — iOS companion

A lightweight iPhone app that controls the **VRChat chatbox** on a **standalone
headset** (Pico / Quest) over WiFi — no PC required. It sends chatbox text via
OSC/UDP straight to the headset on your local network.

It is intentionally a "lite" app: **statuses, messages, saved messages, and a
keep-alive pin.** The PC-only features of the desktop app (now-playing, PC
stats, SteamVR overlay/battery/notifications, Whisper, Discord) do not apply on
a standalone setup and are not included.

> **Reality check first.** Before building, confirm the headset actually
> receives OSC: in VRChat on the headset, enable **Settings → OSC → Enabled**,
> then from any OSC app on the same WiFi send `/chatbox/input` to the headset's
> IP on port **9000**. If the bubble appears above the avatar, this app will
> work. If not, it's a VRChat-side limitation nothing on the phone can fix.

---

## Build & install (requires a Mac + Xcode)

Apple only lets you compile/sign/install iOS apps from macOS. Do the `cap add
ios` and Xcode steps on the Mac; the rest is plain Node.

```bash
cd mobile
npm install
npm run build          # builds the web bundle into dist/
npx cap add ios        # generates the ios/ Xcode project (macOS + CocoaPods)
```

**Add the native UDP plugin** (one time): in Xcode, drag
`mobile/native/OscUdpPlugin.swift` into the **App ▸ App** group
(*Copy items if needed*, target = **App**). Capacitor 6 auto-discovers it.

**Add the local-network permission** (REQUIRED — iOS blocks LAN access
without it). In `ios/App/App/Info.plist` add:

```xml
<key>NSLocalNetworkUsageDescription</key>
<string>Uv's Chat Box sends your VRChat chatbox to your headset on this WiFi network.</string>
```

**Register the URL scheme** (only needed for the Spotify login — the app has to
be re-opened via `uvschatbox://` after you authorize). In the same `Info.plist`:

```xml
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLName</key>
    <string>com.uvschatbox.mobile</string>
    <key>CFBundleURLSchemes</key>
    <array><string>uvschatbox</string></array>
  </dict>
</array>
```

Then:

```bash
npm run build && npx cap sync ios
npx cap open ios       # opens Xcode
```

In Xcode:
1. Select the **App** target → **Signing & Capabilities** → pick your **Team**
   (a free Apple ID works).
2. Plug in the iPhone, select it as the run destination, press **Run** (▶).
3. On the iPhone: **Settings → General → VPN & Device Management** → trust your
   developer certificate.
4. First send will prompt **"allow local network access"** → Allow.

> Free Apple ID signing expires after **7 days** (re-run from Xcode to
> reinstall). A paid Apple Developer account ($99/yr) + **TestFlight** gives a
> permanent install with no weekly re-signing.

After a code change: `npm run build && npx cap sync ios`, then Run again.

---

## Using it

1. Phone and headset on the **same WiFi**.
2. VRChat OSC enabled on the headset.
3. Enter the **headset's IP** (the VRChat OSC menu shows it, or check your
   router) and port **9000**.
4. Tap **Test** — a `👋 connected` bubble should appear in-headset.
5. Tap a status to send it; type a message and **Send**; **double-tap** a
   status (or **Pin**) to keep it shown (resends every 8s while the app is
   open); **★ Save** stores a message for reuse.

## Spotify now-playing (optional)

iOS won't let any app read what Spotify is playing system-wide, so this asks
Spotify's Web API instead — it works even while Spotify plays on the headset.

1. Go to **developer.spotify.com/dashboard → Create app**. Any name.
2. Add the **Redirect URI** exactly: `uvschatbox://spotify-callback`.
   (Also tick the **Web API** use-case.)
3. Copy the **Client ID** into the app's Spotify card and tap **Connect** — a
   Spotify login opens, and after you authorize it returns to the app.
4. Flip on **Send now-playing** and it appends `🎵 title — artist` to the
   chatbox (refreshes ~every 12s while the app is open).

> **Spotify Premium is required** — as of 2026 Spotify only lets "development
> mode" apps call the API on a Premium account (otherwise the app must be
> submitted to Spotify for extended-quota approval). Login is read-only
> (`user-read-currently-playing`), PKCE, no client secret stored.

## What's where

- `src/osc.ts` — OSC message encoding + the `OscUdp` native bridge (send-only).
- `src/spotify.ts` — Spotify Web API now-playing (OAuth PKCE, token refresh).
- `src/App.tsx` — the UI (connection, statuses, composer, saved, pin, Spotify).
- `src/statuses.ts` — the built-in status presets.
- `native/OscUdpPlugin.swift` — the iOS UDP sender (add to the Xcode App target).
