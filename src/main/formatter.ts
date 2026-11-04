import type {
  AppSettings,
  MediaInfo,
  SystemStats,
  AudioStatus,
  BatteryStatus,
  AfkState,
} from '../shared/types';
import type { VrchatLogSnapshot } from './vrchatLog';
import type { WeatherSnapshot } from './weather';
import { renderBar, fmtTime } from '../shared/progressBar';

/** Evaluate a simple comparison against the values map.
 *  Supported expressions:
 *    key            -> truthy non-empty value
 *    !key           -> empty / missing value
 *    key == "x"     -> string equality
 *    key != "x"     -> string inequality
 *    key > 80       -> numeric comparison (also <, >=, <=)
 *  Anything else returns false. Intentionally minimal — this is a chatbox
 *  template, not a programming language. */
function evalCondition(expr: string, values: Record<string, string>): boolean {
  const t = expr.trim();
  // Negation form: !key
  if (t.startsWith('!')) {
    const k = t.slice(1).trim();
    const v = values[k];
    return !v || v === '0' || v === 'false' || v === '--';
  }
  // String compare: key == "literal" or key != "literal"
  const strCmp = t.match(/^(\w+)\s*(==|!=)\s*"([^"]*)"$/);
  if (strCmp) {
    const [, k, op, lit] = strCmp;
    const v = values[k!] ?? '';
    return op === '==' ? v === lit : v !== lit;
  }
  // Numeric compare: key OP number
  const numCmp = t.match(/^(\w+)\s*(>=|<=|>|<|==|!=)\s*(-?\d+(?:\.\d+)?)$/);
  if (numCmp) {
    const [, k, op, n] = numCmp;
    const raw = values[k!];
    const lhs = Number(raw);
    const rhs = Number(n);
    if (!Number.isFinite(lhs) || !Number.isFinite(rhs)) return false;
    switch (op) {
      case '>':
        return lhs > rhs;
      case '<':
        return lhs < rhs;
      case '>=':
        return lhs >= rhs;
      case '<=':
        return lhs <= rhs;
      case '==':
        return lhs === rhs;
      case '!=':
        return lhs !== rhs;
    }
  }
  // Bare key — truthy if it exists and isn't empty / 0 / false / '--'.
  const v = values[t];
  return !!v && v !== '0' && v !== 'false' && v !== '--';
}

function fill(template: string, values: Record<string, string>): string {
  // Pass 1: resolve {if expr}...{/if} blocks. We don't support nesting
  // (deliberate scope cap — a chatbox template doesn't need it). Multiple
  // separate {if} blocks on the same line work fine.
  let resolved = template.replace(
    /\{if\s+([^}]+)\}([\s\S]*?)\{\/if\}/g,
    (_, expr: string, body: string) => (evalCondition(expr, values) ? body : ''),
  );
  // Pass 2: usual {token} substitution.
  resolved = resolved.replace(/\{(\w+)\}/g, (_, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? (values[key] ?? '') : '',
  );
  // Pass 3: collapse double spaces left behind by removed conditional blocks.
  return resolved.replace(/ {2,}/g, ' ').trim();
}

/** Compact one-line string of every battery device, e.g.
 *  "🥽87% 🎮92%⚡ 🎮88% 📍64%". Icon per device kind. */
function batteryDevicesStr(devices: { kind: string; percent: number; charging: boolean }[]): string {
  const icon = (k: string) =>
    k === 'hmd' ? '🥽' : k === 'controller' ? '🎮' : k === 'tracker' ? '📍' : '🔋';
  return devices.map((d) => `${icon(d.kind)}${d.percent}%${d.charging ? '⚡' : ''}`).join(' ');
}

/** Day/night marker for a timezone: ☀️ during local 06:00–17:59, 🌙 outside.
 *  Tells you at a glance whether a friend in that zone is probably awake. */
function dayNightIcon(zone: string | null): string {
  try {
    const opts: Intl.DateTimeFormatOptions = { hour: 'numeric', hour12: false };
    if (zone) opts.timeZone = zone;
    const hour = Number(new Intl.DateTimeFormat('en-US', opts).format(new Date()));
    return hour >= 6 && hour < 18 ? '☀️' : '🌙';
  } catch {
    return '';
  }
}

/** "2h 14m" / "37m" from a start timestamp. */
function sessionString(startAt: number): string {
  const min = Math.max(0, Math.floor((Date.now() - startAt) / 60_000));
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function clockString(zone: string | null, clock24h: boolean): string {
  const d = new Date();
  const opts: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
    hour12: !clock24h,
  };
  if (zone) opts.timeZone = zone;
  try {
    return d.toLocaleTimeString([], opts);
  } catch {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: !clock24h });
  }
}

export interface FormatInput {
  settings: AppSettings;
  media: MediaInfo | null;
  stats: SystemStats | null;
  audio: AudioStatus | null;
  battery: BatteryStatus | null;
  afk: AfkState | null;
  /** Index used to cycle timezone display. */
  tzIndex: number;
  /** Current synced lyric line, if the live-lyrics feature is enabled and
   *  music is playing. Null otherwise. Appended under the media line. */
  currentLyric?: string | null;
  /** Latest snapshot from the VRChat output-log tailer. When the
   *  `vrchat` module is enabled in modules, we render a line from it.
   *  Pass null/undefined when the tailer is off or VRChat isn't running. */
  vrchat?: VrchatLogSnapshot | null;
  /** Wall-clock-interpolated playback position in seconds. Preferred over
   *  media.position for the {bar}/{time} tokens because GSMTC's reported
   *  position can be seconds stale between polls; main.ts advances this
   *  anchor smoothly. Null when nothing is playing. */
  mediaPosSec?: number | null;
  /** Current weather snapshot (VRCOSC-style module). */
  weather?: WeatherSnapshot | null;
  /** Epoch ms VRChat.exe has been running since (from the process watcher).
   *  Drives the 'session' module; null/undefined suppresses the line. */
  sessionStartAt?: number | null;
  /** PC / laptop battery reading for the {percent}/{charging} tokens. */
  /** When non-empty, prepended as the first chatbox line on every tick.
   *  Set by the live loop from engine.state.lastSentText so manually-
   *  composed messages stay in the cycle until the user clears them.
   *  @deprecated prefer `pinnedTexts` — kept so older callers still work. */
  pinnedText?: string;
  /** Multi-pin cycle: each entry becomes its own chatbox line, prepended
   *  before module lines. Renderer toggles items in/out via togglePin. */
  pinnedTexts?: string[];
}

export function formatChatbox(input: FormatInput): string {
  const {
    settings,
    media,
    stats,
    audio,
    afk,
    tzIndex,
    currentLyric,
    vrchat,
    weather,
    battery,
    pinnedText,
    pinnedTexts,
  } = input;
  const lines: string[] = [];
  // Pinned items (multi-pin model) always win the first lines — they're
  // the most visible — module lines follow below. We render the modern
  // `pinnedTexts[]` first, then fall back to the legacy single
  // `pinnedText` only if no array was provided.
  if (pinnedTexts && pinnedTexts.length > 0) {
    for (const p of pinnedTexts) {
      if (p && p.trim()) lines.push(p.trim());
    }
  } else if (pinnedText && pinnedText.trim()) {
    lines.push(pinnedText.trim());
  }

  const ordered = [...settings.modules].filter((m) => m.enabled).sort((a, b) => a.order - b.order);

  for (const mod of ordered) {
    const tpl = mod.template || '';
    switch (mod.id) {
      case 'custom': {
        if (settings.customText.trim()) lines.push(fill(tpl, { custom: settings.customText }));
        break;
      }
      case 'media': {
        // Show the song line only while music is *actually playing*. When
        // it's paused or stopped, the line (and any attached lyric) is
        // suppressed so the chatbox doesn't keep advertising a song that
        // isn't currently playing. The 'media' module needs a title AND
        // playing=true to render.
        if (media && media.title && media.playing) {
          // Progress-bar tokens ({bar} {time} {elapsed} {total}). Only
          // meaningful when the source reports a duration; otherwise they
          // render as empty strings and fill()'s double-space collapse
          // keeps the line tidy.
          const dur =
            typeof media.duration === 'number' && media.duration > 0 ? media.duration : null;
          const rawPos =
            input.mediaPosSec ?? (typeof media.position === 'number' ? media.position : null);
          const pos = dur != null && rawPos != null ? Math.min(rawPos, dur) : rawPos;
          const showBar = dur != null && pos != null;
          const mp = settings.mediaProgress;
          const bar = showBar ? renderBar(pos / dur, mp?.style ?? 'knob', mp?.width ?? 8) : '';
          const elapsed = showBar ? fmtTime(pos) : '';
          const total = dur != null ? fmtTime(dur) : '';
          lines.push(
            fill(tpl, {
              title: media.title,
              artist: media.artist,
              album: media.album,
              status: '▶',
              bar,
              elapsed,
              total,
              time: showBar ? `${elapsed}/${total}` : '',
            }),
          );
          // Lyrics only follow the music while it plays; otherwise the
          // line we'd append is a stale fragment from wherever the user
          // paused.
          if (currentLyric) lines.push(`♪ ${currentLyric}`);
        }
        break;
      }
      case 'clock': {
        lines.push(fill(tpl, { time: clockString(null, settings.clock24h) }));
        break;
      }
      case 'pcComponents': {
        // Build the line procedurally from the user's per-component toggles
        // so disabling, say, CPU doesn't leave a stray "|" or empty segment.
        // The user-supplied template is intentionally ignored here — the
        // toggle layout can't be expressed in a single static string.
        if (stats) {
          const pc = settings.pcComponents;
          const showNames = pc?.showNames ?? false;
          const parts: string[] = [];
          if (pc?.showCpu ?? true) {
            const name = showNames && stats.cpuName ? ` ${stats.cpuName}` : '';
            const tempBit = stats.cpuTemp != null ? `/${stats.cpuTemp}°` : '';
            parts.push(`CPU${name} ${stats.cpuLoad}%${tempBit}`);
          }
          if ((pc?.showGpu ?? true) && stats.gpuLoad != null) {
            const name = showNames && stats.gpuName ? ` ${stats.gpuName}` : '';
            const tempBit = stats.gpuTemp != null ? `/${stats.gpuTemp}°` : '';
            parts.push(`GPU${name} ${stats.gpuLoad}%${tempBit}`);
          }
          if (pc?.showRam ?? true) {
            parts.push(`RAM ${stats.ramUsed}/${stats.ramTotal}GB`);
          }
          if ((pc?.showVram ?? true) && stats.vramTotal != null) {
            parts.push(`VRAM ${stats.vramTotal}GB`);
          }
          if (parts.length > 0) lines.push(`🖥️ ${parts.join(' | ')}`);
        }
        break;
      }
      case 'network': {
        if (stats)
          lines.push(
            fill(tpl, {
              netDown: stats.netDownMbps != null ? String(stats.netDownMbps) : '0',
              netUp: stats.netUpMbps != null ? String(stats.netUpMbps) : '0',
            }),
          );
        break;
      }
      case 'audiostatus': {
        // Prefix-style: show only when muted/deafened (or notify recently changed).
        const a = audio;
        if (a) {
          const recentlyChanged = Date.now() - a.changedAt < 5000;
          if (a.deafened) {
            lines.push(fill(tpl, { status: settings.audioStatus.deafLabel }));
          } else if (a.muted) {
            lines.push(fill(tpl, { status: settings.audioStatus.mutedLabel }));
          } else if (settings.audioStatus.notify && recentlyChanged) {
            lines.push(fill(tpl, { status: settings.audioStatus.unmutedLabel }));
          }
        }
        break;
      }
      case 'afk': {
        if (afk && afk.afk) {
          const mins = Math.floor(afk.idleSec / 60);
          lines.push(
            fill(tpl, {
              status: settings.afk.label,
              idle: String(mins),
            }),
          );
        }
        break;
      }
      case 'timezone': {
        const zones = settings.timezones;
        if (zones.length > 0) {
          const z = zones[tzIndex % zones.length];
          if (z) {
            lines.push(
              fill(tpl, {
                label: z.label,
                time: clockString(z.zone, settings.clock24h),
                // ☀️ when it's daytime (06–18) in that zone, 🌙 otherwise —
                // "is this friend probably awake" at a glance.
                icon: dayNightIcon(z.zone),
              }),
            );
          }
        }
        break;
      }
      case 'weather': {
        // VRCOSC-style weather. Tokens: {city} {temp} {tempC} {tempF}
        // {desc} {code} {windKph}. {temp} respects the configured unit.
        if (weather && weather.available) {
          const unit = settings.weather?.unit ?? 'C';
          const temp = unit === 'F' ? weather.tempF : weather.tempC;
          lines.push(
            fill(tpl, {
              city: weather.city,
              temp: String(temp),
              tempC: String(weather.tempC),
              tempF: String(weather.tempF),
              desc: weather.desc,
              code: String(weather.code),
              windKph: String(weather.windKph),
            }),
          );
        }
        break;
      }
      case 'battery': {
        // Battery — SteamVR devices (HMD/controllers/trackers) when available,
        // else the PC/laptop battery. Suppressed when nothing has a battery.
        // Tokens: {devices} (all, compact) {percent} {charging} {status}.
        if (battery && battery.available && battery.devices.length > 0) {
          const d0 = battery.devices[0]!;
          lines.push(
            fill(tpl, {
              devices: batteryDevicesStr(battery.devices),
              percent: String(d0.percent),
              charging: d0.charging ? '⚡' : '',
              status: d0.charging ? 'Charging' : '',
            }),
          );
        }
        break;
      }
      case 'session': {
        // Time since VRChat.exe launched. Suppressed when the game isn't
        // running (or the user plays standalone, where no local process
        // exists for the watcher to see).
        if (input.sessionStartAt) {
          lines.push(fill(tpl, { session: sessionString(input.sessionStartAt) }));
        }
        break;
      }
      case 'vrchat': {
        // Only render when we have a live snapshot AND we're actually
        // currently in a world — otherwise the chatbox would advertise
        // stale data (e.g. last night's world) when VRChat isn't running.
        if (vrchat && vrchat.inWorld) {
          lines.push(
            fill(tpl, {
              world: vrchat.world || '?',
              instanceType: vrchat.instanceType || 'public',
              playerCount: String(vrchat.playerCount),
              lastJoin: vrchat.lastJoin,
              lastLeave: vrchat.lastLeave,
              avatar: vrchat.avatar,
            }),
          );
        }
        break;
      }
    }
  }

  // Per-line cap moved to OscManager.sendChatbox so EVERY chatbox path
  // (manual sends, phrases, status clicks, AI lines, webhook receives)
  // gets capped — not just the live loop. See osc.ts.

  return lines.join('\n');
}

/** ChatBox Clip system (ported from VRCOSC's ChatBox animation).
 *
 *  Each clip = {id, label, text, priority, enabled, condition}.
 *  Algorithm: every tick, evaluate the condition of each enabled clip
 *  against the same `values` map the module formatter has access to. The
 *  highest-priority eligible clip wins; its `text` is filled with template
 *  tokens and returned. Returns null when no clip is eligible. */
export function pickClip(input: FormatInput): { id: string; text: string } | null {
  const cfg = input.settings.chatboxClips;
  if (!cfg?.enabled || !cfg.clips?.length) return null;

  // Build the values map once — shared between all clip conditions / texts.
  // Mirrors the per-module fill() inputs so a clip can reference any token
  // we know about ({title}, {tempC}, {cpuLoad}, etc.).
  const values: Record<string, string> = {};
  const { media, stats, audio, afk, weather, battery } = input;
  values.musicPlaying = media?.playing ? '1' : '';
  if (media) {
    values.title = media.title || '';
    values.artist = media.artist || '';
    values.album = media.album || '';
  }
  if (stats) {
    values.cpuLoad = String(stats.cpuLoad ?? 0);
    if (stats.gpuLoad != null) values.gpuLoad = String(stats.gpuLoad);
    if (stats.ramUsed != null) values.ramUsed = String(stats.ramUsed);
    if (stats.ramTotal != null) values.ramTotal = String(stats.ramTotal);
  }
  values.afk = afk?.afk ? '1' : '';
  values.muted = audio?.muted ? '1' : '';
  values.deafened = audio?.deafened ? '1' : '';
  if (weather?.available) {
    const unit = input.settings.weather?.unit ?? 'C';
    values.city = weather.city;
    values.temp = String(unit === 'F' ? weather.tempF : weather.tempC);
    values.tempC = String(weather.tempC);
    values.tempF = String(weather.tempF);
    values.desc = weather.desc;
  }
  if (input.sessionStartAt) {
    values.session = sessionString(input.sessionStartAt);
  }
  if (battery?.available && battery.devices.length > 0) {
    const d0 = battery.devices[0]!;
    values.percent = String(d0.percent);
    values.charging = d0.charging ? '⚡' : '';
    values.devices = batteryDevicesStr(battery.devices);
  }
  values.time = clockString(null, input.settings.clock24h);

  // Filter eligible clips and pick the highest-priority one.
  const eligible = cfg.clips
    .filter((c) => c.enabled)
    .filter((c) => !c.condition || !c.condition.trim() || evalCondition(c.condition, values));
  if (eligible.length === 0) return null;
  eligible.sort((a, b) => b.priority - a.priority);
  const winner = eligible[0];
  if (!winner) return null;
  return { id: winner.id, text: fill(winner.text, values) };
}

/** Render a SINGLE module's line — used by the secondary-row cycler. The
 *  multi-line feature passes one module id per tick and we render just
 *  that one. Returns empty string when the module has nothing to show
 *  this tick (paused media, not-in-VRChat, etc.). */
export function formatSingleModule(input: FormatInput, moduleId: string): string {
  const single: AppSettings = {
    ...input.settings,
    modules: input.settings.modules
      .filter((m) => m.id === moduleId)
      .map((m) => ({ ...m, enabled: true, order: 0 })),
  };
  return formatChatbox({ ...input, settings: single });
}
