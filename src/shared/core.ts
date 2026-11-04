// ============================================================================
// Phase 1 core architecture: Actions, State, Profiles, Macros, Safety.
// These types are shared between the main and renderer processes.
// ============================================================================

/** A user status. Extensible — these are just the built-in defaults. */
export type StatusId = string;

export interface StatusDef {
  id: StatusId;
  label: string; // e.g. "AFK"
  icon: string; // emoji or short glyph
  /** Optional chatbox text auto-shown while this status is active. */
  text?: string;
}

// ----------------------------------------------------------------------------
// ACTION SYSTEM (spec §6) — every button/phrase/hotkey/macro step is an Action.
// One dispatcher in the main process executes these.
// ----------------------------------------------------------------------------

export type Action =
  // bypassDedupe: used by StatusRelay's keep-alive — re-send the *same* text
  // every keepAliveMs so VRChat's chatbox doesn't time out. SafetyGuard
  // normally drops identical sends; this flag lets the relay opt out.
  // pinKey: optional identity for the pinned-cycle slot. Defaults to
  // 'manual' (so manual sends share one slot — typing replaces the
  // previous manual line). Phrases pass 'phrase:<id>' so each phrase
  // gets its own slot and can be toggled on/off independently.
  // noPin: force the one-shot path even when pinSentMessages is on. Used
  // by keep-alive style re-senders (refresh loop) whose text is already
  // pinned under its real key — without this, their pin-key-less re-send
  // would land in the default 'manual' slot and DUPLICATE the entry.
  | { kind: 'sendText'; text: string; bypassDedupe?: boolean; pinKey?: string; noPin?: boolean }
  | { kind: 'setStatus'; statusId: StatusId }
  | {
      kind: 'setParameter';
      address: string;
      value: number | boolean;
      valueType: 'int' | 'float' | 'bool';
    }
  | { kind: 'clearChatbox' }
  | { kind: 'setVariable'; name: string; value: string }
  | { kind: 'switchProfile'; profileId: string }
  | { kind: 'runMacro'; macroId: string }
  | { kind: 'runTimeline'; timelineId: string }
  | { kind: 'delay'; ms: number };

export interface ActionResult {
  ok: boolean;
  error?: string;
  /** Human-readable description for the history log. */
  describe: string;
}

// ----------------------------------------------------------------------------
// QUICK PHRASES (spec §3) — folder-organized, favoritable, hotkey-bindable.
// ----------------------------------------------------------------------------

export interface QuickPhrase {
  id: string;
  label: string; // button label
  /** The actions this phrase triggers (usually one sendText, but can chain). */
  actions: Action[];
  folderId: string | null;
  favorite: boolean;
  /** Per-phrase global hotkey accelerator, e.g. "Ctrl+Alt+1". */
  hotkey?: string;
  /** Per-action cooldown in ms (anti-spam). */
  cooldownMs?: number;
  /** Usage tracking for smart sorting. */
  useCount: number;
  lastUsed: number; // epoch ms
  /** Free-form tags ("greeting", "afk", "joke"). Used for filter chips and
   *  the search bar in the Control tab's Quick Phrases section. */
  tags?: string[];
  /** Optional accent color for the chip (CSS hex / color string). */
  color?: string;
}

export interface PhraseFolder {
  id: string;
  name: string;
  color?: string;
}

// ----------------------------------------------------------------------------
// MACRO SYSTEM (spec §7) — chained action sequences with delays.
// ----------------------------------------------------------------------------

export interface Macro {
  id: string;
  name: string;
  steps: Action[]; // executed in order; 'delay' steps pause the chain
  hotkey?: string;
}

// ----------------------------------------------------------------------------
// TIMELINE SYSTEM (spec §8) — simulated text "animation" via timed swaps.
// ----------------------------------------------------------------------------

export interface TimelineFrame {
  text: string;
  /** How long to hold this frame before advancing, in ms. */
  holdMs: number;
}

export interface Timeline {
  id: string;
  name: string;
  frames: TimelineFrame[];
  loop: boolean;
}

// ----------------------------------------------------------------------------
// PROFILES (spec §2, §5) — a profile owns its endpoint + content + defaults.
// ----------------------------------------------------------------------------

export interface DeviceProfile {
  id: string;
  name: string; // "PC", "Quest", custom
  osc: {
    ip: string;
    port: number;
    listenPort: number;
  };
  defaultStatusId: StatusId;
  /** Hotkey to switch TO this profile. */
  hotkey?: string;
  /** Optional emoji shown next to the profile name in the Control header. */
  icon?: string;
  /** Optional accent color for the profile chip (CSS color string). */
  color?: string;
}

// ----------------------------------------------------------------------------
// SAFETY / ANTI-SPAM (spec §13) + REFRESH LOOP (§14A)
// ----------------------------------------------------------------------------

export interface SafetyConfig {
  enabled: boolean;
  /** Global max messages per second across all sends. */
  globalRatePerSec: number;
  /** Default per-action cooldown if a phrase doesn't specify one. */
  defaultCooldownMs: number;
  /** Drop identical consecutive sends within this window. */
  dedupeWindowMs: number;
}

export interface RefreshLoopConfig {
  enabled: boolean;
  /** Re-send current state every N seconds (10–12 recommended). */
  intervalSec: number;
}

// ----------------------------------------------------------------------------
// PERSISTENT STATE (spec §5) — survives across actions until changed.
// ----------------------------------------------------------------------------

/** One pinned chatbox line. Multiple may be active at once; the live
 *  cycle renders each on its own row. `key` is a stable identity so the
 *  renderer can show on/off state for the source button (status row,
 *  phrase grid). Examples: 'status:talking', 'phrase:p_brb', 'manual'. */
export interface PinnedItem {
  key: string;
  text: string;
}

export interface AppState {
  currentStatusId: StatusId;
  activePhraseId: string | null;
  lastSentText: string;
  lastSentAt: number;
  /** Set of currently-pinned cycle items. Replaces the old single
   *  lastSentText pin so the user can toggle multiple statuses / phrases
   *  on at the same time. Optional for back-compat with older saved
   *  AppState shapes; main treats undefined as empty. */
  pinnedItems?: PinnedItem[];
  /** Runtime variables for {name}-style substitution (spec §4). */
  variables: Record<string, string>;
}

// ----------------------------------------------------------------------------
// HISTORY / LOG (spec §11)
// ----------------------------------------------------------------------------

export interface HistoryEntry {
  at: number;
  describe: string;
  text?: string;
  ok: boolean;
}

// ----------------------------------------------------------------------------
// CONNECTION HEALTH (spec §12)
// ----------------------------------------------------------------------------

export type ConnHealth = 'connected' | 'reconnecting' | 'error' | 'idle';

export interface ConnStatus {
  health: ConnHealth;
  lastError?: string;
  /** Last time we successfully sent, epoch ms. */
  lastOkAt: number;
  /** Recent inbound OSC params for the live monitor. */
  monitor: { address: string; value: string; at: number }[];
}

// ----------------------------------------------------------------------------
// UI / LAUNCH MODES (spec §1, §9)
// ----------------------------------------------------------------------------

export type LaunchMode = 'desktop' | 'vr';

export interface UiModes {
  launchMode: LaunchMode;
  compact: boolean; // dense layout for in-game multitasking
  streamer: boolean; // streamer-friendly layout
  oled: boolean; // pure-black, low glow
  acrylic: boolean; // transparent/blur window
  minimalUi: boolean; // hide non-essential chrome
  /** When true, closing the window hides it to the system tray instead of
   *  quitting the app. Right-click the tray icon to fully quit. */
  closeToTray: boolean;
}

// ----------------------------------------------------------------------------
// AUTOMATION (spec §14C) — auto AFK responder
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// STATUS RELAY (HUD-style rotating chatbox)
// ----------------------------------------------------------------------------

/** A slot in the relay's rotation. Each kind has a built-in producer
 *  (see relay.ts). 'custom' lets users pin a free-text slot. */
export type RelaySlotKind =
  | 'pcMetrics'
  | 'audioStatus'
  | 'nowPlaying'
  | 'currentStatus' // The user's active status (Available/AFK/Busy/...).
  | 'custom';

export interface RelaySlot {
  id: string;
  kind: RelaySlotKind;
  enabled: boolean;
  /** Override the relay's defaultHoldMs for this slot only. */
  holdMs?: number;
  /** For 'custom' only. Ignored for built-in producers. */
  text?: string;
}

export interface RelayConfig {
  enabled: boolean;
  /** Default time each slot occupies the chatbox before rotating. */
  defaultHoldMs: number;
  /** Re-send the active line after this long with no other writes, so the
   *  VRChat chatbox doesn't auto-clear. ~6000 is safe (chatbox clears ~20s). */
  keepAliveMs: number;
  slots: RelaySlot[];
  /** Battery percentage at/below which an alert fires. */
  batteryCriticalPct: number;
}

export type AlertPriority = 'critical' | 'normal';

export interface RelayAlert {
  id: string;
  priority: AlertPriority;
  text: string;
  /** Total time the alert occupies the chatbox before expiring. */
  holdMs: number;
  /** Epoch ms when this alert should stop being shown. */
  expiresAt: number;
}

/** Pushed to the renderer so the UI can show "currently displaying X". */
export interface RelayStatus {
  enabled: boolean;
  activeSlotId: string | null;
  activeText: string;
  alertCount: number;
  lastSentAt: number;
}

export interface AutoResponderConfig {
  enabled: boolean;
  /** Minutes of inactivity (or mute) before auto-AFK fires. */
  afterMin: number;
  /** Trigger on mute as well as idle. */
  onMute: boolean;
  message: string;
}

/** Updater state surfaced to the UI (spec §2). */
export interface UpdateStatus {
  checking: boolean;
  available: boolean;
  currentVersion: string;
  latestVersion?: string;
  notes?: string;
  error?: string;
  /** False when this build has no real update feed (dev, or placeholder repo). */
  configured?: boolean;
  /** Download in progress, with 0-100 percent. */
  downloading?: boolean;
  percent?: number;
  /** Update downloaded and ready — "Restart to update" installs it. */
  downloaded?: boolean;
}
