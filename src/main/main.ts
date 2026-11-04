import {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  session,
  shell,
  Tray,
  Menu,
  nativeImage,
  dialog,
  type IpcMainInvokeEvent,
} from 'electron';
import path from 'path';
import { promises as fsp, readFileSync } from 'fs';
import { execFile } from 'child_process';
import log from 'electron-log';
import type { ZodSchema } from 'zod';
import type { AppUpdater, ProgressInfo, UpdateInfo } from 'electron-updater';
import { OscManager } from './osc';
import { StatsCollector } from './stats';
import { BatteryCollector } from './battery';
import { MediaCollector } from './media';
import { AfkDetector } from './afk';
import { SettingsStore } from './settings';
import { formatChatbox, formatSingleModule, pickClip } from './formatter';
import { SafetyGuard } from './safety';
import { ActionEngine } from './engine';
import { AutoResponder } from './autoresponder';
import { StatusRelay, resolveRelayConfig } from './relay';
import { SpeechRecognizer } from './stt';
import { LyricsService } from './lyrics';
import { VRActivityProbe } from './vrActivity';
import { VrchatLog } from './vrchatLog';
import { VrchatProcessWatcher } from './vrchatWatch';
import { VRNotifier } from './vrNotify';
import { OverlayService, type OverlayButton } from './overlay';
import { DiscordPresence } from './discord';
import { runSystemCheck } from './health';
import { AiClient } from './ai';
import { WeatherProvider } from './weather';
import { VoiceCommandMatcher } from './voiceCommands';
import { WhisperRecognizer } from './whisperStt';
import { WhisperDownloader } from './whisperDownloader';
import { toRomaji, hasKana } from './romaji';
import { IPC, PILL_METHODS, type PillMethod } from '../shared/types';
import type {
  AppSettings,
  AudioStatus,
  AfkState,
  Action,
  AppState,
  ConnStatus,
  UpdateStatus,
  RelayConfig,
} from '../shared/types';
import {
  AppSettingsSchema,
  ActionSchema,
  ActionArraySchema,
  MessageTextSchema,
  TypingSchema,
  IdSchema,
  RelayConfigSchema,
} from '../shared/ipcSchemas';

// ---- Logging (item §9) ---------------------------------------------------
log.transports.file.level = 'info';
log.transports.console.level = 'debug';
log.info("[startup] booting Uv's Chat Box", {
  version: app.getVersion(),
  node: process.versions.node,
  electron: process.versions.electron,
});

process.on('unhandledRejection', (reason) => {
  log.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  log.error('[uncaughtException]', err);
});

const osc = new OscManager();
const sysStats = new StatsCollector();
const batterySvc = new BatteryCollector(() => store.get().questAdbPath);
const media = new MediaCollector();
const afkDet = new AfkDetector();
// VRCOSC-ported services (Phase 1 of the VRCOSC feature port).
const weatherSvc = new WeatherProvider();
// Voice command matcher: dispatches to `engine.runActions` so all the
// safety/cooldown/rate-limit checks apply equally to STT-driven actions.
let voiceMatcher: VoiceCommandMatcher | null = null;
// Whisper recognizer + model downloader (alternative STT engine).
const whisperRec = new WhisperRecognizer();
const whisperDl = new WhisperDownloader();
// Live-lyrics fetcher (LRCLib). Lives in main so its in-memory cache
// persists across live-loop ticks; an enabled `liveLyrics` setting causes
// gatherAndSend() to consult it and append the active line to the media row.
const lyricsService = new LyricsService();
// SteamVR HMD activity probe — shared across IPC + autoresponder + presence
// so we don't run multiple PowerShell spawns. Each consumer calls poll(),
// which throttles automatically and returns the cached reading.
const vrActivity = new VRActivityProbe();
// VRChat output-log tailer. Started on app whenReady when
// settings.vrchatLog.enabled is true; stopped + restarted on settings save.
const vrchatLog = new VrchatLog();
// VRChat.exe process watcher — powers "auto-start with VRChat" and the
// Session Timer module. Polling runs only while either feature is enabled
// (see reconfigureVrchatWatch); events are wired once in whenReady.
const vrchatWatch = new VrchatProcessWatcher();
// True only when the WATCHER started the live loop. A manual Start is never
// auto-stopped when VRChat exits — this flag keeps the two apart.
let liveAutoStartedByVrchat = false;
// SteamVR in-headset toast notifier (PCVR only).
const vrNotifier = new VRNotifier();
// SteamVR dashboard control overlay. `native/` holds the C# sources — in a
// packaged build they're shipped via electron-builder extraResources.
const overlay = new OverlayService(() =>
  path.join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'native'),
);
// Whether a dictation (speech-to-text) session is currently running. Kept in
// sync by the start/stop helpers so the overlay's Dictate button reflects it.
let dictationOn = false;
// Discord Rich Presence via the local Discord client.
const discord = new DiscordPresence();
let discordTimer: NodeJS.Timeout | null = null;
// Last status id we toasted, so the status-change toast fires once per change.
let lastNotifiedStatusId: string | null = null;
// VR-battery devices we've already warned about (by name), re-armed when the
// device climbs back above the threshold — avoids spamming every tick.
const lowBatteryWarned = new Set<string>();
// Anthropic / Claude client. Reads its config (api key, model, persona,
// per-feature toggles) lazily via a getter so the user can change it in
// Settings without restarting the app.
const ai = new AiClient(() => {
  const s = store.get();
  return (
    s.ai ?? {
      enabled: false,
      apiKey: '',
      model: 'claude-opus-4-7',
      features: {
        generateLine: true,
        personaReply: true,
        cleanupStt: true,
        suggestPhrase: true,
        voiceCommand: true,
      },
      wakeWord: 'uvy',
      persona: 'Casual, friendly, a bit playful.',
    }
  );
});
// Secondary-row cycler index. Incremented once per `secondaryCycle.intervalSec`
// in the live loop; combined with moduleIds.length to pick which module to
// render below the main row.
let secondaryCycleIndex = 0;
let secondaryCycleLastAdvance = 0;
// Pinned-status rotation. When more than one item is pinned (statuses,
// phrases, manual), they ROTATE one at a time instead of stacking as
// separate chatbox lines. This index advances on its own clock and wraps
// around the pinned list.
let pinRotateIndex = 0;
let pinRotateLastAdvance = 0;

/** Returns the chatbox lines to show for the currently-pinned items.
 *  - Rotation ON (default) + 2+ pins → returns just ONE pin, advancing on
 *    the pinRotateSec clock so they cycle round-robin (no stacking).
 *  - Rotation OFF, or ≤1 pin → returns all pins (legacy stacked behavior).
 *  Shared by the main live loop and the lyric fast-path so they agree. */
function getPinnedTexts(settings: AppSettings): string[] {
  if (settings.pinSentMessages === false) return [];
  const items = engine?.getState().pinnedItems ?? [];
  if (items.length === 0) return [];

  const rotate = settings.pinRotate !== false; // default ON
  if (!rotate || items.length === 1) {
    return items.map((p) => p.text);
  }

  // Advance the rotation index on its own interval.
  const intervalMs = Math.max(2, settings.pinRotateSec ?? 5) * 1000;
  const now = Date.now();
  if (now - pinRotateLastAdvance >= intervalMs) {
    if (settings.pinShuffle && items.length > 1) {
      // Random pick that avoids repeating the immediately-previous item, so
      // shuffle never shows the same pin twice in a row (which would look
      // like rotation broke).
      let next = pinRotateIndex;
      while (next === pinRotateIndex) {
        next = Math.floor(Math.random() * items.length);
      }
      pinRotateIndex = next;
    } else {
      pinRotateIndex = (pinRotateIndex + 1) % items.length;
    }
    pinRotateLastAdvance = now;
  }
  const pick = items[pinRotateIndex % items.length];
  return pick ? [pick.text] : [];
}
// Wall-clock anchor used to estimate the current playback position between
// Windows Media Session updates (which can be stale — see relay.ts).
let lyricsPositionBase = 0;
let lyricsPositionAt = 0;
let lyricsLastTrackKey = '';
// ---- Event-driven lyrics (Option B) ----
// The main live loop polls every updateIntervalSec (~3s), which makes synced
// lyric lines lag by up to that interval. The lyric fast-timer below checks
// the interpolated playback position every 500ms (cheap: cached track +
// math, NO media poll, NO LRCLib fetch beyond the in-memory cache) and only
// re-sends the chatbox when the current lyric LINE actually changes. That
// gives near-instant lyric sync without spamming OSC — sends happen on line
// change, which is naturally spaced a few seconds apart.
let lyricFastTimer: NodeJS.Timeout | null = null;
let lastSentLyricLine: string | null = null;
// Lyric-translation cache: original line -> translated line. Bounded so a
// long session doesn't grow unbounded; lyric lines repeat (choruses) so the
// hit rate is high. Avoids re-hitting the translate gateway every 500ms tick.
const lyricTranslateCache = new Map<string, string>();
// Edge-trigger guard for scheduled-status firing: remember the last "HH:MM"
// we acted on so the once-per-minute tick fires each entry exactly once.
let lastScheduledStatusMinute = '';
let scheduledStatusTimer: NodeJS.Timeout | null = null;
// Debounce timer for persisting engine runtime state (pinned statuses/messages)
// to settings.json on change, so the pin cycle survives a restart.
let stateSaveTimer: NodeJS.Timeout | null = null;
// Dedupe: track what gatherAndSend last pushed to OSC. If the live loop
// composes the same text on consecutive ticks (typical when nothing has
// changed), we skip the redundant /chatbox/input writes — VRChat would
// just redraw the same message and the user perceives it as the message
// being sent twice. We DO let one keep-alive through every ~15s so the
// chatbox doesn't fall victim to VRChat's ~20s auto-clear.
let lastChatboxSent = '';
let lastChatboxSentAt = 0;
const KEEP_ALIVE_MS = 15_000;
// Pill Lab: while a test message is on screen, the live loop holds off so it
// doesn't overwrite it before the user can look at it in-game.
let chatboxHoldUntil = 0;
const PILL_TEST_HOLD_MS = 12_000;
// Cached compose inputs so the fast path can recompose the chatbox without
// re-polling media / stats (those are expensive PowerShell spawns). Refreshed
// every main-loop tick by gatherAndSend.
let lastMedia: import('../shared/types').MediaInfo | null = null;
let lastStats: import('../shared/types').SystemStats | null = null;
const store = new SettingsStore();
const stt = new SpeechRecognizer();

// Phase 1 engine pieces (initialized in app.whenReady once settings load).
let safety: SafetyGuard;
let engine: ActionEngine;
let autoResponder: AutoResponder;
let relay: StatusRelay;
let refreshTimer: NodeJS.Timeout | null = null;
let conn: ConnStatus = { health: 'idle', lastOkAt: 0, monitor: [] };

let win: BrowserWindow | null = null;
let liveTimer: NodeJS.Timeout | null = null;
// True only when the user explicitly pressed "Start Live Updates" (modules).
// When false but the loop is running, it was auto-started just to rotate
// pinned items — so it auto-stops once the last pin is removed.
let explicitLive = false;
// Re-entrancy guard for gatherAndSend. Without it, a request-tick fired
// while a scheduled tick is mid-await (e.g. media.collect() spawning
// PowerShell) lets two composes race to OSC with different content — that's
// the "music status sends twice" bug. The guard serializes them and reruns
// once if a tick arrived while busy.
let gatherInFlight = false;
let gatherRerun = false;
let telemetryTimer: NodeJS.Timeout | null = null;
/** Scheduled-send-queue ticker. Polls settings.scheduled every 5s; when
 *  an entry's fireAt has elapsed it runs the engine sendText action and
 *  removes the entry. Persisted in settings so it survives restarts. */
let scheduleTimer: NodeJS.Timeout | null = null;

/** System tray icon. Created in whenReady. The tray lets the app run in the
 *  background after closing the main window — important for an app that
 *  needs to keep OSC and hotkeys alive for hours. */
let tray: Tray | null = null;
/** True when the user has explicitly asked to quit (via the tray menu or
 *  File→Quit). The window's 'close' handler checks this to decide between
 *  hide-to-tray vs actually-quit behavior. */
let isQuitting = false;

// Cached latest readings refreshed by the live loop / event sources.
let lastAudio: AudioStatus = { muted: false, deafened: false, changedAt: 0 };
let lastAfk: AfkState = { afk: false, idleSec: 0 };
let tzIndex = 0;
let tzTick = 0;

// Dev mode is signalled by VITE_DEV_SERVER_URL (set by `npm run dev`).
// We don't use `!app.isPackaged` because `electron .` after `npm run build`
// is also unpackaged, but at that point we want to load the built file, not
// hit a Vite server that isn't running (the cause of the blank dark window).
const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const isDev = !!devServerUrl;

function createWindow(): void {
  const s = store.get();
  win = new BrowserWindow({
    width: s.ui.compact ? 480 : 1040,
    height: s.ui.compact ? 640 : 780,
    minWidth: 380,
    minHeight: 520,
    backgroundColor: s.ui.oled ? '#000000' : '#0d0b14',
    title: "Uv's Chat Box",
    frame: true,
    transparent: false, // toggled via acrylic requires relaunch; see applyWindowModes
    alwaysOnTop: s.ui.launchMode === 'vr' || s.ui.compact,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // Security: isolate the preload's context from the page so the renderer
      // can't tamper with the bridge API or reach Electron internals.
      contextIsolation: true,
      // Security: no Node globals in the renderer; all privileged work happens
      // in the main process via the IPC bridge above.
      nodeIntegration: false,
      // Security: sandbox is currently disabled because our preload imports
      // relative paths (../shared/types) via `require`, which sandbox mode
      // forbids. To re-enable sandbox safely, the preload needs to be bundled
      // into a single self-contained file first (e.g. with esbuild or vite),
      // so there are no runtime relative requires.
      // contextIsolation + nodeIntegration:false still provide strong isolation.
      sandbox: false,
    },
  });

  if (isDev && devServerUrl) {
    win.loadURL(devServerUrl).catch((err) => {
      console.error('[main] Failed to load dev server URL:', err);
    });
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    const indexPath = path.join(__dirname, '../renderer/index.html');
    win.loadFile(indexPath).catch((err) => {
      console.error('[main] Failed to load renderer index.html at', indexPath, err);
    });
  }
  // Surface load failures (e.g. file:// path wrong) instead of a silent blank window.
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[main] did-fail-load (${code}) ${desc} url=${url}`);
  });
  // Close-to-tray: when the setting is on AND we're not in a full quit
  // flow, intercept the close event and hide the window instead. The OSC
  // pipeline, live loop, hotkeys, and tray icon all keep running. Right-
  // clicking the tray gives the user "Show" and "Quit" options.
  win.on('close', (e) => {
    if (isQuitting) return;
    const s = store.get();
    if (s.ui?.closeToTray !== false && tray) {
      e.preventDefault();
      win?.hide();
    }
  });
  win.on('closed', () => {
    win = null;
  });
}

/** Build the system-tray icon and its right-click menu. Idempotent. */
function ensureTray(): void {
  if (tray && !tray.isDestroyed()) return;
  // Try several candidate paths so the tray icon shows in both dev and
  // packaged builds. electron-builder copies `extraResources` to
  // `resources/` at install time — that's the production source. In dev,
  // the icon still lives in the repo's `build/` directory.
  //
  // We also try a PNG source first because Windows downsizes 256x256 ICO
  // entries poorly for the 16/24 px tray, leading to a blurry / blank
  // icon. A purpose-built PNG gives a sharper result.
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'icon.png'), path.join(process.resourcesPath, 'icon.ico')]
    : [
        path.join(__dirname, '..', '..', 'build', 'icon-source.png'),
        path.join(__dirname, '..', '..', 'build', 'icon.ico'),
      ];
  let img = nativeImage.createEmpty();
  for (const p of candidates) {
    const tryImg = nativeImage.createFromPath(p);
    if (!tryImg.isEmpty()) {
      img = tryImg;
      break;
    }
  }
  // Resize huge source images down to a tray-appropriate size. Windows
  // uses 16x16 logical (32x32 at 200% DPI); a 256x256 PNG would get
  // smushed by the shell into a blurry blob. Resizing here in nativeImage
  // gives much better filtering.
  if (!img.isEmpty()) {
    const size = img.getSize();
    if (size.width > 32 || size.height > 32) {
      img = img.resize({ width: 32, height: 32, quality: 'best' });
    }
  } else {
    log.warn('[tray] no icon file found in any candidate path:', candidates);
  }
  tray = new Tray(img);
  tray.setToolTip("Uv's Chat Box");
  rebuildTrayMenu();
  // Single-click on the icon shows / focuses the main window. Standard
  // Windows tray convention.
  tray.on('click', () => {
    if (!win || win.isDestroyed()) createWindow();
    else {
      win.show();
      win.focus();
    }
  });
}

/** Rebuild the tray context menu — call after relevant state changes (live
 *  on/off, etc.) so the menu reflects current state. */
function rebuildTrayMenu(): void {
  if (!tray || tray.isDestroyed()) return;
  const menu = Menu.buildFromTemplate([
    {
      label: "Show Uv's Chat Box",
      click: () => {
        if (!win || win.isDestroyed()) createWindow();
        else {
          win.show();
          win.focus();
        }
      },
    },
    { type: 'separator' },
    {
      // Big red panic button. When ON, the OSC layer drops every outgoing
      // chatbox packet regardless of subsystem — live loop, relay,
      // refresh, autoresponder, scheduled queue.
      label: osc.isPaused() ? '▶ Resume Sending' : '⏸ Stop Everything',
      click: async () => {
        const next = !osc.isPaused();
        osc.setPaused(next);
        if (next) {
          try {
            await osc.clear();
          } catch {
            /* ignore */
          }
        }
        win?.webContents.send(IPC.PAUSE_UPDATE, next);
        rebuildTrayMenu();
      },
    },
    {
      label: liveTimer ? 'Stop Live Updates' : 'Start Live Updates',
      click: () => {
        if (liveTimer) {
          explicitLive = false;
          stopLive();
        } else {
          // Explicit user start — keep the loop running even with no pins.
          startLive(store.get(), true);
        }
        rebuildTrayMenu();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
}

/** Apply runtime window modes that don't require a relaunch (spec §1/§9). */
function applyWindowModes(s: AppSettings): void {
  if (!win) return;
  // Always-on-top for VR/compact so the box floats over other windows.
  win.setAlwaysOnTop(s.ui.launchMode === 'vr' || s.ui.compact);
  // Compact resize (only shrink if currently larger).
  if (s.ui.compact) {
    const [w] = win.getSize();
    if (w !== undefined && w > 560) win.setSize(480, 640);
  }
}

/**
 * Honor desktop/vr/both routing.
 *
 * VRChat's chatbox OSC protocol doesn't distinguish desktop/VR receivers —
 * there's a single endpoint per VRChat instance. So this function returns
 * true whenever the user has chosen *any* valid target. It exists as the
 * single gate the live loop calls before sending, so we can extend routing
 * (e.g. cross-machine VR endpoints) without touching gatherAndSend.
 */
function shouldSend(settings: AppSettings): boolean {
  const t = settings.osc.target;
  return t === 'desktop' || t === 'vr' || t === 'both';
}

/** True when the OSC target is a REMOTE host (a standalone Quest on the LAN),
 *  not this PC. Used to disable PC-idle AFK detection, which is meaningless
 *  when the user is in a headset instead of at the desk. */
function isRemoteHost(ip: string): boolean {
  const h = (ip || '').trim().toLowerCase();
  return !(h === '' || h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '0.0.0.0');
}

/** ICMP ping the target host to prove the LAN path is open (Quest
 *  troubleshooting). Uses the system `ping` binary via execFile (no shell,
 *  no privileges). A real echo reply contains "TTL=" — we key off that
 *  rather than the exit code, since a router "unreachable" message can still
 *  exit 0 on Windows. Returns reachability + round-trip ms when available. */
function pingHost(ip: string): Promise<{ reachable: boolean; ms: number | null; raw: string }> {
  const isWin = process.platform === 'win32';
  const args = isWin ? ['-n', '2', '-w', '1000', ip] : ['-c', '2', '-W', '1', ip];
  return new Promise((resolve) => {
    execFile('ping', args, { windowsHide: true, timeout: 7000 }, (_err, stdout) => {
      const out = String(stdout || '');
      const reachable = /ttl[=<]/i.test(out);
      const m = out.match(/time[=<]\s*(\d+(?:\.\d+)?)\s*ms/i);
      const ms = reachable && m && m[1] != null ? Number(m[1]) : null;
      resolve({ reachable, ms, raw: out.slice(0, 600) });
    });
  });
}

/** Translate `text` to `targetLang` via the free Google gateway. Returns the
 *  translation, or null on any failure (caller falls back to the original).
 *  Shared by the manual-send auto-translate IPC and the lyric enrichment. */
async function translateText(text: string, targetLang: string): Promise<string | null> {
  const t = text.trim();
  if (!t) return null;
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(t)}`;
    const r = await fetch(url, { headers: { 'User-Agent': 'uvs-chatbox/1.0' } });
    if (!r.ok) return null;
    const j = (await r.json()) as unknown;
    const segs = Array.isArray((j as unknown[])?.[0]) ? (j as string[][][])[0] : null;
    if (!segs) return null;
    const out = segs
      .map((seg) => seg?.[0] ?? '')
      .join('')
      .trim();
    return out || null;
  } catch {
    return null;
  }
}

/** Enrich a raw lyric line with optional romaji + translation lines per the
 *  liveLyrics settings. Returns a possibly multi-line string. Romaji is
 *  synchronous; translation is cached so the 500ms lyric tick stays cheap. */
async function enrichLyric(line: string, settings: AppSettings): Promise<string> {
  const cfg = settings.liveLyrics;
  if (!cfg || (!cfg.romaji && !cfg.translate)) return line;
  const parts = [line];
  if (cfg.romaji && hasKana(line)) {
    const r = toRomaji(line);
    if (r && r !== line) parts.push(r);
  }
  if (cfg.translate) {
    const lang = cfg.translateLang || 'en';
    const cacheKey = `${lang}::${line}`;
    let tr = lyricTranslateCache.get(cacheKey);
    if (tr === undefined) {
      tr = (await translateText(line, lang)) ?? '';
      // Bound the cache.
      if (lyricTranslateCache.size > 300) lyricTranslateCache.clear();
      lyricTranslateCache.set(cacheKey, tr);
    }
    if (tr && tr.toLowerCase() !== line.toLowerCase()) parts.push(tr);
  }
  return parts.join('\n');
}

function moduleEnabled(settings: AppSettings, id: string): boolean {
  return settings.modules.some((m) => m.id === id && m.enabled);
}

/** The VRChat process watcher polls only while something needs it: the
 *  auto-start-with-VRChat feature or the Session Timer module. Called at
 *  boot and after every settings save/reset/import. */
function reconfigureVrchatWatch(settings: AppSettings): void {
  const needed = settings.autoStartWithVrchat === true || moduleEnabled(settings, 'session');
  if (needed) vrchatWatch.start();
  else vrchatWatch.stop();
}

// ---- SteamVR overlay control panel -------------------------------------

/** Start/stop dictation, keeping `dictationOn` + the overlay in sync. Shared
 *  by the STT IPC handlers and the overlay's Dictate button. */
function startDictation(): void {
  const s = store.get();
  if ((s.sttEngine ?? 'uwp') === 'whisper') {
    whisperRec.configure(
      s.whisper ?? { binPath: '', modelPath: '', modelChoice: 'tiny.en', language: 'auto' },
    );
    whisperRec.start();
  } else {
    stt.start();
  }
  dictationOn = true;
  pushOverlayState();
}
function stopDictation(): void {
  const s = store.get();
  if ((s.sttEngine ?? 'uwp') === 'whisper') whisperRec.stop();
  else stt.stop();
  dictationOn = false;
  pushOverlayState();
}

/** Build the overlay's button model from the current settings + engine state:
 *  a chosen set of statuses (active = currently pinned) plus Clear-pins and
 *  Dictate action buttons. Capped at 8 to fit the fixed 2x4 grid. */
function buildOverlayButtons(settings: AppSettings): OverlayButton[] {
  const pinned = new Set((engine?.getState().pinnedItems ?? []).map((p) => p.key));
  const ids =
    settings.vrOverlay?.statusIds && settings.vrOverlay.statusIds.length > 0
      ? settings.vrOverlay.statusIds
      : settings.statuses.slice(0, 6).map((s) => s.id);
  const btns: OverlayButton[] = [];
  for (const id of ids.slice(0, 6)) {
    const st = settings.statuses.find((s) => s.id === id);
    if (!st) continue;
    btns.push({
      id: `status:${id}`,
      label: `${st.icon ?? ''} ${st.label}`.trim(),
      active: pinned.has(`status:${id}`),
    });
  }
  btns.push({ id: 'action:clearPins', label: '🧹 Clear pins', active: false });
  btns.push({
    id: 'action:dictate',
    label: dictationOn ? '🛑 Stop dictate' : '🎤 Dictate',
    active: dictationOn,
  });
  return btns;
}

function pushOverlayState(): void {
  if (!overlay.isRunning()) return;
  overlay.setState("Uv's Chat Box", buildOverlayButtons(store.get()));
}

/** Build the overlay runtime config (meters) from settings (cm). */
function overlayConfigFrom(settings: AppSettings): import('./overlay').OverlayConfig {
  const o = settings.vrOverlay;
  return {
    mode: o?.mode === 'wrist' ? 'wrist' : 'dashboard',
    hand: o?.hand === 'right' ? 'right' : 'left',
    sizeM: Math.max(0.05, Math.min(1, (o?.sizeCm ?? 22) / 100)),
    tiltDeg: o?.tiltDeg ?? -50,
    up: (o?.upCm ?? 2) / 100,
    fwd: (o?.fwdCm ?? 6) / 100,
    right: (o?.rightCm ?? 0) / 100,
  };
}

// ---- Discord Rich Presence ---------------------------------------------

function sessionMinutesStr(startMs: number): string {
  const min = Math.max(0, Math.floor((Date.now() - startMs) / 60_000));
  const h = Math.floor(min / 60);
  return h > 0 ? `${h}h ${min % 60}m` : `${min}m`;
}

/** Fill {tokens} from current app state; unknown/empty tokens collapse out. */
function discordSubstitute(tpl: string, settings: AppSettings): string {
  const snap = settings.vrchatLog?.enabled ? vrchatLog.getSnapshot() : null;
  const st = settings.statuses.find((s) => s.id === engine?.getState().currentStatusId);
  const since = vrchatWatch.runningSince();
  const vals: Record<string, string> = {
    world: snap?.inWorld ? snap.world : '',
    instanceType: snap?.instanceType ?? '',
    players: snap?.inWorld ? String(snap.playerCount) : '',
    status: st ? `${st.icon ?? ''} ${st.label}`.trim() : '',
    title: lastMedia?.title ?? '',
    artist: lastMedia?.artist ?? '',
    session: since ? sessionMinutesStr(since) : '',
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  };
  return tpl
    .replace(/\{(\w+)\}/g, (_m, k: string) => vals[k] ?? '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function pushDiscord(settings: AppSettings): void {
  const d = settings.discord;
  if (!d?.enabled) return;
  const since = vrchatWatch.runningSince();
  discord.setActivity({
    details: discordSubstitute(d.details ?? '', settings),
    state: discordSubstitute(d.state ?? '', settings),
    startTimestampMs: d.showElapsed && since ? since : undefined,
    largeImageKey: d.largeImageKey || undefined,
    largeImageText: d.largeImageText || undefined,
  });
}

/** Apply Discord settings: connect/disconnect + run a slow refresh timer so
 *  world/status/session changes reach the presence without the live loop. */
function reconfigureDiscord(settings: AppSettings): void {
  const d = settings.discord;
  discord.reconfigure(d?.enabled === true, d?.clientId ?? '');
  if (discordTimer) {
    clearInterval(discordTimer);
    discordTimer = null;
  }
  if (d?.enabled) {
    pushDiscord(settings);
    discordTimer = setInterval(() => pushDiscord(store.get()), 15_000);
  }
}

/** Start / stop / reconfigure the overlay from settings. Mode changes need a
 *  process restart (dashboard vs regular overlays are created differently);
 *  wrist placement/size changes are pushed live without a restart. */
function reconfigureOverlay(settings: AppSettings): void {
  if (settings.vrOverlay?.enabled !== true) {
    overlay.stop();
    return;
  }
  const cfg = overlayConfigFrom(settings);
  if (!overlay.isRunning()) {
    void overlay.start(cfg);
  } else if (overlay.currentMode() !== cfg.mode) {
    overlay.stop();
    void overlay.start(cfg);
  } else {
    overlay.setConfig(cfg); // live tune (no restart)
  }
}

async function gatherAndSend(settings: AppSettings): Promise<void> {
  // Re-entrancy guard: if a compose+send is already running, mark that we
  // need one more pass and return. The in-flight call reruns once on
  // completion with the latest store state. Fixes overlapping double-sends.
  if (gatherInFlight) {
    gatherRerun = true;
    return;
  }
  gatherInFlight = true;
  try {
    await gatherAndSendInner(settings);
  } finally {
    gatherInFlight = false;
    if (gatherRerun) {
      gatherRerun = false;
      void gatherAndSend(store.get());
    }
  }
}

async function gatherAndSendInner(settings: AppSettings): Promise<void> {
  const needStats = ['pcComponents', 'network'].some((id) => moduleEnabled(settings, id));

  const [m, s, a] = await Promise.all([
    moduleEnabled(settings, 'media') ? media.collect() : Promise.resolve(null),
    needStats ? sysStats.collect() : Promise.resolve(null),
    moduleEnabled(settings, 'afk')
      ? afkDet.poll(settings.afk.thresholdSec)
      : Promise.resolve(lastAfk),
  ]);

  if (a) lastAfk = a;
  lastAudio = osc.getAudioStatus();
  // Cache compose inputs for the lyric fast-path (so it can recompose
  // without re-polling these expensive sources).
  lastMedia = m;
  lastStats = s;

  // Wall-clock-interpolated playback position. Maintained whenever music is
  // playing (not just when lyrics are on) because BOTH consumers need it:
  // the {bar}/{time} media tokens and the live-lyrics line picker. Many
  // media apps (Spotify) only refresh their reported position every few
  // seconds; the anchor advances it smoothly between polls.
  let mediaPosSec: number | null = null;
  if (m && m.playing && m.title) {
    const key = `${m.artist}::${m.title}`;
    const reportedPos = typeof m.position === 'number' ? m.position : 0;
    const now = Date.now();
    if (key !== lyricsLastTrackKey) {
      lyricsLastTrackKey = key;
      lyricsPositionBase = reportedPos;
      lyricsPositionAt = now;
    } else if (reportedPos > lyricsPositionBase + 0.5) {
      lyricsPositionBase = reportedPos;
      lyricsPositionAt = now;
    }
    let effectivePos = lyricsPositionBase + (now - lyricsPositionAt) / 1000;
    if (typeof m.duration === 'number' && m.duration > 0) {
      effectivePos = Math.min(effectivePos, m.duration);
    }
    mediaPosSec = effectivePos;
  }

  // Live lyrics: if the user has the Spotify panel's lyrics toggle on AND
  // music is *actively* playing, resolve the current synced lyric line and
  // pass it to the formatter. When paused/stopped we skip the fetch
  // entirely — both for accuracy (the line would be stale) and to avoid
  // hammering LRCLib while nothing is happening.
  let currentLyric: string | null = null;
  if (settings.liveLyrics?.enabled && m && m.playing && m.title && mediaPosSec != null) {
    try {
      const track = await lyricsService.fetch(
        m.artist || 'Unknown',
        m.title,
        typeof m.duration === 'number' ? m.duration : null,
      );
      if (track) {
        const raw =
          lyricsService.getCurrentLine(track, mediaPosSec) ?? track.synced[0]?.text ?? null;
        currentLyric = raw ? await enrichLyric(raw, settings) : null;
      }
    } catch (e) {
      log.warn('[lyrics] fetch failed in live loop:', e);
    }
  }
  // Keep the fast-path's "last sent line" in sync with what the main loop
  // is about to send, so the 500ms checker doesn't immediately re-fire for
  // the same line right after a main-loop tick.
  lastSentLyricLine = currentLyric;

  const vrchatSnap = settings.vrchatLog?.enabled ? vrchatLog.getSnapshot() : null;

  // VRCOSC-ported modules: only collect when their module is enabled, to
  // avoid spurious outbound API calls / process spawns. Battery is also
  // collected when VR low-battery toasts are on, even if the chatbox line
  // isn't shown.
  const wantWeather = moduleEnabled(settings, 'weather') && settings.weather?.enabled !== false;
  const vrLowBatt =
    settings.vrNotifications?.enabled === true && settings.vrNotifications.onLowBattery;
  const wantBattery = moduleEnabled(settings, 'battery') || vrLowBatt;
  const [weatherSnap, batterySnap] = await Promise.all([
    wantWeather
      ? weatherSvc.get(settings.weather?.query ?? '', settings.weather?.auto ?? false)
      : Promise.resolve(null),
    wantBattery ? batterySvc.collect() : Promise.resolve(null),
  ]);

  // VR low-battery toast: warn once per device when it drops below the
  // threshold (and isn't charging); re-arm when it climbs back above so a
  // device hovering at the line doesn't spam. PCVR devices only.
  if (vrLowBatt && batterySnap?.available) {
    const pct = settings.vrNotifications?.lowBatteryPct ?? 20;
    for (const d of batterySnap.devices) {
      if (d.percent <= pct && !d.charging) {
        if (!lowBatteryWarned.has(d.name)) {
          lowBatteryWarned.add(d.name);
          void vrNotifier.notify(`🔋 ${d.name} battery ${d.percent}%`, {
            holdMs: (settings.vrNotifications?.durationSec ?? 6) * 1000,
          });
        }
      } else if (d.percent > pct + 5 || d.charging) {
        lowBatteryWarned.delete(d.name); // re-arm past a hysteresis gap
      }
    }
  }

  // Pinned items: rotate one at a time (default) or stack — see
  // getPinnedTexts. Status/phrase toggles add/remove entries; this just
  // picks what to show this tick.
  const pinnedTexts = getPinnedTexts(settings);

  // VRCOSC-style ChatBox Clips: when enabled, the highest-priority eligible
  // clip wins the entire chatbox payload and module/pin rendering is skipped.
  const clipInput = {
    settings,
    media: m,
    stats: s,
    audio: lastAudio,
    battery: batterySnap,
    afk: lastAfk,
    tzIndex,
    currentLyric,
    mediaPosSec,
    vrchat: vrchatSnap,
    weather: weatherSnap,
    sessionStartAt: vrchatWatch.runningSince(),
    pinnedTexts,
  };
  const clipPick = settings.chatboxClips?.enabled ? pickClip(clipInput) : null;
  const mainText = clipPick ? clipPick.text : formatChatbox(clipInput);

  // Secondary-row cycler: rotate through chosen module ids and append the
  // result as a SECOND line in the chatbox payload. Advance the cycle
  // index on its own clock (intervalSec) so it can update faster than the
  // main loop's updateIntervalSec. Skip when disabled or empty.
  let text = mainText;
  const sc = settings.secondaryCycle;
  if (sc?.enabled && sc.moduleIds && sc.moduleIds.length > 0) {
    const intervalMs = Math.max(2, sc.intervalSec) * 1000;
    const now = Date.now();
    if (now - secondaryCycleLastAdvance >= intervalMs) {
      secondaryCycleIndex = (secondaryCycleIndex + 1) % sc.moduleIds.length;
      secondaryCycleLastAdvance = now;
    }
    const pick = sc.moduleIds[secondaryCycleIndex % sc.moduleIds.length];
    if (pick) {
      const secondary = formatSingleModule(
        {
          settings,
          media: m,
          stats: s,
          audio: lastAudio,
          battery: null,
          afk: lastAfk,
          tzIndex,
          currentLyric,
          mediaPosSec,
          vrchat: vrchatSnap,
        },
        pick,
      );
      if (secondary.trim()) text = `${mainText}\n${secondary}`;
    }
  }

  const livePayload = {
    media: m,
    stats: s,
    audio: lastAudio,
    battery: null,
    afk: lastAfk,
    instance: null,
    telemetry: osc.sampleTelemetry(),
    time: new Date().toISOString(),
    preview: text,
  };
  win?.webContents.send(IPC.LIVE_UPDATE, livePayload);

  // While the relay owns the chatbox, the live loop only updates the renderer
  // preview — it must NOT send, or it would race the relay's rotation.
  const relayOwnsChatbox = resolveRelayConfig(settings).enabled;
  if (
    !relayOwnsChatbox &&
    shouldSend(settings) &&
    text.trim().length > 0 &&
    Date.now() >= chatboxHoldUntil // a Pill Lab test is on screen
  ) {
    // Content dedupe: if we just sent this exact text and the keep-alive
    // window hasn't expired, skip the send. VRChat keeps the chatbox
    // visible for ~20s without writes, so re-sending more often than
    // every ~15s just makes the user see the same message "again".
    const same = text === lastChatboxSent;
    const recent = Date.now() - lastChatboxSentAt < KEEP_ALIVE_MS;
    if (!same || !recent) {
      // playSound=false from the live loop: the ding is for user-initiated
      // sends, not the keep-alive re-sends.
      await osc.sendChatbox(text, settings.osc.sendImmediately, false);
      lastChatboxSent = text;
      lastChatboxSentAt = Date.now();
    }
  }

  // Advance timezone cycle.
  if (moduleEnabled(settings, 'timezone') && settings.timezones.length > 0) {
    tzTick += Math.max(1, settings.updateIntervalSec);
    if (tzTick >= settings.timezoneCycleSec) {
      tzTick = 0;
      tzIndex = (tzIndex + 1) % settings.timezones.length;
    }
  }

  // Auto-stop: if the loop was started JUST to rotate pins (not an explicit
  // "Start Live Updates"), the last pin is gone, AND the modules composed
  // nothing to show, clear the chatbox and stop the loop so we don't spin
  // forever sending nothing. The `text` check matters: enabled modules
  // (music, timezones, custom text) keep the loop — and the in-game bubble —
  // alive after the last pin is removed. Historically Smart Presence
  // re-pinned a status every tick so pins were never empty and this path
  // never fired; once presence was removed, stopping here on pins alone
  // wiped the module lines too and the chatbox kept "disconnecting".
  if (
    !explicitLive &&
    (engine?.getState().pinnedItems?.length ?? 0) === 0 &&
    text.trim().length === 0
  ) {
    try {
      await osc.clear();
    } catch {
      /* ignore */
    }
    lastChatboxSent = '';
    lastChatboxSentAt = 0;
    stopLive();
  }
}

/**
 * Event-driven lyric line detector (Option B). Runs every 500ms while live
 * + liveLyrics are on. Computes the current synced lyric line from the
 * CACHED media snapshot + wall-clock-interpolated position + the in-memory
 * lyrics cache — no media poll, no network. When the line changes, it
 * recomposes the chatbox (reusing cached media/stats so it's cheap) and
 * sends immediately, so lyrics appear the instant the line flips instead of
 * lagging up to a full updateIntervalSec.
 *
 * Sends happen only on line CHANGE, and are paced to at most one every
 * `liveLyrics.intervalSec` (default 2s) so bursts of quick lines can't trip
 * VRChat's chatbox rate limit.
 */
async function lyricFastTick(settings: AppSettings): Promise<void> {
  if (!settings.liveLyrics?.enabled) return;
  // Relay owns the chatbox when enabled — don't fight it.
  if (resolveRelayConfig(settings).enabled) return;
  if (!shouldSend(settings)) return;
  if (Date.now() < chatboxHoldUntil) return; // a Pill Lab test is on screen
  const m = lastMedia;
  if (!m || !m.playing || !m.title) return;

  // Interpolate the current position from the wall-clock anchor that the
  // main loop maintains. This advances smoothly between the ~3s media polls.
  const now = Date.now();
  let effectivePos = lyricsPositionBase + (now - lyricsPositionAt) / 1000;
  if (typeof m.duration === 'number' && m.duration > 0) {
    effectivePos = Math.min(effectivePos, m.duration);
  }

  let track;
  try {
    track = await lyricsService.fetch(
      m.artist || 'Unknown',
      m.title,
      typeof m.duration === 'number' ? m.duration : null,
    ); // in-memory cache hit after the first fetch — effectively free
  } catch {
    return;
  }
  if (!track) return;

  const line = lyricsService.getCurrentLine(track, effectivePos) ?? track.synced[0]?.text ?? null;
  if (line === lastSentLyricLine) return; // no change → nothing to do (dedupe on RAW line)
  // Pace lyric updates: at most one every `intervalSec` (default 2s) since the
  // last chatbox send. Fast sections can change lines several times a second,
  // and VRChat's chatbox rate limiter (5 msgs / 5s) silently drops bursts —
  // which made lyrics look stuck. lastSentLyricLine is deliberately NOT
  // updated here, so the change is retried on the next 500ms tick and goes
  // out the moment the window opens — with the line current at THAT moment.
  const minGapMs = Math.max(1, settings.liveLyrics?.intervalSec ?? 2) * 1000;
  if (now - lastChatboxSentAt < minGapMs) return;
  lastSentLyricLine = line;

  // Enrich the raw line with romaji/translation for display (dedupe stays on
  // the raw line so we don't re-translate the same chorus repeatedly).
  const enriched = line ? await enrichLyric(line, settings) : null;

  // Recompose using cached inputs + the fresh lyric line. No re-poll.
  const vrchatSnap = settings.vrchatLog?.enabled ? vrchatLog.getSnapshot() : null;
  const pinnedTexts = getPinnedTexts(settings);
  const text = formatChatbox({
    settings,
    media: lastMedia,
    stats: lastStats,
    audio: lastAudio,
    battery: null,
    afk: lastAfk,
    tzIndex,
    currentLyric: enriched,
    mediaPosSec: effectivePos,
    vrchat: vrchatSnap,
    sessionStartAt: vrchatWatch.runningSince(),
    pinnedTexts,
  });
  if (text.trim().length === 0) return;
  // Keep the renderer preview in sync too.
  win?.webContents.send(IPC.LIVE_UPDATE, {
    media: lastMedia,
    stats: lastStats,
    audio: lastAudio,
    battery: null,
    afk: lastAfk,
    instance: null,
    telemetry: osc.sampleTelemetry(),
    time: new Date().toISOString(),
    preview: text,
  });
  try {
    // Lyric path: lyric changed (we wouldn't be here otherwise) so this
    // is genuinely new content — always send and update the dedupe state
    // so the next live tick doesn't redundantly resend the same string.
    await osc.sendChatbox(text, settings.osc.sendImmediately, false);
    lastChatboxSent = text;
    lastChatboxSentAt = Date.now();
  } catch (e) {
    log.warn('[lyrics] fast-path send failed', e);
  }
}

function startLive(settings: AppSettings, explicit = false): void {
  if (explicit) explicitLive = true;
  stopLive();
  osc.configure(settings.osc);
  osc.setChatboxFont((settings.chatboxFont ?? 'plain') as any);
  osc.setChatboxMarkdown(!!settings.chatboxMarkdown);
  osc.setExternalChatbox(!!settings.externalChatbox);
  osc.setChatboxPill(!!settings.chatboxPill);
  osc.setPillMethod(settings.pillMethod);
  const interval = Math.max(1, settings.updateIntervalSec) * 1000;
  void gatherAndSend(settings);
  liveTimer = setInterval(() => void gatherAndSend(settings), interval);
  // Event-driven lyric line detector — only when live lyrics are enabled.
  // 500ms granularity, but only SENDS on line change (see lyricFastTick).
  if (settings.liveLyrics?.enabled) {
    lyricFastTimer = setInterval(() => void lyricFastTick(settings), 500);
  }
}

function stopLive(): void {
  if (liveTimer) {
    clearInterval(liveTimer);
    liveTimer = null;
  }
  if (lyricFastTimer) {
    clearInterval(lyricFastTimer);
    lyricFastTimer = null;
  }
}

function startTelemetryStream(): void {
  // Always sample telemetry once/sec for the live network-flow widget,
  // even when not broadcasting, so the UI shows real idle/active rates.
  telemetryStop();
  telemetryTimer = setInterval(() => {
    if (!liveTimer) {
      // When not in live mode, still push telemetry + audio so widgets live-update.
      win?.webContents.send(IPC.LIVE_UPDATE, {
        media: null,
        stats: null,
        audio: osc.getAudioStatus(),
        battery: null,
        afk: lastAfk,
        instance: null,
        telemetry: osc.sampleTelemetry(),
        time: new Date().toISOString(),
        preview: '',
      });
    }
  }, 1000);
}

function telemetryStop(): void {
  if (telemetryTimer) {
    clearInterval(telemetryTimer);
    telemetryTimer = null;
  }
}

// IPC validation wrapper (item §4). Centralizes:
//   - zod parsing of renderer payloads (malformed input -> safe rejection)
//   - try/catch around every handler so a thrown error becomes an ActionResult
//     or a logged failure rather than an uncaught rejection in the renderer.
// Handlers are called as fn(PAYLOAD, event) — payload first. The payload's
// type is derived from the schema argument: a zod schema gives its parsed
// type; `null` gives `unknown`. So a schema-less handler that mistakenly
// declares the event first — `(_e: IpcMainInvokeEvent, raw) =>` — fails to
// compile instead of silently reading its payload off the event object (that
// swap broke the Pill Lab, the Quest ping test, and Whisper audio + downloads).
type IpcInput<S> = S extends ZodSchema<infer T> ? T : unknown;

function safeHandle<S extends ZodSchema | null, TOut>(
  channel: string,
  schema: S,
  fn: (input: IpcInput<S>, event: IpcMainInvokeEvent) => Promise<TOut> | TOut,
): void {
  ipcMain.handle(channel, async (event, raw) => {
    let input: unknown = raw;
    if (schema) {
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        log.warn(`[ipc] rejected ${channel}: invalid payload`, parsed.error.issues);
        throw new Error(`Invalid payload for ${channel}`);
      }
      input = parsed.data;
    }
    try {
      return await fn(input as IpcInput<S>, event);
    } catch (err) {
      log.error(`[ipc] handler ${channel} failed:`, err);
      throw err instanceof Error ? err : new Error(String(err));
    }
  });
}

function registerIpc(): void {
  safeHandle(IPC.GET_SETTINGS, null, () => store.load());

  safeHandle(IPC.SAVE_SETTINGS, AppSettingsSchema, async (validated) => {
    // Validation guarantees the keys we touch are well-typed; we still cast
    // because AppSettings has many user-defined extension fields not in the
    // schema. Persisting the original object keeps those keys intact.
    const settings = validated as unknown as AppSettings;
    // Capture the LIVE engine runtime state into settings.state before saving.
    // The renderer's copy of `state` is a stale boot snapshot, so without this
    // the pinned statuses / messages (engine.pinnedItems) — i.e. "the status I
    // saved" — would never make it to disk and would vanish on restart.
    settings.state = engine.getState();
    await store.save(settings);
    osc.configure(settings.osc);
    osc.setChatboxFont((settings.chatboxFont ?? 'plain') as any);
    osc.setChatboxMarkdown(!!settings.chatboxMarkdown);
    osc.setExternalChatbox(!!settings.externalChatbox);
    osc.setChatboxPill(!!settings.chatboxPill);
    osc.setPillMethod(settings.pillMethod);
    safety?.update(settings.safety);
    registerHotkeys();
    startRefreshLoop();
    autoResponder?.reconfigure();
    relay?.reconfigure();
    applyWindowModes(settings);
    if (liveTimer) startLive(settings);
    // Start/stop the VRChat output-log tailer based on the current setting.
    if (settings.vrchatLog?.enabled) vrchatLog.start();
    else vrchatLog.stop();
    // VRCOSC-ported: AFK source preference is updated live so toggling
    // 'auto'/'vrchat'/'idle' in settings takes effect on the next tick.
    afkDet.setSource(settings.afk?.source);
    // Standalone-Quest awareness: a remote target means PC idle ≠ AFK.
    afkDet.setRemoteTarget(isRemoteHost(settings.osc.ip));
    reconfigureVrchatWatch(settings);
    reconfigureOverlay(settings);
    reconfigureDiscord(settings);
    pushOverlayState();
    return true;
  });

  safeHandle(IPC.RESET_SETTINGS, null, async () => {
    // Factory reset. Stop live sending first so nothing keeps pushing the old
    // pins, wipe settings.json back to defaults (store.reset keeps a backup of
    // the pre-reset file), then HARD-reset the engine's runtime state so any
    // restored pins / current status are cleared — not just the on-disk copy.
    // Returns the fresh settings; the renderer swaps them in and the engine's
    // emitted 'state' event clears the pins in the UI + live loop.
    explicitLive = false;
    stopLive();
    const fresh = await store.reset();
    engine.reset(fresh.state);
    osc.configure(fresh.osc);
    osc.setChatboxFont((fresh.chatboxFont ?? 'plain') as any);
    osc.setChatboxMarkdown(!!fresh.chatboxMarkdown);
    osc.setExternalChatbox(!!fresh.externalChatbox);
    osc.setChatboxPill(!!fresh.chatboxPill);
    osc.setPillMethod(fresh.pillMethod);
    safety?.update(fresh.safety);
    registerHotkeys();
    startRefreshLoop();
    autoResponder?.reconfigure();
    relay?.reconfigure();
    applyWindowModes(fresh);
    if (fresh.vrchatLog?.enabled) vrchatLog.start();
    else vrchatLog.stop();
    afkDet.setSource(fresh.afk?.source);
    afkDet.setRemoteTarget(isRemoteHost(fresh.osc.ip));
    reconfigureVrchatWatch(fresh);
    reconfigureOverlay(fresh);
    reconfigureDiscord(fresh);
    return fresh;
  });

  safeHandle(IPC.SEND_MESSAGE, MessageTextSchema, async (text) => {
    const s = store.get();
    osc.configure(s.osc);
    // Route through the engine so AppState.lastSentText updates — that's
    // what the live loop reads when `pinSentMessages` is enabled to keep
    // the manual line in the rotation instead of letting it disappear
    // after VRChat's ~20s auto-clear.
    //
    // Per-text pin key: every UNIQUE manual message gets its own pin slot
    // so multiple manual sends can sit in the pin rotation simultaneously.
    // Re-sending the same text refreshes the existing slot (no duplicates).
    // The legacy default `pinKey: 'manual'` was the cause of "can only
    // ever pin one manual message" — every send overwrote the previous.
    //
    // Cap enforcement: respect `pinManualMax` (default 10) so the
    // rotation doesn't balloon. Drops the OLDEST manual pin to make room
    // (LRU eviction) so the latest message always wins a slot.
    const pinKey = `manual:${text}`;
    const max = s.pinManualMax ?? 10;
    const cur = engine.getState().pinnedItems ?? [];
    const manualPins = cur.filter((p) => p.key.startsWith('manual:'));
    const alreadyPinned = manualPins.some((p) => p.key === pinKey);
    if (!alreadyPinned && manualPins.length >= max) {
      // Evict oldest manual pin (front of array — upsertPin appends).
      const oldest = manualPins[0];
      if (oldest) engine.removePin(oldest.key);
    }
    await engine.run({ kind: 'sendText', text, pinKey });
    return true;
  });

  // ---- Pin management ----
  // Toggle a pin: add `text` under `key`, or remove if already pinned.
  ipcMain.handle('pin:toggle', (_e, payload: { key: string; text: string }) => {
    if (!payload || typeof payload.key !== 'string' || typeof payload.text !== 'string')
      return false;
    return engine.togglePin(payload.key, payload.text);
  });
  // Remove a specific pin slot by key.
  ipcMain.handle('pin:remove', (_e, key: string) => {
    if (typeof key !== 'string') return false;
    engine.removePin(key);
    return true;
  });
  // Clear ALL pins (used by the "Unpin all" UI + clearChatbox).
  ipcMain.handle('pin:clear', () => {
    engine.clearAllPins();
    engine.setState({ lastSentText: '', lastSentAt: Date.now() });
    return true;
  });

  safeHandle(IPC.SET_TYPING, TypingSchema, async (typing) => {
    const s = store.get();
    osc.configure(s.osc);
    await osc.setTyping(typing);
    return true;
  });

  safeHandle(IPC.CLEAR_CHATBOX, null, async () => {
    const s = store.get();
    osc.configure(s.osc);
    await osc.clear();
    return true;
  });

  safeHandle(IPC.START_LIVE, null, () => {
    startLive(store.get(), true); // explicit user request — keeps running w/o pins
    return true;
  });
  safeHandle(IPC.STOP_LIVE, null, () => {
    explicitLive = false;
    stopLive();
    return true;
  });

  safeHandle(IPC.TEST_CONNECTION, null, async () => {
    const s = store.get();
    osc.configure(s.osc);
    await osc.sendChatbox("Uv's Chat Box connected ✓", true, true);
    return true;
  });

  // Battery: SteamVR device battery (HMD/controllers/trackers) when SteamVR
  // is running, else the PC/laptop battery. Includes a `diag` string from the
  // OpenVR probe so the panel can explain "no devices found".
  safeHandle(IPC.GET_BATTERY, null, async () => {
    const status = await batterySvc.collect();
    return { ...status, diag: batterySvc.vrError(), adb: batterySvc.adbState() };
  });

  // Force a fresh adb probe (Battery panel "Re-scan" after the user plugs in
  // the Link cable / accepts the USB-debugging prompt / sets an adb path).
  safeHandle(IPC.QUEST_BATTERY_RESCAN, null, async () => {
    await batterySvc.rescanAdb();
    const status = await batterySvc.collect();
    return { ...status, diag: batterySvc.vrError(), adb: batterySvc.adbState() };
  });

  safeHandle(IPC.GET_TELEMETRY, null, () => osc.sampleTelemetry());

  // ===== Phase 1 automation handlers =====

  safeHandle(IPC.RUN_ACTION, ActionSchema, (action) => engine.run(action as Action));
  safeHandle(IPC.RUN_ACTIONS, ActionArraySchema, (actions) =>
    engine.runSequence(actions as Action[]),
  );

  safeHandle(IPC.RUN_MACRO, IdSchema, (macroId) => engine.run({ kind: 'runMacro', macroId }));

  safeHandle(IPC.RUN_TIMELINE, IdSchema, (timelineId) =>
    engine.run({ kind: 'runTimeline', timelineId }),
  );

  safeHandle(IPC.STOP_TIMELINE, null, () => {
    engine.stopTimeline();
    return true;
  });

  safeHandle(IPC.SWITCH_PROFILE, IdSchema, (profileId) => {
    applyProfile(profileId);
    return true;
  });

  safeHandle(IPC.SET_STATUS, IdSchema, (statusId) => engine.run({ kind: 'setStatus', statusId }));

  safeHandle(IPC.GET_STATE, null, () => engine.getState());
  safeHandle(IPC.GET_HISTORY, null, () => engine.getHistory());
  safeHandle(IPC.UNDO_LAST, null, () => engine.undoLast());
  safeHandle(IPC.REGISTER_HOTKEYS, null, () => {
    registerHotkeys();
    return true;
  });

  safeHandle(IPC.CHECK_UPDATE, null, () => checkForUpdate());
  // APPLY_UPDATE now only downloads (with progress); INSTALL_UPDATE restarts
  // into the installer once the download is done.
  safeHandle(IPC.APPLY_UPDATE, null, () => downloadUpdate());
  safeHandle(IPC.INSTALL_UPDATE, null, () => installUpdate());

  // ---- Relay ----
  safeHandle(IPC.RELAY_GET_CONFIG, null, () => resolveRelayConfig(store.get()));
  safeHandle(IPC.RELAY_SAVE_CONFIG, RelayConfigSchema, async (cfg) => {
    const next: AppSettings = { ...store.get(), relay: cfg as RelayConfig };
    await store.save(next);
    relay.reconfigure();
    return true;
  });
  safeHandle(IPC.RELAY_FORCE_ADVANCE, null, () => {
    relay.forceAdvance();
    return true;
  });

  // ---- VRCOSC-ported IPC ----
  safeHandle(IPC.WEATHER_GET, null, async () => {
    const s = store.get();
    return weatherSvc.get(s.weather?.query ?? '', s.weather?.auto ?? false);
  });

  // ---- Speech to text ----
  // The renderer drives a single STT engine at a time, picked by
  // settings.sttEngine. Both engines emit through the same STT_EVENT
  // channel so the renderer doesn't need to know which one is active.
  safeHandle(IPC.STT_START, null, () => {
    startDictation();
    return true;
  });
  safeHandle(IPC.STT_STOP, null, () => {
    stopDictation();
    return true;
  });

  // ---- Whisper (VRCOSC port) ----
  safeHandle(IPC.WHISPER_PUSH_PCM, null, (raw: unknown) => {
    if (!(raw instanceof ArrayBuffer)) return false;
    whisperRec.pushPcm(new Int16Array(raw));
    return true;
  });
  safeHandle(IPC.WHISPER_DOWNLOAD, null, async (raw: unknown) => {
    const c = (raw as { modelChoice?: string })?.modelChoice;
    const ok: ReadonlyArray<string> = ['tiny', 'tiny.en', 'base', 'base.en', 'small', 'small.en'];
    if (typeof c !== 'string' || !ok.includes(c)) return { ok: false, error: 'bad modelChoice' };
    try {
      const p = await whisperDl.download(
        c as 'tiny' | 'tiny.en' | 'base' | 'base.en' | 'small' | 'small.en',
      );
      return { ok: true, path: p };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });
  safeHandle(IPC.WHISPER_STATUS, null, () => {
    const s = store.get();
    return {
      engine: s.sttEngine ?? 'uwp',
      running: s.sttEngine === 'whisper' ? whisperRec.isRunning() : false,
      cfg: s.whisper ?? null,
    };
  });

  // ---- Open a Windows Settings page via ms-settings: URI ----
  // Whitelisted to the few we actually need so a compromised renderer can't
  // launch arbitrary URIs.
  const ALLOWED_SETTINGS = new Set(['privacy-speech', 'sound', 'privacy-microphone']);
  // One-shot media snapshot. The live loop only polls media when the media
  // module is enabled; the Ambient Reactive UI needs the signal regardless,
  // so we expose a direct query.
  safeHandle(IPC.GET_MEDIA_NOW, null, () => media.collect());

  // ---- Settings export / import ---------------------------------------
  // Save the entire AppSettings as a JSON file the user picks. Lets people
  // back up their config or move it between machines.
  safeHandle(IPC.EXPORT_SETTINGS, null, async () => {
    const { canceled, filePath } = await dialog.showSaveDialog(win ?? undefined!, {
      title: 'Export settings',
      defaultPath: `uvs-chatbox-settings-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (canceled || !filePath) return { ok: false, reason: 'cancelled' };
    try {
      await fsp.writeFile(filePath, JSON.stringify(store.get(), null, 2), 'utf-8');
      log.info(`[settings] exported to ${filePath}`);
      return { ok: true, path: filePath };
    } catch (e) {
      log.error('[settings] export failed:', e);
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  });

  // Load a JSON file and replace current settings with its contents. We
  // validate against AppSettingsSchema (permissive .passthrough) so a
  // malformed file is rejected cleanly instead of corrupting in-memory
  // state. After import we re-fire the same reconfigure calls that the
  // SAVE_SETTINGS handler does, so all running services pick up the change.
  safeHandle(IPC.IMPORT_SETTINGS, null, async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win ?? undefined!, {
      title: 'Import settings',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (canceled || !filePaths[0]) return { ok: false, reason: 'cancelled' };
    try {
      const raw = await fsp.readFile(filePaths[0], 'utf-8');
      const parsed = JSON.parse(raw);
      const validated = AppSettingsSchema.safeParse(parsed);
      if (!validated.success) {
        return {
          ok: false,
          reason: `Invalid settings file: ${validated.error.issues[0]?.message ?? 'schema error'}`,
        };
      }
      const next = validated.data as unknown as AppSettings;
      await store.save(next);
      // Apply the same downstream effects as the SAVE_SETTINGS handler.
      osc.configure(next.osc);
      safety?.update(next.safety);
      registerHotkeys();
      startRefreshLoop();
      autoResponder?.reconfigure();
      relay?.reconfigure();
      applyWindowModes(next);
      if (liveTimer) startLive(next);
      reconfigureVrchatWatch(next);
      reconfigureOverlay(next);
      reconfigureDiscord(next);
      log.info(`[settings] imported from ${filePaths[0]}`);
      return { ok: true, path: filePaths[0] };
    } catch (e) {
      log.error('[settings] import failed:', e);
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  });

  // ---- Launch on Windows startup --------------------------------------
  // Wraps app.setLoginItemSettings — adds a registry entry under
  // HKCU\Software\Microsoft\Windows\CurrentVersion\Run that auto-launches
  // the installed exe at login. Has no effect when running from `npm run
  // dev` (no installed path to register).
  safeHandle(IPC.SET_LOGIN_ITEM, null, (raw: unknown) => {
    const enabled = !!raw;
    app.setLoginItemSettings({ openAtLogin: enabled });
    log.info(`[startup] login-item ${enabled ? 'enabled' : 'disabled'}`);
    return true;
  });
  safeHandle(IPC.GET_LOGIN_ITEM, null, () => {
    return app.getLoginItemSettings().openAtLogin;
  });

  // ---- Quit handler so the renderer can trigger a real exit ----------
  safeHandle(IPC.QUIT_APP, null, () => {
    isQuitting = true;
    app.quit();
    return true;
  });

  // ---- Global pause (panic switch) ------------------------------------
  safeHandle(IPC.PAUSE_GET, null, () => osc.isPaused());
  safeHandle(IPC.PAUSE_SET, null, async (paused) => {
    const p = !!paused;
    osc.setPaused(p);
    if (p) {
      // Wipe the chatbox so VRChat doesn't sit on the last sent line. We
      // bypass the pause gate by sending an empty string (sendChatbox lets
      // empties through).
      try {
        await osc.clear();
      } catch {
        /* ignore */
      }
    }
    win?.webContents.send(IPC.PAUSE_UPDATE, p);
    rebuildTrayMenu();
    return p;
  });

  // ---- VRChat output-log snapshot -------------------------------------
  safeHandle(IPC.VRCHAT_LOG_GET, null, () => vrchatLog.getSnapshot());

  // ---- AI (Anthropic / Claude) ----------------------------------------
  // All five AI features sit on top of one Anthropic client. Each handler
  // is a thin pass-through to the AiClient method; the renderer treats
  // {ok, data|error} responses uniformly.
  safeHandle(IPC.AI_TEST, null, () => ai.testConnection());
  safeHandle(IPC.AI_GENERATE_LINE, null, async (payload: any) => {
    const cfg = store.get().ai;
    return ai.generateLine({
      status: payload?.status,
      music: payload?.music ?? null,
      world: payload?.world,
      persona: cfg?.persona ?? '',
    });
  });
  safeHandle(IPC.AI_PERSONA_REPLY, null, async (payload: any) => {
    const cfg = store.get().ai;
    return ai.personaReply({
      state: payload?.state ?? 'afk',
      minutesIdle: Number(payload?.minutesIdle ?? 0),
      persona: cfg?.persona ?? '',
    });
  });
  safeHandle(IPC.AI_CLEANUP_STT, null, async (raw: any) => {
    if (typeof raw !== 'string') return { ok: false, error: 'raw must be a string' };
    return ai.cleanupStt(raw);
  });
  // ---- Auto-translate ------------------------------------------------
  // Cheap free-tier Google Translate endpoint (no key needed). For other
  // providers, swap the URL in the fetch call.
  ipcMain.handle(
    'translate:text',
    async (_e, payload: { text?: unknown; targetLang?: unknown }) => {
      if (!payload || typeof payload.text !== 'string' || typeof payload.targetLang !== 'string') {
        return { ok: false, error: 'text and targetLang required' };
      }
      const text = payload.text.trim();
      if (!text) return { ok: true, data: '' };
      const out = await translateText(text, payload.targetLang);
      if (!out) return { ok: false, error: 'translation failed' };
      return { ok: true, data: out };
    },
  );

  // ---- Network reachability test (Quest troubleshooting) ----
  safeHandle(IPC.NET_PING, null, async (raw: unknown) => {
    const ip = String((raw as { ip?: string })?.ip ?? '').trim();
    // Only hostnames / IPs — no shell anyway (execFile), but validate to be safe.
    if (!ip || !/^[a-zA-Z0-9.\-:]{1,64}$/.test(ip)) {
      return { ok: false, reachable: false, ms: null, error: 'Enter a valid IP first.' };
    }
    const r = await pingHost(ip);
    return { ok: true, ...r };
  });

  // ---- Live lyrics source health (panel shows a warning while LRCLib is down) ----
  safeHandle(IPC.LYRICS_STATUS, null, () => lyricsService.status());

  // ---- System Check: health of every outside service, with fixes ----
  safeHandle(IPC.SYSTEM_CHECK, null, () => {
    const s = store.get();
    return runSystemCheck({
      settings: s,
      osc: osc.health(),
      liveRunning: !!liveTimer,
      weatherEnabled: moduleEnabled(s, 'weather') && s.weather?.enabled !== false,
      overlayRunning: overlay.isRunning(),
      discordStatus: () => discord.status(),
      probeLyrics: () => lyricsService.probe(),
      probeWeather: async () => {
        const w = await weatherSvc.get(s.weather?.query ?? '', s.weather?.auto ?? false);
        return { available: w.available, city: w.city };
      },
      rescanAdb: () => batterySvc.rescanAdb(),
      questBatteryWanted:
        moduleEnabled(s, 'battery') ||
        (s.vrNotifications?.enabled === true && s.vrNotifications.onLowBattery),
      pingHost,
      updates: async () => {
        const u = await checkForUpdate();
        if (u.configured === false) {
          return {
            status: 'off',
            detail: isDev
              ? 'Disabled in dev builds'
              : 'Not set up for this build (see RELEASING.md)',
          };
        }
        if (u.error) {
          return {
            status: 'warn',
            detail: `Couldn't check for updates (${u.error})`,
            fix: 'Open Settings → Updates and press "Check now" to retry.',
          };
        }
        if (u.downloaded) {
          return {
            status: 'warn',
            detail: `v${u.latestVersion} is downloaded`,
            fix: 'Click "Restart to update" in the banner to install it.',
          };
        }
        if (u.available) {
          return {
            status: 'warn',
            detail: `v${u.latestVersion} is available (you have v${u.currentVersion})`,
            fix: 'Click "Download" in the update banner.',
          };
        }
        return { status: 'ok', detail: `Up to date (v${u.currentVersion})` };
      },
    });
  });

  // ---- Pill Lab: send one labelled test message with a given pill variant ----
  // Two lines on purpose — the real chatbox is multi-line, so a variant only
  // counts if it works there. The live loop is held for PILL_TEST_HOLD_MS so
  // it can't overwrite the test, and its dedupe is reset so the normal
  // chatbox comes straight back afterwards.
  safeHandle(IPC.PILL_TEST, null, async (raw: unknown) => {
    const method = String((raw as { method?: string })?.method ?? '');
    const label = { legacy: 'A', vrcosc: 'B', etx: 'C', us: 'D', lsep: 'E' } as Record<
      string,
      string
    >;
    if (method !== 'richtext' && !(PILL_METHODS as readonly string[]).includes(method)) {
      return { ok: false, error: 'unknown variant' };
    }
    chatboxHoldUntil = Date.now() + PILL_TEST_HOLD_MS;
    lastChatboxSent = '';
    const text =
      method === 'richtext'
        ? 'F: <b>BOLD?</b> <size=60%>small?</size>\nIf this looks bold/small, rich text works'
        : `PILL TEST ${label[method]}\nsecond line`;
    await osc.sendPillTest(text, method as PillMethod | 'richtext');
    return { ok: true, holdSec: PILL_TEST_HOLD_MS / 1000 };
  });

  // ---- Discord Rich Presence status (panel polls on mount) ----
  safeHandle(IPC.DISCORD_GET_STATUS, null, () => discord.status());

  // ---- SteamVR in-headset notification (manual test) ----
  safeHandle(IPC.VR_NOTIFY_TEST, null, () =>
    vrNotifier.notify("Uv's Chat Box — VR notifications are working ✅", {
      force: true,
      holdMs: (store.get().vrNotifications?.durationSec ?? 6) * 1000,
    }),
  );

  // ---- Settings backups -----------------------------------------------
  safeHandle(IPC.BACKUPS_LIST, null, () => store.listBackups());
  safeHandle(IPC.BACKUPS_RESTORE, null, async (name) => {
    if (typeof name !== 'string') return false;
    const restored = await store.readBackup(name);
    if (!restored) return false;
    await store.save(restored);
    // Push the restored settings to the renderer the same way a normal
    // save would — without restarting the app.
    win?.webContents.send(IPC.STATE_UPDATE, engine.getState());
    return true;
  });

  // ---- Scheduled send-later queue -------------------------------------
  safeHandle(IPC.SCHEDULE_LIST, null, () => store.get().scheduled ?? []);
  safeHandle(IPC.SCHEDULE_ADD, null, async (raw: unknown) => {
    const input = raw as { text?: string; fireAt?: number };
    const text = String(input?.text ?? '').trim();
    const fireAt = Number(input?.fireAt);
    if (!text || !Number.isFinite(fireAt) || fireAt <= Date.now()) {
      return { ok: false, reason: 'invalid' };
    }
    const cur = store.get();
    const id = `sched_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const next = {
      ...cur,
      scheduled: [...(cur.scheduled ?? []), { id, text, fireAt }],
    };
    await store.save(next);
    return { ok: true, id };
  });
  safeHandle(IPC.SCHEDULE_REMOVE, null, async (raw: unknown) => {
    const id = String(raw ?? '');
    const cur = store.get();
    await store.save({
      ...cur,
      scheduled: (cur.scheduled ?? []).filter((s) => s.id !== id),
    });
    return true;
  });

  // One-shot AFK snapshot. Used by the Smart AFK feature panel to show the
  // live idle counter, so users can verify detection is actually working
  // before relying on it. Also includes the SteamVR HMD activity reading so
  // the panel can show whether the headset is currently on the user's head.
  safeHandle(IPC.GET_AFK_NOW, null, async () => {
    const [base, vr] = await Promise.all([
      afkDet.poll(store.get().afk.thresholdSec),
      vrActivity.poll(),
    ]);
    return {
      ...base,
      hmd: {
        available: vr.available,
        activityLevel: vr.activityLevel,
        onHead: vr.hmdOnHead,
      },
    };
  });

  safeHandle(IPC.OPEN_WINDOWS_SETTING, null, async (raw: unknown) => {
    const key = String(raw ?? '');
    if (!ALLOWED_SETTINGS.has(key)) {
      log.warn(`[shell] refused to open unknown setting "${key}"`);
      return false;
    }
    await shell.openExternal(`ms-settings:${key}`);
    return true;
  });
}

// ---- Profiles (spec §2/§5): switching swaps endpoint + default status ----
function applyProfile(profileId: string): void {
  const s = store.get();
  const profile = s.profiles.find((p) => p.id === profileId);
  if (!profile) return;
  const next: AppSettings = {
    ...s,
    activeProfileId: profileId,
    osc: {
      ...s.osc,
      ip: profile.osc.ip,
      port: profile.osc.port,
      listenPort: profile.osc.listenPort,
    },
  };
  void store.save(next);
  osc.configure(next.osc);
  // Apply the profile's default status.
  void engine.run({ kind: 'setStatus', statusId: profile.defaultStatusId });
  win?.webContents.send(IPC.STATE_UPDATE, engine.getState());
}

// ---- Global hotkeys (spec §10) via Electron globalShortcut ----
function registerHotkeys(): void {
  globalShortcut.unregisterAll();
  const s = store.get();
  if (!s.featureToggles.hotkeys) return;

  const tryReg = (accel: string | undefined, fn: () => void) => {
    if (!accel) return;
    try {
      globalShortcut.register(accel, fn);
    } catch {
      /* invalid accel */
    }
  };

  // Quick/smart phrases removed — no phrase hotkeys registered.
  for (const macro of s.macros) {
    tryReg(macro.hotkey, () => {
      void engine.run({ kind: 'runMacro', macroId: macro.id });
      win?.webContents.send(IPC.HOTKEY_FIRED, { type: 'macro', id: macro.id });
    });
  }
  for (const profile of s.profiles) {
    tryReg(profile.hotkey, () => applyProfile(profile.id));
  }
}

// ---- Refresh loop (spec §14A): re-send current state periodically ----
function startRefreshLoop(): void {
  stopRefreshLoop();
  const s = store.get();
  if (!s.refreshLoop.enabled) return;
  const ms = Math.max(8, s.refreshLoop.intervalSec) * 1000;
  refreshTimer = setInterval(() => {
    // While the live cycle loop is running it already owns keep-alive:
    // every tick re-sends the composed line (pins + modules) with its own
    // 15s keep-alive window. A raw lastSentText re-send here would (a)
    // flash the lone text over the composed cycle output and (b) — before
    // the noPin flag existed — land a DUPLICATE pin in the default
    // 'manual' slot ("pressing Available puts it twice" bug).
    if (liveTimer) return;
    const st = engine.getState();
    if (st.lastSentText) {
      // Re-send through the engine so the safety rate-limit still applies.
      // noPin: this text is already pinned under its real key (status:*/
      // manual:*) — don't re-pin it. bypassDedupe: re-sending identical
      // text is the entire point of a keep-alive.
      void engine.run({ kind: 'sendText', text: st.lastSentText, noPin: true, bypassDedupe: true });
    }
  }, ms);
}

function stopRefreshLoop(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

// ---- Auto AFK responder (spec §14C) ----
// ---- Connection health + auto-reconnect (spec §12/§2) ----
function setConn(patch: Partial<ConnStatus>): void {
  conn = { ...conn, ...patch };
  win?.webContents.send(IPC.CONN_UPDATE, conn);
}

// ---- Built-in updater: GitHub Releases via electron-updater ----
// The feed (owner/repo) is baked into resources/app-update.yml at package
// time from package.json "build.publish". Checks run in the background (20s
// after launch, then every 4h) and also on demand. Downloading is opt-in with
// progress; "Restart to update" installs it — and a downloaded update also
// installs on the next normal quit (autoInstallOnAppQuit). See RELEASING.md.
let updaterLoaded: AppUpdater | null = null;
let lastUpdate: UpdateStatus = { checking: false, available: false, currentVersion: '' };

/** electron-updater errors can be a full HTTP dump; reduce them to one line
 *  a person can act on. */
function friendlyUpdateError(raw: string): string {
  if (
    /Unable to find latest version|No published versions|HttpError: 404|status code 404/i.test(raw)
  ) {
    return 'No release published on GitHub yet';
  }
  if (/ENOTFOUND|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|net::ERR_/i.test(raw)) {
    return "Can't reach GitHub — check your internet";
  }
  if (/sha512 checksum mismatch/i.test(raw)) return 'Download was corrupted — try again';
  const first = raw.split(/\r?\n/)[0] ?? raw;
  return first.length > 160 ? `${first.slice(0, 157)}…` : first;
}

/** Merge + push the update state to the renderer (banner + Settings). */
function sendUpdate(patch: Partial<UpdateStatus>): UpdateStatus {
  lastUpdate = { ...lastUpdate, ...patch, currentVersion: app.getVersion() };
  win?.webContents.send(IPC.UPDATE_STATUS, lastUpdate);
  return lastUpdate;
}

/** True when this build has a real update feed — not dev, not the old
 *  placeholder owner/repo. Avoids error spam on unconfigured builds. */
function updaterConfigured(): boolean {
  if (isDev) return false;
  try {
    const yml = readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8');
    return /provider:\s*\S+/.test(yml) && !/REPLACE_ME/.test(yml);
  } catch {
    return false;
  }
}

/** a > b for dotted numeric versions ("1.10.0" > "1.9.3"). */
function isNewerVersion(a: string, b: string): boolean {
  const pa = a.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const pb = b.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

function getAutoUpdater(): AppUpdater | null {
  if (updaterLoaded) return updaterLoaded;
  try {
    // Lazy require so the app runs even if the dep isn't installed yet.
    const { autoUpdater } = require('electron-updater') as { autoUpdater: AppUpdater };
    autoUpdater.autoDownload = false; // the user chooses when to download
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = log;
    autoUpdater.on('update-available', (info: UpdateInfo) =>
      sendUpdate({
        checking: false,
        available: true,
        latestVersion: info.version,
        notes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
      }),
    );
    autoUpdater.on('update-not-available', () => sendUpdate({ checking: false, available: false }));
    autoUpdater.on('download-progress', (p: ProgressInfo) =>
      sendUpdate({ downloading: true, percent: Math.round(p.percent ?? 0) }),
    );
    autoUpdater.on('update-downloaded', (info: UpdateInfo) =>
      sendUpdate({
        downloading: false,
        downloaded: true,
        percent: 100,
        latestVersion: info.version ?? lastUpdate.latestVersion,
      }),
    );
    autoUpdater.on('error', (err: Error) => {
      log.error('[updater] error event:', err);
      sendUpdate({ checking: false, downloading: false, error: friendlyUpdateError(err.message) });
    });
    updaterLoaded = autoUpdater;
    return autoUpdater;
  } catch (e) {
    log.warn('[updater] electron-updater unavailable:', e);
    return null;
  }
}

async function checkForUpdate(): Promise<UpdateStatus> {
  if (!updaterConfigured()) {
    return sendUpdate({
      checking: false,
      available: false,
      configured: false,
      error: isDev ? 'Updates are disabled in dev builds' : 'Updates are not set up for this build',
    });
  }
  const updater = getAutoUpdater();
  if (!updater) return sendUpdate({ configured: true, error: 'Updater unavailable' });
  // Mid-download or already downloaded: a fresh check would only reset that.
  if (lastUpdate.downloading || lastUpdate.downloaded) return lastUpdate;
  try {
    sendUpdate({ checking: true, configured: true, error: undefined });
    const result = await updater.checkForUpdates();
    const latest: string | undefined = result?.updateInfo?.version;
    return sendUpdate({
      checking: false,
      available: !!latest && isNewerVersion(latest, app.getVersion()),
      latestVersion: latest,
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    log.error('[updater] checkForUpdate failed:', error);
    return sendUpdate({ checking: false, error: friendlyUpdateError(error) });
  }
}

/** Download the available update (progress arrives via UPDATE_STATUS). */
async function downloadUpdate(): Promise<boolean> {
  const updater = getAutoUpdater();
  if (!updater || !updaterConfigured() || !lastUpdate.available) return false;
  try {
    sendUpdate({ downloading: true, percent: 0, error: undefined });
    await updater.downloadUpdate();
    return true;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    log.error('[updater] download failed:', error);
    sendUpdate({ downloading: false, error: friendlyUpdateError(error) });
    return false;
  }
}

/** Quit and run the downloaded installer, then relaunch the app. isQuitting
 *  is set first so close-to-tray can't swallow the quit. */
function installUpdate(): boolean {
  const updater = getAutoUpdater();
  if (!updater || !lastUpdate.downloaded) return false;
  isQuitting = true;
  // isSilent=false shows the installer; isForceRunAfter=true relaunches us.
  setImmediate(() => updater.quitAndInstall(false, true));
  return true;
}

function wireEventSources(): void {
  // Audio status changes (inbound OSC) -> immediate UI nudge.
  osc.on('audio', (a: AudioStatus) => {
    lastAudio = a;
    win?.webContents.send(IPC.LIVE_UPDATE, {
      media: null,
      stats: null,
      audio: a,
      battery: null,
      afk: lastAfk,
      instance: null,
      telemetry: null,
      time: new Date().toISOString(),
      preview: '',
    });
  });

  // VRChat /avatar/parameters/AFK -> feed the detector (VRCOSC-style).
  osc.on('vrchat-afk', (e: { afk: boolean; at: number }) => {
    afkDet.setVrchatAfk(e.afk);
  });

  // Live OSC parameter monitor (spec §12).
  osc.on('monitor', (m: { address: string; value: string; at: number }) => {
    conn.monitor = [m, ...conn.monitor].slice(0, 20);
    win?.webContents.send(IPC.CONN_UPDATE, conn);
  });

  // OSC transport errors -> health + auto-reconnect (spec §2/§12).
  osc.on('error', (e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    setConn({ health: 'error', lastError: msg });
    // Attempt a reconfigure shortly after (VRChat may have reset OSC).
    setTimeout(() => {
      try {
        osc.configure(store.get().osc);
        setConn({ health: 'connected', lastOkAt: Date.now() });
      } catch {
        setConn({ health: 'reconnecting' });
      }
    }, 2000);
  });

  // Engine -> renderer state/history streaming. Also debounce-persist the
  // runtime state (pinned statuses/messages, current status, variables) into
  // settings.json so it survives a restart even if the user never clicks Save.
  engine.on('state', (st: AppState) => {
    win?.webContents.send(IPC.STATE_UPDATE, st);
    // VR toast on status change (PCVR only). Fire once per distinct change;
    // skip the very first observation so we don't toast the boot value.
    const cur = store.get();
    if (cur.vrNotifications?.enabled && cur.vrNotifications.onStatusChange) {
      const sid = st.currentStatusId ?? null;
      if (sid && sid !== lastNotifiedStatusId && lastNotifiedStatusId !== null) {
        const status = cur.statuses.find((s) => s.id === sid);
        const label = status ? `${status.icon ?? ''} ${status.label ?? sid}`.trim() : sid;
        void vrNotifier.notify(`Status: ${label}`, {
          holdMs: (cur.vrNotifications?.durationSec ?? 6) * 1000,
        });
      }
      lastNotifiedStatusId = sid;
    } else {
      lastNotifiedStatusId = st.currentStatusId ?? null;
    }
    // Keep the VR overlay's active-status highlights in sync with pins.
    pushOverlayState();
    // Reflect the new status in Discord presence (throttled in the service).
    if (store.get().discord?.enabled) pushDiscord(store.get());
    if (stateSaveTimer) clearTimeout(stateSaveTimer);
    stateSaveTimer = setTimeout(() => {
      stateSaveTimer = null;
      const cur = store.get();
      void store.save({ ...cur, state: engine.getState() });
    }, 1500);
  });
  engine.on('history', () => {
    win?.webContents.send(IPC.STATE_UPDATE, engine.getState());
  });
  engine.on('profile', (profileId: string) => applyProfile(profileId));

  // Pin-cycle: when a sendText fires (phrase, status, etc.) while pin
  // mode is on, the engine asks the live loop to compose + send NOW
  // instead of letting the lone phrase flash by itself. We honor that
  // only if live updates are actually running; otherwise sendText
  // already wrote directly to OSC.
  engine.on('request-tick', () => {
    // No loop running? A pin was just added while "Live Updates" is off.
    // Auto-start a loop (explicit=false) so pins rotate/keep-alive even
    // without the user pressing Start. startLive already fires one tick.
    if (!liveTimer) {
      const st = engine.getState();
      if ((st.pinnedItems?.length ?? 0) > 0) startLive(store.get(), false);
      return;
    }
    // Fire the tick NOW.
    void gatherAndSend(store.get());
    // Reset the scheduled live timer so the next tick fires a full
    // `updateIntervalSec` from now — not a fraction of a second later,
    // which would produce a double-send for every manual / phrase /
    // status click that lands close to a scheduled tick boundary.
    clearInterval(liveTimer);
    const intervalMs = Math.max(1, store.get().updateIntervalSec) * 1000;
    liveTimer = setInterval(() => void gatherAndSend(store.get()), intervalMs);
  });

  // ---- StatusRelay alert sources -----------------------------------------
  // Audio mute/deaf transitions -> normal-priority alert (preempts rotation
  // briefly to surface the change in-game).
  osc.on('audio', (a: AudioStatus) => {
    if (!relay) return;
    relay.emitAlert({
      id: `audio:${a.muted}:${a.deafened}`,
      priority: 'normal',
      text: a.deafened ? '🔇 Deafened' : a.muted ? '🎙️ Muted' : '🎙️ Unmuted',
      holdMs: 4000,
    });
  });
}

app.whenReady().then(async () => {
  // Grant microphone access by default. Without this, Chromium silently
  // denies getUserMedia() in Electron — even when Windows-level mic privacy
  // settings allow apps. The Ambient Reactive UI's voice glow relies on
  // microphone access; the Speech-to-Text feature is unaffected (it uses
  // Windows's UWP SpeechRecognizer, not the renderer mic).
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    // Electron 28's permission strings: "media" covers mic + camera
    // requests issued by getUserMedia().
    if (permission === 'media') {
      log.info('[perm] granting renderer permission "media"');
      callback(true);
    } else {
      callback(false);
    }
  });
  // Some Chromium code paths call setPermissionCheckHandler instead of the
  // request handler (synchronous lookup). Approve "media" the same way.
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    return permission === 'media';
  });

  const settings = await store.load();

  // Initialize Phase 1 engine pieces now that settings exist.
  safety = new SafetyGuard(settings.safety);
  engine = new ActionEngine(osc, safety, () => store.get(), settings.state);
  autoResponder = new AutoResponder(engine, afkDet, osc, () => store.get());
  relay = new StatusRelay(engine, sysStats, media, osc, () => store.get());

  registerIpc();
  wireEventSources();
  // Forward relay status updates to the renderer. Set up here (post-construct)
  // because wireEventSources runs before `relay` is assigned.
  relay.on('status', (s) => win?.webContents.send(IPC.RELAY_STATUS, s));

  // Forward all speech-to-text events from the recognizer to the renderer.
  // The renderer drives UI state from these (ready -> show "listening",
  // phrase -> populate textarea, error/fatal -> revert + show message).
  stt.on('event', (e) => win?.webContents.send(IPC.STT_EVENT, e));
  stt.on('stopped', () => {
    win?.webContents.send(IPC.STT_EVENT, { event: 'stopped' });
    if (dictationOn) {
      dictationOn = false;
      pushOverlayState();
    }
  });

  // ---- SteamVR overlay control panel: clicks -> app actions ----
  overlay.on('ready', () => pushOverlayState());
  overlay.on('click', (id: string) => {
    if (id.startsWith('status:')) {
      void engine.run({ kind: 'setStatus', statusId: id.slice('status:'.length) });
    } else if (id === 'action:clearPins') {
      engine.clearAllPins();
      pushOverlayState();
    } else if (id === 'action:dictate') {
      if (dictationOn) stopDictation();
      else startDictation();
    }
  });

  // VRCOSC-style voice commands: match STT phrases against the user table.
  voiceMatcher = new VoiceCommandMatcher(
    () => store.get().voiceCommands,
    async (actions, _src) => {
      try {
        await engine.runSequence(actions as Action[]);
      } catch (e) {
        log.warn('[voice] runSequence failed:', (e as Error).message);
      }
    },
  );
  stt.on('event', (e) => {
    if (e && (e as { event?: string }).event === 'phrase') {
      const text = (e as { text?: string }).text ?? '';
      voiceMatcher?.feed(text);
    }
  });

  // Whisper engine — share the STT_EVENT channel and feed voice commands
  // identically so the renderer (and voice matcher) don't care which engine
  // produced the phrase.
  whisperRec.on('event', (e) => {
    win?.webContents.send(IPC.STT_EVENT, e);
    if (e && (e as { event?: string }).event === 'phrase') {
      const text = (e as { text?: string }).text ?? '';
      voiceMatcher?.feed(text);
    }
  });
  whisperRec.on('stopped', () => {
    win?.webContents.send(IPC.STT_EVENT, { event: 'stopped' });
    if (dictationOn) {
      dictationOn = false;
      pushOverlayState();
    }
  });
  // Download progress -> renderer.
  whisperDl.on('event', (e) => win?.webContents.send(IPC.WHISPER_DOWNLOAD_EVENT, e));

  // Apply AFK source preference now and on every save (settings 'save' below).
  afkDet.setSource(settings.afk?.source);
  afkDet.setRemoteTarget(isRemoteHost(settings.osc.ip));

  osc.configure(settings.osc); // begin listening immediately for audio params
  osc.setChatboxFont((settings.chatboxFont ?? 'plain') as any);
  osc.setChatboxMarkdown(!!settings.chatboxMarkdown);
  osc.setExternalChatbox(!!settings.externalChatbox);
  osc.setChatboxPill(!!settings.chatboxPill);
  osc.setPillMethod(settings.pillMethod);
  setConn({ health: 'connected', lastOkAt: Date.now() });
  createWindow();
  ensureTray();
  startTelemetryStream();

  // Scheduled-send tick. 5s resolution is plenty for human-scale delays;
  // the entry survives restarts because it lives in settings.
  scheduleTimer = setInterval(async () => {
    const cur = store.get();
    const due = (cur.scheduled ?? []).filter((s) => s.fireAt <= Date.now());
    if (due.length === 0) return;
    const remaining = (cur.scheduled ?? []).filter((s) => s.fireAt > Date.now());
    try {
      await store.save({ ...cur, scheduled: remaining });
    } catch (e) {
      log.warn('[schedule] save remaining failed', e);
    }
    for (const item of due) {
      try {
        await engine.run({ kind: 'sendText', text: item.text });
        log.info(`[schedule] fired "${item.text}"`);
      } catch (e) {
        log.warn('[schedule] fire failed', e);
      }
    }
  }, 5000);

  // Scheduled status-by-time. Checks once every 20s; fires each enabled entry
  // exactly once when the local clock reaches its HH:MM (edge-triggered via
  // lastScheduledStatusMinute so a 20s cadence can't double-fire within the
  // same minute).
  scheduledStatusTimer = setInterval(() => {
    const cur = store.get();
    const list = cur.scheduledStatuses ?? [];
    if (list.length === 0) return;
    const d = new Date();
    const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    if (hhmm === lastScheduledStatusMinute) return; // already handled this minute
    lastScheduledStatusMinute = hhmm;
    for (const entry of list) {
      if (!entry.enabled || entry.time !== hhmm) continue;
      const status = cur.statuses.find((s) => s.id === entry.statusId);
      if (!status) continue;
      void engine.run({ kind: 'setStatus', statusId: entry.statusId });
      log.info(`[schedule-status] ${hhmm} → ${status.label}`);
    }
  }, 20_000);

  registerHotkeys();
  startRefreshLoop();
  autoResponder.start();
  if (resolveRelayConfig(settings).enabled) relay.start();
  if (settings.vrchatLog?.enabled) vrchatLog.start();

  // Auto-start/stop the live loop with VRChat.exe. Only a loop the watcher
  // itself started is stopped on game exit — a manual Start stays running
  // (e.g. users who target a remote Quest and never run VRChat locally).
  vrchatWatch.on('started', () => {
    if (store.get().autoStartWithVrchat !== true) return;
    if (!liveTimer) {
      log.info('[vrchatWatch] VRChat launched — auto-starting live updates');
      liveAutoStartedByVrchat = true;
      startLive(store.get(), true);
    }
  });
  vrchatWatch.on('stopped', () => {
    if (liveAutoStartedByVrchat && liveTimer) {
      log.info('[vrchatWatch] VRChat exited — stopping live updates');
      explicitLive = false;
      stopLive();
    }
    liveAutoStartedByVrchat = false;
  });
  reconfigureVrchatWatch(settings);
  reconfigureOverlay(settings);
  discord.on('status', (s: { state: string; error: string }) =>
    win?.webContents.send(IPC.DISCORD_STATUS, s),
  );
  reconfigureDiscord(settings);

  // Background update checks (packaged builds with a real feed only): once
  // shortly after launch, then every 4 hours. Nothing downloads without the
  // user clicking — the renderer shows a banner when an update is available.
  if (updaterConfigured()) {
    setTimeout(() => void checkForUpdate(), 20_000);
    setInterval(() => void checkForUpdate(), 4 * 60 * 60_000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  // Keep the app alive in the tray ONLY when close-to-tray is actually
  // enabled. Previously this checked only `tray exists`, which is always
  // true — so the app stayed running headless even with close-to-tray
  // off, and could never be quit by closing the window (the root of the
  // "cannot be closed / failed to uninstall" install-lock errors).
  const keepAlive =
    !isQuitting && tray && !tray.isDestroyed() && store.get().ui?.closeToTray !== false;
  if (keepAlive) return;

  stopLive();
  stopRefreshLoop();
  autoResponder?.stop();
  relay?.stop();
  vrchatWatch.stop();
  overlay.stop();
  discord.stop();
  if (discordTimer) {
    clearInterval(discordTimer);
    discordTimer = null;
  }
  stt.stop();
  telemetryStop();
  if (scheduleTimer) {
    clearInterval(scheduleTimer);
    scheduleTimer = null;
  }
  if (scheduledStatusTimer) {
    clearInterval(scheduledStatusTimer);
    scheduledStatusTimer = null;
  }
  engine?.stopTimeline();
  globalShortcut.unregisterAll();
  osc.close();
  if (process.platform !== 'darwin') app.quit();
});

// Make sure the tray icon goes away when the app really quits.
app.on('before-quit', () => {
  isQuitting = true;
});
app.on('quit', () => {
  if (tray && !tray.isDestroyed()) tray.destroy();
  tray = null;
});
