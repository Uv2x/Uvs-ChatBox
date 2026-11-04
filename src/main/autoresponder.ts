import type { ActionEngine } from './engine';
import type { AfkDetector } from './afk';
import type { OscManager } from './osc';
import type { AppSettings } from '../shared/types';
import { VRActivityProbe } from './vrActivity';

/**
 * Auto AFK responder (spec §14C).
 *
 * Polls global idle time (and optionally mute state) on an interval. When the
 * user crosses the inactivity threshold — or mutes, if enabled — it fires the
 * configured AFK message exactly once via the ActionEngine (so it still passes
 * through the safety/throttle layer). When the user returns (input resumes /
 * unmutes), it arms again for the next idle period and, if the current chatbox
 * line is the AFK message, clears it.
 *
 * Edge-triggered, not level-triggered: we send on the transition into AFK, not
 * repeatedly, to avoid spamming. The separate refresh loop (spec §14A) is what
 * keeps a line alive while idle, if the user has enabled it.
 */
export class AutoResponder {
  private engine: ActionEngine;
  private afkDet: AfkDetector;
  private osc: OscManager;
  private getSettings: () => AppSettings;

  private timer: NodeJS.Timeout | null = null;
  private fired = false; // have we already sent for this idle period?
  /** Shared HMD activity probe. Polls SteamVR's GetTrackedDeviceActivityLevel
   *  so we can override desktop-idle: if the user is in VR, they're not AFK
   *  even when mouse/keyboard are still. Conversely, if the HMD is off
   *  their head, they ARE afk regardless of desktop input. */
  private vr = new VRActivityProbe();

  constructor(
    engine: ActionEngine,
    afkDet: AfkDetector,
    osc: OscManager,
    getSettings: () => AppSettings,
  ) {
    this.engine = engine;
    this.afkDet = afkDet;
    this.osc = osc;
    this.getSettings = getSettings;
  }

  start(): void {
    this.stop();
    const cfg = this.getSettings().autoResponder;
    if (!cfg.enabled) return;
    // Poll every 5s — fine-grained enough for a minutes-based threshold,
    // cheap enough not to spam PowerShell idle queries.
    this.timer = setInterval(() => void this.tick(), 5000);
    void this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.fired = false;
  }

  /** Re-read config and (re)start or stop accordingly. */
  reconfigure(): void {
    const cfg = this.getSettings().autoResponder;
    if (cfg.enabled) this.start();
    else this.stop();
  }

  private async tick(): Promise<void> {
    const cfg = this.getSettings().autoResponder;
    if (!cfg.enabled) {
      this.stop();
      return;
    }

    const thresholdSec = Math.max(60, cfg.afterMin * 60);
    const { idleSec } = await this.afkDet.poll(thresholdSec);
    const muted = this.osc.getAudioStatus().muted;

    // SteamVR HMD activity: if the headset is on the user's head AND
    // recently active, they're using VR — desktop idle is meaningless.
    // If SteamVR isn't installed/running, vrActivity is unavailable and we
    // fall back to the original desktop-only behavior.
    const vr = await this.vr.poll();
    const hmdActive = vr.available && vr.hmdOnHead;
    const hmdOffHead = vr.available && !vr.hmdOnHead;

    const idleTrigger = idleSec >= thresholdSec;
    const muteTrigger = cfg.onMute && muted;
    // Combined AFK decision:
    //   - hmdActive overrides everything (in VR == not AFK)
    //   - hmdOffHead is itself a strong AFK signal (took the headset off)
    //   - otherwise fall back to desktop idle + mute as before.
    const shouldBeAfk = !hmdActive && (hmdOffHead || idleTrigger || muteTrigger);

    if (shouldBeAfk && !this.fired) {
      // Transition INTO afk → send once. Dedicated pin key so (a) it does
      // not collide with the user's manual pin slot and (b) we can remove
      // exactly this pin when the user returns.
      this.fired = true;
      await this.engine.run({ kind: 'sendText', text: cfg.message, pinKey: 'autoresponder' });
    } else if (!shouldBeAfk && this.fired) {
      // User returned → re-arm. Drop our pin (no-op when pinning is off);
      // without this the live cycle would keep re-sending the AFK line
      // forever after clearChatbox wiped the OSC side.
      this.fired = false;
      this.engine.removePin('autoresponder');
      const st = this.engine.getState();
      if (st.lastSentText === this.engine.substitute(cfg.message)) {
        await this.engine.run({ kind: 'clearChatbox' });
      }
    }
  }
}
