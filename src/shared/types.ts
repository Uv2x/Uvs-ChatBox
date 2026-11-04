// Shared type definitions used across the main and renderer processes.

import type {
  QuickPhrase,
  PhraseFolder,
  Macro,
  Timeline,
  DeviceProfile,
  StatusDef,
  SafetyConfig,
  RefreshLoopConfig,
  AppState,
  UiModes,
  AutoResponderConfig,
  RelayConfig,
} from './core';

export * from './core';

/** Where messages are routed. */
export type SendTarget = 'desktop' | 'vr' | 'both';

export interface OscSettings {
  ip: string;
  port: number;
  /** Local UDP port to LISTEN on for inbound VRChat OSC (avatar params). */
  listenPort: number;
  /** Send messages immediately (true) or open VRChat keyboard (false). */
  sendImmediately: boolean;
  /** Play the VRChat notification sound on send. */
  playSound: boolean;
  /** Desktop / VR / both routing. */
  target: SendTarget;
}

export type ModuleId =
  | 'media'
  | 'clock'
  | 'pcComponents' // Combined CPU/GPU/RAM/VRAM line (replaces cpu+gpu+ram)
  | 'network'
  | 'custom'
  | 'audiostatus' // Mute/Deaf alert
  | 'afk' // Smart AFK detector
  | 'timezone' // Timezone converter for friends
  | 'vrchat' // VRChat output-log: world, instance type, player count
  | 'weather' // Weather module (ported from VRCOSC) — Open-Meteo, no API key
  | 'battery' // PC / laptop battery percent + charging state
  | 'session'; // "in VR 2h 14m" — time since VRChat.exe launched

export interface ModuleConfig {
  id: ModuleId;
  enabled: boolean;
  /** Display order (lower comes first). */
  order: number;
  /** Per-module formatting template, e.g. "🎵 {title} - {artist}". */
  template?: string;
}

export interface TimezoneEntry {
  /** IANA zone, e.g. "Europe/Berlin". */
  zone: string;
  /** Short label, e.g. "EU". */
  label: string;
}

export interface AppSettings {
  osc: OscSettings;
  modules: ModuleConfig[];
  /** Seconds between automatic chatbox updates when in "live" mode. */
  updateIntervalSec: number;
  /** Use 24-hour clock format. */
  clock24h: boolean;
  /** Custom free-text line the user can pin. */
  customText: string;

  /** ---- Audio status (mute/deaf) ---- */
  audioStatus: {
    /** Announce audio status changes as a brief notification line. */
    notify: boolean;
    mutedLabel: string;
    unmutedLabel: string;
    deafLabel: string;
  };

  /** ---- AFK detector ---- */
  afk: {
    /** Idle seconds before considered AFK. */
    thresholdSec: number;
    label: string;
    /** AFK source (ported from VRCOSC):
     *   'vrchat'  — listen for /avatar/parameters/AFK (VRChat's in-game AFK)
     *   'idle'    — Win32 GetLastInputInfo idle threshold (legacy)
     *   'auto'    — prefer VRChat AFK when seen this session, otherwise idle */
    source?: 'vrchat' | 'idle' | 'auto';
  };

  /** ---- Weather module (ported from VRCOSC) ---- */
  weather?: {
    enabled: boolean;
    /** Free-text query: postcode, zip, or city name. */
    query: string;
    /** 'C' = celsius display, 'F' = fahrenheit. */
    unit: 'C' | 'F';
    /** When true, ignore `query` and auto-detect location from the user's
     *  IP address (no manual city entry, no OS location permission). */
    auto?: boolean;
  };

  /** ---- Voice Commands (ported from VRCOSC) ----
   * Each entry: when the STT engine yields a phrase containing `match` (case-
   * insensitive, after the wake word is stripped), the listed `actions` fire. */
  voiceCommands?: {
    enabled: boolean;
    /** Wake word that prefixes commands. Same as ai.wakeWord by convention. */
    wakeWord: string;
    /** Match table. `match` is a substring; `actions` reuse the standard
     *  action shape (sendText / setStatus / clearChatbox / runMacro / …). */
    commands: Array<{ id: string; match: string; actions: unknown[] }>;
  };

  /** ---- ChatBox Clip system (ported from VRCOSC's ChatBox animation) ----
   *  When enabled, the live loop EVALUATES clips every tick: the highest-
   *  priority enabled clip whose `condition` is truthy wins and its rendered
   *  text becomes the chatbox payload (instead of the legacy stack of
   *  module lines). This is the VRCOSC ChatBox model in miniature — clips
   *  compete by priority, the winner displays. Conditions reuse the same
   *  expression DSL as conditional templates ({if expr}…{/if}). */
  chatboxClips?: {
    enabled: boolean;
    /** How many seconds each clip evaluation cycle takes. Default 4. */
    tickSec: number;
    clips: Array<{
      id: string;
      label: string;
      /** Template text (full template DSL allowed). */
      text: string;
      /** Higher wins. Ties broken by array order. */
      priority: number;
      enabled: boolean;
      /** Optional expression evaluated by the template DSL; empty = always
       *  eligible. Examples: "musicPlaying", "afk", "cpuLoad > 80". */
      condition?: string;
    }>;
  };

  /** ---- Whisper STT engine (ported from VRCOSC) ----
   *  Switches the speech-to-text backend. 'uwp' uses the existing Windows
   *  UWP SpeechRecognizer (fast, online-policy required). 'whisper' uses a
   *  local whisper.cpp binary + GGML model — fully offline, more accurate
   *  but the user must install the binary and download a model. */
  sttEngine?: 'uwp' | 'whisper';
  whisper?: {
    binPath: string;
    modelPath: string;
    modelChoice: 'tiny' | 'tiny.en' | 'base' | 'base.en' | 'small' | 'small.en' | 'custom';
    language: string;
  };

  /** ---- Timezones ---- */
  timezones: TimezoneEntry[];
  /** Seconds each timezone is shown before cycling to the next. */
  timezoneCycleSec: number;

  /** ---- PC components ---- */
  pcComponents: {
    /** When true, the chatbox shows CPU/GPU model strings (e.g. "RTX 5060
     *  Ti") alongside utilization. When false, just percentages/temps. */
    showNames: boolean;
    /** Per-component visibility. Disable individual items (e.g. only show GPU). */
    showCpu: boolean;
    showGpu: boolean;
    showRam: boolean;
    showVram: boolean;
  };

  /** ---- Appearance ---- */
  appearance: {
    /** Theme id from the THEMES list, or 'custom' to use customColors. */
    theme: string;
    /** Custom background image/GIF as a data URL; empty = none. */
    backgroundData: string;
    /** Background opacity 0-1. */
    backgroundOpacity: number;
    /** Background blur in px. */
    backgroundBlur: number;
    /** User-defined color palette. Used when `theme === 'custom'`. Keys
     *  match the CSS variable names in styles.css (e.g. '--accent'). */
    customColors?: Record<string, string>;
    /** Power-user free-form CSS injected into the renderer via a <style>
     *  tag. Applied AFTER the bundled styles, so it can override anything.
     *  Capped at a sane length so a settings.json import can't bloat the
     *  app. Empty/undefined = no injection. */
    customCss?: string;
  };

  // ===== Phase 1+ automation suite =====

  /** Status definitions (AFK, Busy, Gaming, …). */
  statuses: StatusDef[];

  /** Device/setup profiles (PC, Quest, custom). */
  profiles: DeviceProfile[];
  activeProfileId: string;

  /** Quick-phrase library + folders. */
  phrases: QuickPhrase[];
  folders: PhraseFolder[];

  /** Macro + timeline libraries. */
  macros: Macro[];
  timelines: Timeline[];

  /** Anti-spam + refresh loop. */
  safety: SafetyConfig;
  refreshLoop: RefreshLoopConfig;

  /** Persistent runtime state. */
  state: AppState;

  /** UI / launch modes. */
  ui: UiModes;

  /** Auto AFK responder. */
  autoResponder: AutoResponderConfig;

  /** Per-feature master toggles (everything modular). */
  featureToggles: Record<string, boolean>;

  /** HUD-style status rotation; see relay.ts. Optional for back-compat. */
  relay?: RelayConfig;

  /** Scheduled send-later queue. Each entry fires its `text` through the
   *  engine at `fireAt` (epoch ms). Persisted so the queue survives a
   *  restart; the main process processes it on a 5s tick. */
  scheduled?: { id: string; text: string; fireAt: number }[];

  /** Start the live-updates loop automatically when VRChat.exe launches,
   *  and stop it again when the game exits (only if this feature was the
   *  thing that started it — a manual Start is never auto-stopped). */
  autoStartWithVrchat?: boolean;

  /** Optional explicit path to adb.exe for reading Quest headset battery.
   *  Empty = auto-detect (platform-tools / SideQuest / PATH). */
  questAdbPath?: string;

  /** Discord Rich Presence via the local Discord client. Needs a free Discord
   *  application id (clientId) — its app name is the "Playing X" line. */
  discord?: {
    enabled: boolean;
    /** Discord Application (client) ID from the Developer Portal. */
    clientId: string;
    /** Line 1 template. Tokens: {world} {instanceType} {players} {status}
     *  {title} {artist} {session} {time}. */
    details: string;
    /** Line 2 template (same tokens). */
    state: string;
    /** Show an elapsed timer counting from when VRChat launched. */
    showElapsed: boolean;
    /** Optional art asset key uploaded in the Discord app (Rich Presence art). */
    largeImageKey: string;
    largeImageText: string;
  };

  /** SteamVR control overlay — laser-clickable buttons for status, clear-pins,
   *  and dictation. PCVR only. */
  vrOverlay?: {
    enabled: boolean;
    /** Status ids to show as buttons (max 6). Empty = first 6 statuses. */
    statusIds?: string[];
    /** 'dashboard' = a tab in the SteamVR dashboard; 'wrist' = a small panel
     *  attached to a controller, always visible. */
    mode?: 'dashboard' | 'wrist';
    /** Wrist mode: which controller to attach to. */
    hand?: 'left' | 'right';
    /** Wrist panel width in cm. */
    sizeCm?: number;
    /** Wrist placement, all tunable live in-headset. */
    tiltDeg?: number;
    upCm?: number;
    fwdCm?: number;
    rightCm?: number;
  };

  /** SteamVR in-headset notification toasts (IVRNotifications). PCVR only —
   *  needs SteamVR running (Link / Air Link / Virtual Desktop). */
  vrNotifications?: {
    enabled: boolean;
    /** Toast when the current status changes. */
    onStatusChange: boolean;
    /** Toast when a VR device drops below `lowBatteryPct` (not charging). */
    onLowBattery: boolean;
    lowBatteryPct: number;
    /** How long each toast stays visible, in seconds (2–20). */
    durationSec: number;
  };

  /** Active AI Personality preset id (see shared/personas.ts).
   *  Drives quick-phrase pack hints, auto-responder template, status text
   *  variants, and (future) AI Companion tone. Optional for back-compat. */
  activePersonaId?: string;

  /** Live lyrics — when on, the live loop appends the current synced lyric
   *  line under the Now-Playing chatbox line. Independent of StatusRelay. */
  liveLyrics?: {
    enabled: boolean;
    /** Append a romanized (kana→romaji) line under the original. */
    romaji?: boolean;
    /** Translate the current line and append it (uses the free gateway). */
    translate?: boolean;
    /** Target language for lyric translation (ISO code, e.g. 'en'). */
    translateLang?: string;
    /** Minimum seconds between lyric chatbox updates (default 2). Keeps the
     *  lyric line refreshing at a steady pace and under VRChat's chatbox
     *  rate limit, which silently drops bursts of fast sends. */
    intervalSec?: number;
  };

  /** Markdown-ish Unicode text effects on every outgoing chatbox line:
   *  *bold* _italic_ ~strike~. Default off. */
  chatboxMarkdown?: boolean;

  /** Now-Playing progress bar. Rendered by the {bar} / {time} / {elapsed}
   *  / {total} tokens in the media module template — the bar only shows
   *  when the user actually puts a token in their template. */
  mediaProgress?: {
    style: 'knob' | 'blocks' | 'dots' | 'arrow' | 'brackets' | 'moons';
    /** Bar width in segments (3–20). Default 8. */
    width: number;
  };

  /** Scheduled status by time-of-day. At the given local HH:MM, the engine
   *  sets `statusId`. Edge-triggered (fires once per matching minute). */
  scheduledStatuses?: Array<{
    id: string;
    /** 24h "HH:MM" local time. */
    time: string;
    statusId: string;
    enabled: boolean;
  }>;

  /** Secondary chatbox line cycler — rotates a SECOND row of content
   *  through a subset of modules at a faster interval than the main loop.
   *  Sent as `<main>\n<secondary>` in /chatbox/input. */
  secondaryCycle?: {
    enabled: boolean;
    /** How fast the secondary row rotates between its modules, in seconds. */
    intervalSec: number;
    /** Module ids to cycle through. Order = cycle order. */
    moduleIds: ModuleId[];
  };

  /** VRChat output-log tailer config. When enabled, main parses the
   *  rolling output_log_*.txt and exposes new template tokens. */
  vrchatLog?: { enabled: boolean };

  /** When true (default), every manually-sent message is pinned to the
   *  live-cycle: the live loop prepends it as a chatbox line on every tick
   *  so it never "fades away" the way a one-shot send does (VRChat's
   *  chatbox clears itself after ~20s without writes). Disable to go
   *  back to one-shot send behavior. */
  pinSentMessages?: boolean;

  /** Auto-translate every outgoing chatbox message to the target language
   *  before sending. Uses the free Google Translate gateway. */
  translate?: {
    enabled: boolean;
    /** ISO target language code, e.g. 'en', 'ja', 'ar', 'es'. */
    targetLang: string;
    /** 'replace' = send only the translation;
     *  'bilingual' = send original + \\n + translation. */
    mode: 'replace' | 'bilingual';
  };

  /** Simple Mode: hides advanced tabs / panels and shows only the
   *  essentials (chatbox input, phrases, statuses). Reversible toggle. */
  simpleMode?: boolean;

  /** User-chosen order of the Features sidebar list (array of feature ids).
   *  Ids missing from the list fall to the end in their natural order.
   *  Undefined = default order. */
  featureOrder?: string[];

  /** Saved manual messages — persisted so composed one-liners survive a
   *  restart and can be re-sent with one click from the Control composer. */
  savedMessages?: { id: string; text: string }[];

  /** When true (default), multiple pinned items (statuses / phrases /
   *  manual) ROTATE one at a time on the chatbox instead of stacking as
   *  separate lines. Off = legacy stacked behavior (all shown at once). */
  pinRotate?: boolean;
  /** Seconds each pinned item is shown before rotating to the next.
   *  Default 5. */
  pinRotateSec?: number;
  /** When true, rotation picks a RANDOM pinned item every interval
   *  instead of advancing sequentially. Default OFF. */
  pinShuffle?: boolean;
  /** Hard cap on how many statuses can be pinned at once. Default 10.
   *  Tracked here so users can raise/lower it without code changes. */
  pinStatusMax?: number;
  /** Hard cap on how many distinct manual messages can be pinned at once.
   *  Default 10. When exceeded, the OLDEST manual pin is evicted (LRU) so
   *  the latest send always wins a slot. */
  pinManualMax?: number;

  /** Unicode font style applied to every outgoing chatbox line.
   *  'plain' | 'small-caps' | 'fullwidth'. See src/main/fontTransformer.ts. */
  chatboxFont?: string;

  /** When true, this app stops sending /chatbox/input entirely so another
   *  tool (Magic Chatbox, etc.) can own the in-VRChat chatbox display.
   *  Avatar parameters, status tracking, AI features, monitoring, and the
   *  rest of the app keep working — only the chatbox text channel is
   *  silenced. Persisted setting; survives restart. */
  externalChatbox?: boolean;

  /** Apply a minimal-background ("pill") trick to every chatbox send. All
   *  unofficial; the classic one broke with VRChat's Unity 6 client. */
  chatboxPill?: boolean;
  /** Which pill variant to use (see OscManager.applyPill). Default 'vrcosc'. */
  pillMethod?: PillMethod;

  /** Anthropic / Claude AI integration. Off by default — user pastes an
   *  API key in Settings → AI to enable. Used by line generation,
   *  persona auto-reply, STT cleanup, phrase suggestions, and voice
   *  command. All calls go through src/main/ai.ts. */
  ai?: {
    enabled: boolean;
    apiKey: string;
    /** Model id. 'claude-opus-4-7' default, 'claude-haiku-4-5' for cost. */
    model: string;
    features: {
      generateLine: boolean;
      personaReply: boolean;
      cleanupStt: boolean;
      suggestPhrase: boolean;
      voiceCommand: boolean;
    };
    wakeWord: string;
    persona: string;
  };
}

export interface MediaInfo {
  playing: boolean;
  title: string;
  artist: string;
  album: string;
  position?: number;
  duration?: number;
  /** Base64-encoded PNG/JPEG of the track's thumbnail, when the media
   *  source provides one (Spotify usually does; YouTube via browser
   *  sometimes does). Already a data-URL-ready string (no "data:" prefix). */
  thumbnailBase64?: string;
}

export interface SystemStats {
  cpuLoad: number;
  cpuTemp?: number;
  ramUsed: number;
  ramTotal: number;
  gpuLoad?: number;
  gpuTemp?: number;
  /** GPU dedicated VRAM in GB, when reported by the driver. */
  vramTotal?: number;
  netDownMbps?: number;
  netUpMbps?: number;
  /** Human-readable hardware model strings (e.g. "RTX 5060 Ti"). Surfaced
   *  via the optional {cpuName} / {gpuName} template tokens. */
  cpuName?: string;
  gpuName?: string;
}

/** Mute/deaf state derived from inbound avatar parameters. */
export interface AudioStatus {
  muted: boolean;
  deafened: boolean;
  /** epoch ms of last change, for transient notifications. */
  changedAt: number;
}

/** A single VR device battery reading. */
export interface BatteryDevice {
  kind: 'hmd' | 'controller' | 'tracker' | 'other';
  name: string;
  /** 0-100, or -1 if unknown. */
  percent: number;
  charging: boolean;
}

/** One row on the System Check page. 'off' = feature disabled / not
 *  applicable, so it wasn't checked. */
export type HealthStatus = 'ok' | 'warn' | 'error' | 'off';
export interface HealthCheck {
  id: string;
  label: string;
  status: HealthStatus;
  detail: string;
  /** What to do about it (only for warn / error). */
  fix?: string;
}

/** Minimal-background ("pill") chatbox variants — tried in the Pill Lab. */
export const PILL_METHODS = ['legacy', 'vrcosc', 'etx', 'us', 'lsep'] as const;
export type PillMethod = (typeof PILL_METHODS)[number];

export interface BatteryStatus {
  available: boolean;
  devices: BatteryDevice[];
}

/** Result of the Quest headset battery probe over adb. */
export interface QuestAdbState {
  available: boolean;
  percent: number;
  charging: boolean;
  state: 'ok' | 'no-adb' | 'no-device' | 'unauthorized' | 'error';
  detail: string;
}

/** OSC throughput telemetry. */
export interface OscTelemetry {
  /** Messages sent in the last second. */
  sendRate: number;
  /** Messages received in the last second. */
  recvRate: number;
  /** Bytes sent in the last second. */
  bytesOut: number;
  /** Bytes received in the last second. */
  bytesIn: number;
  /** Cumulative totals since launch. */
  totalSent: number;
  totalRecv: number;
  /** Rolling history of send rate for sparkline (most recent last). */
  history: number[];
}

export interface InstanceEvent {
  type: 'join' | 'leave' | 'world' | 'instance';
  detail: string;
  at: number;
}

export interface AfkState {
  afk: boolean;
  idleSec: number;
  /** SteamVR HMD activity, when SteamVR is reachable. Optional for back-compat. */
  hmd?: {
    available: boolean;
    activityLevel: number; // -1 unknown, 0 idle, 1 active, 2 just-active, 3 standby/off-head, 4 idle_timeout
    onHead: boolean;
  };
}

export interface LivePayload {
  media: MediaInfo | null;
  stats: SystemStats | null;
  audio: AudioStatus | null;
  battery: BatteryStatus | null;
  afk: AfkState | null;
  instance: InstanceEvent | null;
  telemetry: OscTelemetry | null;
  time: string;
  preview: string;
}

/** Channel names for IPC between renderer and main. */
export const IPC = {
  GET_SETTINGS: 'settings:get',
  SAVE_SETTINGS: 'settings:save',
  SEND_MESSAGE: 'osc:send',
  SET_TYPING: 'osc:typing',
  CLEAR_CHATBOX: 'osc:clear',
  START_LIVE: 'live:start',
  STOP_LIVE: 'live:stop',
  LIVE_UPDATE: 'live:update',
  TEST_CONNECTION: 'osc:test',
  GET_BATTERY: 'vr:battery',
  GET_TELEMETRY: 'osc:telemetry',
  // ---- Phase 1+ automation ----
  RUN_ACTION: 'action:run',
  RUN_ACTIONS: 'action:runMany',
  RUN_MACRO: 'macro:run',
  RUN_TIMELINE: 'timeline:run',
  STOP_TIMELINE: 'timeline:stop',
  SWITCH_PROFILE: 'profile:switch',
  SET_STATUS: 'status:set',
  GET_STATE: 'state:get',
  STATE_UPDATE: 'state:update',
  GET_HISTORY: 'history:get',
  UNDO_LAST: 'history:undo',
  CONN_UPDATE: 'conn:update',
  REGISTER_HOTKEYS: 'hotkeys:register',
  UI_MODE_UPDATE: 'ui:mode',
  CHECK_UPDATE: 'update:check',
  APPLY_UPDATE: 'update:apply',
  UPDATE_STATUS: 'update:status',
  HOTKEY_FIRED: 'hotkey:fired',
  // ---- Status relay ----
  RELAY_GET_CONFIG: 'relay:getConfig',
  RELAY_SAVE_CONFIG: 'relay:saveConfig',
  RELAY_STATUS: 'relay:status',
  RELAY_FORCE_ADVANCE: 'relay:forceAdvance',
  // ---- Speech to text ----
  STT_START: 'stt:start',
  STT_STOP: 'stt:stop',
  STT_EVENT: 'stt:event', // pushed from main to renderer
  // ---- Shell / Windows ----
  OPEN_WINDOWS_SETTING: 'shell:openWindowsSetting',
  // ---- Media (one-shot snapshot, independent of the live loop) ----
  GET_MEDIA_NOW: 'media:now',
  // ---- AFK live state (one-shot) ----
  GET_AFK_NOW: 'afk:now',
  // ---- Scheduled send queue ----
  SCHEDULE_ADD: 'schedule:add',
  SCHEDULE_REMOVE: 'schedule:remove',
  SCHEDULE_LIST: 'schedule:list',
  // ---- Background-op upgrades ----
  EXPORT_SETTINGS: 'settings:export',
  IMPORT_SETTINGS: 'settings:import',
  RESET_SETTINGS: 'settings:reset',
  SET_LOGIN_ITEM: 'app:setLoginItem',
  GET_LOGIN_ITEM: 'app:getLoginItem',
  QUIT_APP: 'app:quit',
  // ---- Global pause (stop-everything panic switch) ----
  PAUSE_GET: 'pause:get',
  PAUSE_SET: 'pause:set',
  PAUSE_UPDATE: 'pause:update', // pushed to renderer
  // ---- VRChat output-log snapshot ----
  VRCHAT_LOG_GET: 'vrchatLog:get',
  // ---- Settings backups ----
  BACKUPS_LIST: 'backups:list',
  BACKUPS_RESTORE: 'backups:restore',
  // ---- AI (Anthropic / Claude) ----
  AI_TEST: 'ai:test',
  AI_GENERATE_LINE: 'ai:generateLine',
  AI_PERSONA_REPLY: 'ai:personaReply',
  AI_CLEANUP_STT: 'ai:cleanupStt',
  // ---- Ported from VRCOSC: Weather ----
  WEATHER_GET: 'weather:get',
  // ---- Whisper STT (VRCOSC port) ----
  WHISPER_START: 'whisper:start',
  WHISPER_STOP: 'whisper:stop',
  WHISPER_PUSH_PCM: 'whisper:pushPcm',
  WHISPER_DOWNLOAD: 'whisper:download',
  WHISPER_DOWNLOAD_EVENT: 'whisper:downloadEvent',
  WHISPER_STATUS: 'whisper:status',
  // ---- Network reachability test (Quest troubleshooting) ----
  NET_PING: 'net:ping',
  // ---- SteamVR in-headset notifications ----
  VR_NOTIFY_TEST: 'vr:notifyTest',
  // ---- Quest battery over adb ----
  QUEST_BATTERY_RESCAN: 'quest:batteryRescan',
  // ---- Live lyrics source health (LRCLib) ----
  LYRICS_STATUS: 'lyrics:status',
  // ---- Pill Lab: send one test message with a given pill variant ----
  PILL_TEST: 'pill:test',
  // ---- System Check: health of every outside service ----
  SYSTEM_CHECK: 'health:check',
  // ---- Updater: install a downloaded update (quit + run installer) ----
  INSTALL_UPDATE: 'update:install',
  // ---- Discord Rich Presence ----
  DISCORD_GET_STATUS: 'discord:getStatus',
  DISCORD_STATUS: 'discord:status', // pushed to renderer
} as const;

/** Discord presence connection state (mirrors DiscordState in main). */
export type DiscordPresenceState =
  | 'off'
  | 'connecting'
  | 'connected'
  | 'no-client'
  | 'invalid-id'
  | 'error';

export interface SttPhrase {
  text: string;
  /** UWP SpeechRecognitionResultStatus (0 = Success). */
  status: number;
  /** 0=High, 1=Medium, 2=Low, 3=Rejected. */
  confidence: number;
}

export type SttPushEvent =
  | { event: 'ready'; language?: string }
  | { event: 'phrase'; text: string; status: number; confidence: number }
  | { event: 'error'; message: string }
  | { event: 'fatal'; message: string }
  | { event: 'stopped' }
  | { event: 'needs-privacy-accept'; message: string };
