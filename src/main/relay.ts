// StatusRelay: HUD-style rotating chatbox.
//
// While `relay.enabled` is true, this owns the chatbox output. It rotates a
// list of producer-driven "slots" (PC metrics, audio status, now playing,
// custom) every N seconds, sends a low-frequency keep-alive so VRChat's
// chatbox doesn't time out, and lets the rest of the app push *alerts*
// (battery critical, mute toggled, etc.) that preempt the rotation.
//
// All writes route through ActionEngine.run({ kind: 'sendText' }) so the
// existing SafetyGuard (rate-limit + cooldown) still applies, dedupe is
// opted out only for the explicit keep-alive case, and history/state IPC
// remain identical to user-driven sends.

import { EventEmitter } from 'events';
import log from 'electron-log';
import type { ActionEngine } from './engine';
import type { StatsCollector } from './stats';
import type { MediaCollector } from './media';
import type { OscManager } from './osc';
// Lyrics moved out of the relay and into the live-loop's Spotify module.
// See main.ts gatherAndSend() — it consults LyricsService directly when
// settings.liveLyrics.enabled is true. Relay no longer needs LyricsService.
import type {
  AppSettings,
  RelaySlot,
  RelayAlert,
  RelayConfig,
  RelayStatus,
  AudioStatus,
  MediaInfo,
  SystemStats,
} from '../shared/types';
import { getPersona } from '../shared/personas';

export const DEFAULT_RELAY_CONFIG: RelayConfig = {
  enabled: false,
  defaultHoldMs: 14_000,
  keepAliveMs: 6_000,
  batteryCriticalPct: 15,
  slots: [
    { id: 'status', kind: 'currentStatus', enabled: true },
    { id: 'pc', kind: 'pcMetrics', enabled: true },
    { id: 'audio', kind: 'audioStatus', enabled: true },
    { id: 'np', kind: 'nowPlaying', enabled: true },
    { id: 'cust', kind: 'custom', enabled: false, text: '' },
  ],
};

/** Resolve a usable RelayConfig from possibly-partial settings.
 *  Migrates older saved configs that predate newer slot kinds by appending
 *  any missing default slots — so existing users gain new built-in slots
 *  (e.g. 'currentStatus') the next time the relay starts. */
export function resolveRelayConfig(s: AppSettings): RelayConfig {
  if (!s.relay) return DEFAULT_RELAY_CONFIG;
  const have = new Set(s.relay.slots.map((sl) => sl.kind));
  const missing = DEFAULT_RELAY_CONFIG.slots.filter((sl) => !have.has(sl.kind));
  if (missing.length === 0) return s.relay;
  return { ...s.relay, slots: [...missing, ...s.relay.slots] };
}

export class StatusRelay extends EventEmitter {
  private tickTimer: NodeJS.Timeout | null = null;
  private slotIdx = 0;
  private slotEndsAt = 0;
  private currentSlotId: string | null = null;
  private lastSent = '';
  private lastSentAt = 0;
  private alertQueue: RelayAlert[] = [];

  // Cached latest collector readings, refreshed on demand each tick. We don't
  // collect on every tick — only when the active slot needs that data.
  private lastStats: SystemStats | null = null;
  private lastMedia: MediaInfo | null = null;
  private lastAudio: AudioStatus = { muted: false, deafened: false, changedAt: 0 };
  // Wall-clock time + the media `position` recorded at that instant. We add
  // (Lyrics moved out; position-interpolation state retired with them.)

  constructor(
    private engine: ActionEngine,
    private stats: StatsCollector,
    private media: MediaCollector,
    private osc: OscManager,
    private getSettings: () => AppSettings,
  ) {
    super();
  }

  start(): void {
    this.stop();
    log.info('[relay] starting');
    this.tickTimer = setInterval(() => {
      void this.tick();
    }, 1000);
  }

  stop(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  /** Called by main.ts after settings save so the relay picks up new slots. */
  reconfigure(): void {
    const cfg = resolveRelayConfig(this.getSettings());
    if (cfg.enabled && !this.tickTimer) this.start();
    if (!cfg.enabled && this.tickTimer) this.stop();
    // Reset rotation pointer if it's out of bounds for the new slot list.
    const enabled = cfg.slots.filter((s) => s.enabled);
    if (this.slotIdx >= enabled.length) this.slotIdx = 0;
  }

  /** Push an alert that preempts the rotation. */
  emitAlert(alert: Omit<RelayAlert, 'expiresAt'>): void {
    const now = Date.now();
    const a: RelayAlert = { ...alert, expiresAt: now + alert.holdMs };
    // Critical alerts jump to the front; normal alerts queue after them.
    if (a.priority === 'critical') {
      this.alertQueue.unshift(a);
    } else {
      this.alertQueue.push(a);
    }
    log.info(`[relay] alert (${a.priority}): ${a.text}`);
  }

  // ---- Producers ----------------------------------------------------------

  private fmtPc(s: SystemStats | null): string {
    if (!s) return '';
    const pc = this.getSettings().pcComponents;
    const showNames = pc?.showNames ?? false;
    const parts: string[] = [];
    if (pc?.showCpu ?? true) {
      const name = showNames && s.cpuName ? ` ${s.cpuName}` : '';
      const tempBit = s.cpuTemp != null ? `/${s.cpuTemp}°` : '';
      parts.push(`CPU${name} ${s.cpuLoad}%${tempBit}`);
    }
    if ((pc?.showGpu ?? true) && s.gpuLoad != null) {
      const name = showNames && s.gpuName ? ` ${s.gpuName}` : '';
      const tempBit = s.gpuTemp != null ? `/${s.gpuTemp}°` : '';
      parts.push(`GPU${name} ${s.gpuLoad}%${tempBit}`);
    }
    if (pc?.showRam ?? true) parts.push(`RAM ${s.ramUsed}/${s.ramTotal}`);
    if ((pc?.showVram ?? true) && s.vramTotal != null) parts.push(`VRAM ${s.vramTotal}`);
    if (parts.length === 0) return '';
    return `[${parts.join(' | ')}]`;
  }

  private fmtAudio(a: AudioStatus): string {
    if (a.deafened) return '🔇 Deafened';
    if (a.muted) return '🎙️ Muted';
    return '🎙️ Live';
  }

  private fmtMedia(m: MediaInfo | null): string {
    if (!m || !m.title) return '';
    const head = m.playing ? '▶' : '⏸';
    return `${head} ${m.title}${m.artist ? ` — ${m.artist}` : ''}`;
  }

  private fmtCurrentStatus(): string {
    // Resolve the active status from engine state, then look up its def in
    // settings.statuses. The active AI Persona may override the per-status
    // text (e.g. AFK -> "afk-desu~" under the Anime persona). Persona variant
    // wins; falls back to the status's own `text`, then to "icon label".
    const settings = this.getSettings();
    const state = this.engine.getState();
    const status = settings.statuses.find((s) => s.id === state.currentStatusId);
    if (!status) return '';

    const persona = getPersona(settings.activePersonaId);
    const variant = persona?.statusVariants?.[status.id];
    if (variant) return variant;

    if (status.text) return status.text;
    return `${status.icon} ${status.label}`.trim();
  }

  private async produce(slot: RelaySlot): Promise<string> {
    switch (slot.kind) {
      case 'pcMetrics': {
        this.lastStats = await this.stats.collect().catch(() => this.lastStats);
        return this.fmtPc(this.lastStats);
      }
      case 'audioStatus': {
        this.lastAudio = this.osc.getAudioStatus();
        return this.fmtAudio(this.lastAudio);
      }
      case 'nowPlaying': {
        this.lastMedia = await this.media.collect().catch(() => this.lastMedia);
        return this.fmtMedia(this.lastMedia);
      }
      case 'currentStatus':
        return this.fmtCurrentStatus();
      case 'custom':
        return slot.text ?? '';
      default:
        return '';
    }
  }

  // Battery alert hook removed: the SteamVR battery integration was deleted
  // because the OpenVR FFI route through PowerShell was unreliable across
  // SDK versions. Battery-critical alerts were the only consumer.

  // ---- Tick loop ----------------------------------------------------------

  private async tick(): Promise<void> {
    const cfg = resolveRelayConfig(this.getSettings());
    if (!cfg.enabled) return;
    const now = Date.now();

    // Drop expired alerts.
    this.alertQueue = this.alertQueue.filter((a) => a.expiresAt > now);

    let text = '';
    let isAlertFrame = false;

    const head = this.alertQueue[0];
    if (head) {
      text = head.text;
      isAlertFrame = true;
    } else {
      // Rotation. Skip disabled and empty-text slots.
      const enabled = cfg.slots.filter((s) => s.enabled);
      if (enabled.length === 0) return;

      if (this.slotEndsAt <= now) {
        // Advance to next slot. Try up to N slots before giving up so empty
        // producers (e.g. nowPlaying with nothing playing) don't deadlock.
        for (let attempts = 0; attempts < enabled.length; attempts++) {
          this.slotIdx = (this.slotIdx + 1) % enabled.length;
          const slot = enabled[this.slotIdx];
          if (!slot) continue;
          const produced = await this.produce(slot);
          if (produced) {
            text = produced;
            this.currentSlotId = slot.id;
            this.slotEndsAt = now + (slot.holdMs ?? cfg.defaultHoldMs);
            break;
          }
        }
        if (!text) return; // every slot produced empty; skip this tick
      } else {
        text = this.lastSent;
      }
    }

    if (!text) return;

    const isStale = now - this.lastSentAt >= cfg.keepAliveMs;
    const changed = text !== this.lastSent;
    if (!changed && !isStale) {
      // No send needed this tick.
      return;
    }

    // bypassDedupe for keep-alive (same text within dedupe window) so VRChat's
    // chatbox doesn't time out. Don't bypass for new content — let safety
    // dedupe catch genuine duplicates.
    const bypassDedupe = !changed && isStale;
    const result = await this.engine.run({ kind: 'sendText', text, bypassDedupe });
    if (result.ok) {
      this.lastSent = text;
      this.lastSentAt = now;
      // Consume the alert frame after a successful send.
      if (isAlertFrame && this.alertQueue.length > 0) this.alertQueue.shift();
    }

    this.emitStatus(text);
  }

  /** Push current relay status to the renderer for UI display. */
  private emitStatus(activeText: string): void {
    const status: RelayStatus = {
      enabled: resolveRelayConfig(this.getSettings()).enabled,
      activeSlotId: this.currentSlotId,
      activeText,
      alertCount: this.alertQueue.length,
      lastSentAt: this.lastSentAt,
    };
    this.emit('status', status);
  }

  /** Force the next slot. Useful for "skip" buttons in the UI. */
  forceAdvance(): void {
    this.slotEndsAt = 0;
  }
}
