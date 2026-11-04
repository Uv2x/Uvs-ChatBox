import type { ActionEngine } from './engine';
import type { AfkDetector } from './afk';
import type { OscManager } from './osc';
import type { AppSettings } from '../shared/types';

/**
 * Auto AFK responder (spec §14C).
 *
 * Asks the shared AfkDetector (VRChat's AFK flag, keyboard/mouse idle, headset
 * on/off — see afk.ts) on an interval, with this feature's own threshold, and
 * optionally watches mute. When the user goes AFK — or mutes, if enabled — it fires the
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
    // Poll every 5s — fine-grained enough for a minutes-based threshold.
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
    const afkState = await this.afkDet.poll(thresholdSec);
    const muted = this.osc.getAudioStatus().muted;
    // Muting counts only while the headset isn't being worn — in VR people
    // mute all the time while playing.
    const muteTrigger = cfg.onMute && muted && !afkState.hmd?.onHead;
    const shouldBeAfk = afkState.afk || muteTrigger;

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
