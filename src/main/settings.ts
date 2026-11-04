import { app } from 'electron';
import { promises as fs } from 'fs';
import path from 'path';
import type { AppSettings } from '../shared/types';

const DEFAULTS: AppSettings = {
  osc: {
    ip: '127.0.0.1',
    port: 9000,
    listenPort: 9001,
    sendImmediately: true,
    playSound: false,
    target: 'both',
  },
  modules: [
    { id: 'audiostatus', enabled: true, order: 0, template: '{status}' },
    { id: 'afk', enabled: false, order: 1, template: '{status} ({idle}m)' },
    { id: 'custom', enabled: false, order: 2, template: '{custom}' },
    { id: 'media', enabled: true, order: 3, template: '🎵 {title} — {artist}' },
    { id: 'clock', enabled: true, order: 4, template: '🕐 {time}' },
    { id: 'timezone', enabled: false, order: 5, template: '🌍 {label} {time} {icon}' },
    // Single combined PC line. The pcComponents.showNames toggle controls
    // whether CPU/GPU model names are interpolated; the formatter injects
    // empty strings for {cpuName}/{gpuName} when showNames is false, so the
    // same template works for both modes.
    {
      id: 'pcComponents',
      enabled: false,
      order: 7,
      template:
        '🖥️ {cpuName} {cpuLoad}% | {gpuName} {gpuLoad}% | RAM {ramUsed}/{ramTotal}GB | VRAM {vramTotal}GB',
    },
    { id: 'network', enabled: false, order: 8, template: '↓{netDown} ↑{netUp} Mbps' },
    // VRChat output-log line. Tokens: {world}, {instanceType}, {playerCount},
    // {lastJoin}, {lastLeave}, {avatar}. Disabled by default — enable along
    // with vrchatLog.enabled in Settings for it to populate.
    {
      id: 'vrchat',
      enabled: false,
      order: 9,
      template: '🌐 {world} ({instanceType}) · 👥 {playerCount}',
    },
    // VRCOSC-style modules.
    { id: 'weather', enabled: false, order: 10, template: '🌤️ {city} {temp}° {desc}' },
    { id: 'battery', enabled: false, order: 12, template: '{devices}' },
    { id: 'session', enabled: false, order: 13, template: '⏱️ in VR {session}' },
  ],
  updateIntervalSec: 3,
  clock24h: true,
  customText: '',
  audioStatus: {
    notify: true,
    mutedLabel: '🔇 Muted',
    unmutedLabel: '🔊 Unmuted',
    deafLabel: '🙉 Deafened',
  },
  afk: {
    thresholdSec: 180,
    label: '💤 AFK',
    // VRCOSC-style: prefer VRChat's own /avatar/parameters/AFK signal when
    // we see it; fall back to Win32 idle detection if VRChat AFK never
    // arrives (e.g. avatar without the AFK param). 'auto' is the safe default.
    source: 'auto' as const,
  },

  weather: {
    enabled: false,
    query: '',
    unit: 'C' as const,
  },

  voiceCommands: {
    enabled: false,
    wakeWord: 'uvy',
    commands: [
      { id: 'vc_afk', match: 'set status afk', actions: [{ kind: 'setStatus', statusId: 'afk' }] },
      {
        id: 'vc_busy',
        match: 'set status busy',
        actions: [{ kind: 'setStatus', statusId: 'busy' }],
      },
      { id: 'vc_clear', match: 'clear chatbox', actions: [{ kind: 'clearChatbox' }] },
    ],
  },

  chatboxClips: {
    enabled: false,
    tickSec: 4,
    clips: [],
  },

  // Whisper STT (offline). Default OFF; user picks engine in the Whisper
  // panel and downloads a model. 'uwp' stays the legacy engine.
  sttEngine: 'uwp' as const,
  whisper: {
    binPath: '',
    modelPath: '',
    modelChoice: 'tiny.en' as const,
    language: 'auto',
  },
  timezones: [
    { zone: 'America/New_York', label: 'US East' },
    { zone: 'Europe/Berlin', label: 'EU' },
    { zone: 'Asia/Tokyo', label: 'JP' },
  ],
  timezoneCycleSec: 6,
  pcComponents: {
    showNames: true,
    showCpu: true,
    showGpu: true,
    showRam: true,
    showVram: true,
  },
  appearance: {
    theme: 'obsidian',
    backgroundData: '',
    backgroundOpacity: 0.35,
    backgroundBlur: 3,
  },

  // ===== Phase 1+ automation suite defaults =====
  statuses: [
    { id: 'available', label: 'Available', icon: '🟢' },
    { id: 'afk', label: 'AFK', icon: '💤', text: '💤 AFK' },
    { id: 'busy', label: 'Busy', icon: '⛔', text: '⛔ Busy' },
    { id: 'talking', label: 'Talking', icon: '🗣️', text: '🎤 Talking' },
    { id: 'sleeping', label: 'Sleeping', icon: '😴', text: '😴 Sleeping — see you tomorrow' },
    { id: 'gaming', label: 'Gaming', icon: '🎮', text: '🎮 In Game' },
    { id: 'vrchatVR', label: 'VRChat (VR)', icon: '🥽', text: '🥽 In VRChat (VR)' },
    { id: 'vrchatDesktop', label: 'VRChat (Desktop)', icon: '🖥️', text: '🖥️ In VRChat (Desktop)' },
    { id: 'music', label: 'Music', icon: '🎵', text: '🎵 Listening to music' },
    { id: 'streaming', label: 'Streaming', icon: '🔴', text: '🔴 Live' },
    // Extra pre-made statuses (VRChat-flavored). New ids are auto-injected
    // into existing users' saved settings by merge(), so everyone gets them.
    { id: 'chilling', label: 'Chilling', icon: '😎', text: '😎 Just chilling' },
    { id: 'vibing', label: 'Vibing', icon: '🎧', text: '🎧 Vibing' },
    { id: 'brb', label: 'BRB', icon: '🏃', text: '🏃 BRB' },
    { id: 'lurking', label: 'Lurking', icon: '👀', text: '👀 Lurking' },
    { id: 'newfriends', label: 'New Friends', icon: '🤝', text: '🤝 New friends welcome!' },
    { id: 'cuddles', label: 'Cuddles', icon: '🫂', text: '🫂 Cuddle pile' },
    { id: 'photo', label: 'Photography', icon: '📸', text: '📸 Taking photos' },
    { id: 'exploring', label: 'Exploring', icon: '🗺️', text: '🗺️ Exploring worlds' },
    { id: 'dancing', label: 'Dancing', icon: '💃', text: '💃 Dancing' },
    { id: 'karaoke', label: 'Karaoke', icon: '🎶', text: '🎶 Karaoke night' },
    { id: 'movie', label: 'Movie Night', icon: '🍿', text: '🍿 Movie night' },
    { id: 'eating', label: 'Eating', icon: '🍔', text: '🍔 Eating — brb' },
    { id: 'drink', label: 'Getting a Drink', icon: '☕', text: '☕ Getting a drink' },
    { id: 'working', label: 'Working', icon: '💼', text: '💼 Working' },
    { id: 'studying', label: 'Studying', icon: '📚', text: '📚 Studying' },
    { id: 'tired', label: 'Tired', icon: '🥱', text: '🥱 Tired' },
    { id: 'dnd', label: 'Do Not Disturb', icon: '🚫', text: '🚫 Do Not Disturb' },
    { id: 'meditating', label: 'Meditating', icon: '🧘', text: '🧘 Meditating' },
  ],
  profiles: [
    {
      id: 'pc',
      name: 'PC',
      osc: { ip: '127.0.0.1', port: 9000, listenPort: 9001 },
      defaultStatusId: 'available',
    },
    {
      id: 'quest',
      name: 'Quest',
      osc: { ip: '127.0.0.1', port: 9000, listenPort: 9001 },
      defaultStatusId: 'available',
    },
  ],
  activeProfileId: 'pc',
  // Quick/smart phrases feature removed — no seeded phrases.
  phrases: [],
  folders: [
    { id: 'f_greetings', name: 'Greetings', color: '#46f0c8' },
    { id: 'f_status', name: 'Status', color: '#ff8fb3' },
  ],
  macros: [
    {
      id: 'm_streamer',
      name: 'Streamer Mode',
      steps: [
        { kind: 'setStatus', statusId: 'streaming' },
        { kind: 'sendText', text: '🔴 Now live!' },
        { kind: 'delay', ms: 1500 },
        { kind: 'setVariable', name: 'mode', value: 'streaming' },
      ],
    },
  ],
  timelines: [
    {
      id: 't_loading',
      name: 'Loading…',
      loop: true,
      frames: [
        { text: 'Loading', holdMs: 600 },
        { text: 'Loading.', holdMs: 600 },
        { text: 'Loading..', holdMs: 600 },
        { text: 'Loading...', holdMs: 600 },
      ],
    },
  ],
  safety: {
    enabled: true,
    globalRatePerSec: 3,
    defaultCooldownMs: 1500,
    dedupeWindowMs: 1000,
  },
  refreshLoop: {
    enabled: false,
    intervalSec: 11,
  },
  // Start/stop the live loop with VRChat.exe. Off by default — opt in from
  // Settings so users who target a remote Quest (no local VRChat.exe) are
  // never surprised by it.
  autoStartWithVrchat: false,
  // SteamVR in-headset toasts. Off by default (PCVR-only feature).
  vrNotifications: {
    enabled: false,
    onStatusChange: true,
    onLowBattery: true,
    lowBatteryPct: 20,
    durationSec: 6,
  },
  // Discord Rich Presence. Off by default (needs a user-created client id).
  discord: {
    enabled: false,
    clientId: '',
    details: 'In VRChat',
    state: '{status}',
    showElapsed: true,
    largeImageKey: '',
    largeImageText: "Uv's Chat Box",
  },
  // SteamVR control overlay. Off by default (PCVR-only feature).
  vrOverlay: {
    enabled: false,
    statusIds: [],
    mode: 'dashboard' as const,
    hand: 'left' as const,
    sizeCm: 22,
    tiltDeg: -50,
    upCm: 2,
    fwdCm: 6,
    rightCm: 0,
  },
  state: {
    currentStatusId: 'available',
    activePhraseId: null,
    lastSentText: '',
    lastSentAt: 0,
    variables: { name: 'friend' },
  },
  ui: {
    launchMode: 'desktop',
    compact: false,
    streamer: false,
    oled: false,
    acrylic: false,
    minimalUi: false,
    // Default OFF: clicking X quits the app outright. Leaving this ON was
    // the cause of repeated "cannot be closed / failed to uninstall"
    // install-lock errors — the app kept running in the tray and locked
    // its own .exe. Users who want background operation can opt in via
    // Settings → Background Operation.
    closeToTray: false,
  },
  autoResponder: {
    enabled: false,
    afterMin: 5,
    onMute: false,
    message: '💤 User is currently AFK',
  },
  featureToggles: {
    quickPhrases: true,
    macros: true,
    timelines: true,
    hotkeys: true,
    refreshLoop: false,
    autoResponder: false,
    connectionMonitor: true,
    history: true,
  },
  activePersonaId: 'chill',
  liveLyrics: {
    enabled: false,
    romaji: false,
    translate: false,
    translateLang: 'en',
    // Lyric chatbox updates at most every 2s — steady, and safely under
    // VRChat's chatbox rate limit (bursts of fast sends get dropped).
    intervalSec: 2,
  },
  // Markdown-ish Unicode text effects (*bold* _italic_ ~strike~). Off by default.
  chatboxMarkdown: false,
  // Now-Playing progress bar style/width for the {bar}/{time} media tokens.
  mediaProgress: { style: 'knob' as const, width: 8 },
  // Scheduled status-by-time entries — empty by default.
  scheduledStatuses: [],
  // Auto-translate outgoing chatbox text. Disabled by default; user enables
  // and picks a target language (e.g. 'en', 'ja').
  translate: { enabled: false, targetLang: 'en', mode: 'replace' as const },
  // Simple Mode hides advanced UI; default OFF (full UI).
  simpleMode: false,
  // Saved manual messages — persisted for reuse across restarts.
  savedMessages: [],
  // Multi-line / secondary cycler. When enabled, the live loop composes a
  // SECOND line (separated by \n in the chatbox payload) that rotates
  // through the chosen module ids at a faster interval than the main line.
  // Useful for showing e.g. HR/clock/time alongside the slower main row.
  secondaryCycle: {
    enabled: false,
    intervalSec: 4,
    moduleIds: ['clock', 'audiostatus'],
  },
  // VRChat output-log integration. When enabled, main starts VrchatLog
  // which tails the newest %LOCALAPPDATA%Low\VRChat\...\output_log_*.txt
  // and exposes {world}, {instanceType}, {playerCount}, {lastJoin},
  // {lastLeave}, {avatar} as template tokens for any module.
  vrchatLog: {
    enabled: false,
  },
  // Anthropic / Claude AI client. OFF by default — costs money. User
  // enables in Settings → AI by pasting an API key. Default model is
  // opus-4-7 (per Claude API skill guidance); haiku-4-5 is the cheap
  // alternative the Settings UI exposes.
  ai: {
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
    persona:
      'Casual, friendly, a bit playful. Likes emoji but uses them sparingly. Concise — never more than one short sentence.',
  },
  // Unicode font transform applied to every outgoing chatbox send.
  // 'plain' = no transform; 'thin' = Mathematical Sans-Serif (the
  // Magic-Chatbox-style thin look in VRChat's chatbox). User picks from
  // Settings → Chatbox Font. Default stays 'plain' so legacy users see
  // no change after upgrading.
  // Unicode font style for outgoing chatbox text. Default 'plain' = no
  // transform. Other options: 'small-caps', 'fullwidth'.
  chatboxFont: 'plain',
  // External-chatbox mode: when true, all /chatbox/input sends are
  // suppressed so another tool (e.g. Magic Chatbox) can own the in-VRChat
  // chatbox display. Avatar parameters, status, AI, monitoring all keep
  // working. Default false.
  externalChatbox: false,
  // Minimal-background pill: append U+0003 U+001F to chatbox sends so VRChat
  // draws the slim pill background — the same trick as VRCOSC's "Use Minimal
  // Background". Unofficial (VRChat doesn't document it). Default false.
  chatboxPill: false,
  // Pill variant (Pill Lab letter B). The classic 'legacy' (A) suffix broke
  // with VRChat's Unity 6 client, so default to the VRCOSC-style pipeline.
  pillMethod: 'vrcosc' as const,
  // Pinning manual sends: ON by default per user request. Every text the
  // user types into the manual textarea + sends is also injected as a
  // prepended chatbox line on each live tick, so it doesn't disappear
  // after VRChat's ~20s auto-clear.
  pinSentMessages: true,
  // Rotate pinned items one at a time instead of stacking. Default ON.
  pinRotate: true,
  pinRotateSec: 5,
  // Random pin order each rotation. Default OFF (sequential round-robin).
  pinShuffle: false,
  // Max simultaneous pinned statuses. Default 10 per user request.
  pinStatusMax: 10,
  // Max simultaneous pinned manual messages. Default 10. LRU eviction.
  pinManualMax: 10,
};

export class SettingsStore {
  private file: string;
  private cache: AppSettings = DEFAULTS;

  constructor() {
    this.file = path.join(app.getPath('userData'), 'settings.json');
  }

  async load(): Promise<AppSettings> {
    try {
      const raw = await fs.readFile(this.file, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      this.cache = this.merge(DEFAULTS, parsed);
    } catch {
      this.cache = DEFAULTS;
    }
    return this.cache;
  }

  async save(settings: AppSettings): Promise<void> {
    this.cache = settings;
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(settings, null, 2), 'utf-8');
    // Best-effort snapshot for sleep-easy rollback. Failures here never
    // break a save — backups are convenience-grade.
    void this.snapshot(settings).catch((e) => {
      console.warn('[settings] snapshot failed', e);
    });
  }

  /** Backup directory path. */
  backupsDir(): string {
    return path.join(path.dirname(this.file), 'backups');
  }

  /** Write a timestamped copy of `settings` next to the live file. Keeps
   *  the newest N around (default 20) and prunes older. Safe to call from
   *  any save; throwing here doesn't abort the parent save. */
  private async snapshot(settings: AppSettings, keep = 20): Promise<void> {
    const dir = this.backupsDir();
    await fs.mkdir(dir, { recursive: true });
    const now = new Date();
    const stamp =
      `${now.getFullYear()}` +
      `${String(now.getMonth() + 1).padStart(2, '0')}` +
      `${String(now.getDate()).padStart(2, '0')}-` +
      `${String(now.getHours()).padStart(2, '0')}` +
      `${String(now.getMinutes()).padStart(2, '0')}` +
      `${String(now.getSeconds()).padStart(2, '0')}`;
    const out = path.join(dir, `settings-${stamp}.json`);
    await fs.writeFile(out, JSON.stringify(settings, null, 2), 'utf-8');
    // Prune older snapshots.
    const entries = (await fs.readdir(dir))
      .filter((n) => n.startsWith('settings-') && n.endsWith('.json'))
      .sort()
      .reverse(); // newest first by filename (timestamp lex-sorted)
    for (const stale of entries.slice(keep)) {
      try {
        await fs.unlink(path.join(dir, stale));
      } catch {
        /* ignore */
      }
    }
  }

  /** List backup file basenames newest-first. */
  async listBackups(): Promise<{ name: string; mtime: number; size: number }[]> {
    const dir = this.backupsDir();
    try {
      const names = await fs.readdir(dir);
      const items: { name: string; mtime: number; size: number }[] = [];
      for (const n of names) {
        if (!n.startsWith('settings-') || !n.endsWith('.json')) continue;
        try {
          const st = await fs.stat(path.join(dir, n));
          items.push({ name: n, mtime: st.mtimeMs, size: st.size });
        } catch {
          /* skip */
        }
      }
      items.sort((a, b) => b.mtime - a.mtime);
      return items;
    } catch {
      return [];
    }
  }

  /** Load a backup by basename — used by the Settings UI's restore button.
   *  Returns the parsed AppSettings; caller is expected to then call save()
   *  to make it active. */
  async readBackup(name: string): Promise<AppSettings | null> {
    if (!name.startsWith('settings-') || !name.endsWith('.json')) return null;
    try {
      const raw = await fs.readFile(path.join(this.backupsDir(), name), 'utf-8');
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      return this.merge(DEFAULTS, parsed);
    } catch {
      return null;
    }
  }

  get(): AppSettings {
    return this.cache;
  }

  /** Wipe settings.json back to factory defaults. Returns the fresh settings
   *  so the caller can re-init the engine + push them to the renderer. Uses
   *  merge() to produce a deep copy so the shared DEFAULTS object is never
   *  mutated by later edits. A snapshot of the pre-reset file is kept via the
   *  normal save() backup path, so this stays recoverable. */
  async reset(): Promise<AppSettings> {
    const fresh = this.merge(DEFAULTS, {});
    await this.save(fresh);
    return fresh;
  }

  private merge(base: AppSettings, over: Partial<AppSettings>): AppSettings {
    // Migrate older settings.json files that still have legacy module ids
    // (cpu, gpu, ram, instance). We drop them — they're replaced by the
    // single pcComponents module — and inject pcComponents if missing.
    // `steamvrStats` is a removed feature — drop any orphaned module left in
    // older settings.json files so it never lingers in the module list.
    const LEGACY_IDS = new Set(['cpu', 'gpu', 'ram', 'instance', 'steamvrStats']);
    let mods = over.modules && over.modules.length ? over.modules : base.modules;
    mods = mods.filter((m) => !LEGACY_IDS.has(m.id as string));
    // Inject ANY default module the saved file is missing by id. Without
    // this, a user whose settings.json was written before a module existed
    // (weather, battery, network, …) would never get that
    // module — so its feature toggle has nothing to flip and it can never
    // show in the chatbox. We only ADD missing ids; existing entries (and
    // the user's enabled/order/template customizations) are untouched.
    {
      const have = new Set(mods.map((m) => m.id));
      for (const def of base.modules) {
        if (!have.has(def.id)) mods = [...mods, def];
      }
    }

    // Timezone day/night icon migration: older default templates predate the
    // {icon} token. Append it only when the saved template IS one of those
    // stock defaults — a user-customized template is never touched.
    mods = mods.map((m) => {
      if (m.id !== 'timezone') return m;
      const t = (m.template ?? '').trim();
      if (t === '{label} {time}' || t === '🌍 {label} {time}') {
        return { ...m, template: `${m.template} {icon}` };
      }
      return m;
    });

    // Inject any default statuses / phrases that the saved file is missing
    // by id. Without this, users upgrading from older builds wouldn't see
    // new built-in entries (e.g. the "Sleeping" status added later) —
    // because the wholesale `over.statuses ?? base.statuses` below would
    // pick the saved array verbatim. We only ADD missing ids; we don't
    // touch existing entries, so user customizations survive.
    let statuses = over.statuses && over.statuses.length ? over.statuses : base.statuses;
    {
      const have = new Set(statuses.map((s) => s.id));
      for (const def of base.statuses) {
        if (!have.has(def.id)) statuses = [...statuses, def];
      }
      // Also: heal saved statuses missing the `text` field by inheriting
      // from defaults of the same id. Fixes the "Talking does nothing"
      // bug for users whose saved status entry was missing its text.
      statuses = statuses.map((s) => {
        if (s.text && s.text.trim()) return s;
        const def = base.statuses.find((b) => b.id === s.id);
        return def?.text ? { ...s, text: def.text } : s;
      });
    }
    let phrases = over.phrases ?? base.phrases;
    {
      const have = new Set(phrases.map((p) => p.id));
      for (const def of base.phrases) {
        if (!have.has(def.id)) phrases = [...phrases, def];
      }
    }

    // Spread base (defaults) then over (saved values) FIRST. This is the
    // critical bit: every saved field — including new optional ones like
    // savedMessages, featureOrder, mediaProgress, weather, whisper, etc. —
    // survives a reload automatically. Previously this function was a
    // hand-maintained allowlist, so any field not listed was silently
    // dropped on load (that's why saved messages / feature order / etc.
    // didn't persist). The explicit overrides BELOW then re-apply the few
    // sections that need deep-merge or migration semantics.
    return {
      ...base,
      ...over,
      // ---- sections needing deep-merge or migration (win over the spread) ----
      osc: { ...base.osc, ...(over.osc || {}) },
      modules: mods,
      audioStatus: { ...base.audioStatus, ...(over.audioStatus || {}) },
      afk: { ...base.afk, ...(over.afk || {}) },
      timezones: over.timezones && over.timezones.length ? over.timezones : base.timezones,
      pcComponents: { ...base.pcComponents, ...(over.pcComponents || {}) },
      appearance: { ...base.appearance, ...(over.appearance || {}) },
      statuses,
      profiles: over.profiles && over.profiles.length ? over.profiles : base.profiles,
      phrases,
      safety: { ...base.safety, ...(over.safety || {}) },
      refreshLoop: { ...base.refreshLoop, ...(over.refreshLoop || {}) },
      state: { ...base.state, ...(over.state || {}) },
      ui: { ...base.ui, ...(over.ui || {}) },
      autoResponder: { ...base.autoResponder, ...(over.autoResponder || {}) },
      featureToggles: { ...base.featureToggles, ...(over.featureToggles || {}) },
      liveLyrics: { ...(base.liveLyrics ?? { enabled: false }), ...(over.liveLyrics || {}) },
      translate: {
        ...(base.translate ?? { enabled: false, targetLang: 'en', mode: 'replace' as const }),
        ...(over.translate || {}),
      },
      secondaryCycle: {
        ...(base.secondaryCycle ?? { enabled: false, intervalSec: 4, moduleIds: [] }),
        ...(over.secondaryCycle || {}),
      },
      vrchatLog: { ...(base.vrchatLog ?? { enabled: false }), ...(over.vrchatLog || {}) },
      // AI: shallow-merge each subkey so partial saves don't drop fields
      // we just added. `features` deep-merges separately so existing users
      // pick up new per-feature toggles on next load.
      ai: {
        ...(base.ai ?? {
          enabled: false,
          apiKey: '',
          model: 'claude-opus-4-7',
          features: {} as any,
          wakeWord: 'uvy',
          persona: '',
        }),
        ...(over.ai || {}),
        features: {
          ...(base.ai?.features ?? ({} as any)),
          ...((over.ai?.features as any) || {}),
        },
      },
    };
  }
}
