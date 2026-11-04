import { powerMonitor } from 'electron';
import type { AfkState } from '../shared/types';
import type { VRActivityProbe } from './vrActivity';

/**
 * One AFK decision for the whole app — the AFK chatbox module, the
 * auto-responder and the Smart AFK panel all ask this, each with its own
 * threshold. Modelled on how VRCOSC and MagicChatbox decide:
 *
 *  1. VRChat's own /avatar/parameters/AFK is the strongest signal (VRCOSC's
 *     "VRChat" source). We keep its LAST KNOWN value: VRChat only sends it
 *     when it changes, so the old 10-minute time-to-live silently expired in
 *     the middle of normal play.
 *  2. Otherwise "away time" = time since the last sign of life:
 *       - keyboard/mouse input (Electron's powerMonitor — GetLastInputInfo on
 *         Windows, no PowerShell), and
 *       - the headset being worn (SteamVR HMD activity, VRCOSC's "SteamVR"
 *         source), once that sensor has shown it works this session.
 *     In PCVR nobody touches the keyboard, so PC idle alone marked people AFK
 *     while they were playing — MagicChatbox turns idle off in VR for that
 *     reason. In VR without a working headset sensor we do the same and rely
 *     on VRChat's AFK alone. Desktop players (VRChat's VRMode = 0) keep plain
 *     keyboard/mouse idle even with SteamVR open.
 *  3. Standalone Quest (the OSC target is another device): PC signals mean
 *     nothing there, so only VRChat's AFK counts.
 */
export class AfkDetector {
  /** VRChat's last /avatar/parameters/AFK value this session; null = not heard. */
  private vrchatAfk: boolean | null = null;
  private vrchatAfkSince = 0;
  /** VRChat's /avatar/parameters/VRMode: 1 = VR, 0 = desktop, null = not heard. */
  private vrMode: number | null = null;

  /** Source preference set from settings.afk.source.
   *  'vrchat' = only VRChat's AFK signal.
   *  'idle'   = only keyboard/mouse idle (legacy).
   *  'auto'   = everything above. (Default.) */
  private source: 'vrchat' | 'idle' | 'auto' = 'auto';

  /** True when the OSC target is a remote host (a standalone Quest on the
   *  LAN, not this PC): the user is in the headset, NOT at the PC. Set from
   *  main whenever the OSC endpoint changes. */
  private remoteTarget = false;

  /** Last time the headset was seen on the user's head; 0 = not since
   *  SteamVR came up, i.e. the sensor hasn't shown it works yet. */
  private hmdOnAt = 0;

  constructor(private readonly vr: VRActivityProbe) {}

  setSource(s: 'vrchat' | 'idle' | 'auto' | undefined): void {
    this.source = s ?? 'auto';
  }

  setRemoteTarget(remote: boolean): void {
    this.remoteTarget = remote;
  }

  /** Feed in VRChat's `/avatar/parameters/AFK` value when we observe it. */
  setVrchatAfk(afk: boolean): void {
    if (afk && this.vrchatAfk !== true) this.vrchatAfkSince = Date.now();
    this.vrchatAfk = afk;
  }

  /** Feed in VRChat's `/avatar/parameters/VRMode` (1 = VR, 0 = desktop). */
  setVrchatVrMode(mode: number): void {
    this.vrMode = mode;
  }

  /** VRChat exited — forget what it told us. */
  resetVrchat(): void {
    this.vrchatAfk = null;
    this.vrMode = null;
  }

  async poll(thresholdSec: number): Promise<AfkState> {
    const hmd = await this.vr.poll(); // throttled; cheap long-lived helper
    const now = Date.now();
    if (!hmd.available) this.hmdOnAt = 0;
    else if (hmd.hmdOnHead) this.hmdOnAt = now;

    const useVrchat = this.source !== 'idle';
    const vrchatAfk = useVrchat && this.vrchatAfk === true;

    // Seconds without a sign of life from this PC's own signals.
    let awaySec = 0;
    if (this.source !== 'vrchat' && !this.remoteTarget) {
      const pcIdleSec = powerMonitor.getSystemIdleTime();
      const inVr =
        this.source === 'auto' && (this.vrMode === 1 || (this.vrMode !== 0 && hmd.available));
      if (!inVr) awaySec = pcIdleSec;
      else if (this.hmdOnAt > 0) {
        awaySec = Math.min(pcIdleSec, Math.floor((now - this.hmdOnAt) / 1000));
      }
    }

    const afk = vrchatAfk || awaySec >= thresholdSec;
    // idleSec drives the "AFK 12m" duration and the panel's progress bar.
    const vrchatAwaySec = vrchatAfk ? Math.floor((now - this.vrchatAfkSince) / 1000) : 0;
    return {
      afk,
      idleSec: Math.max(awaySec, vrchatAwaySec),
      hmd: { available: hmd.available, activityLevel: hmd.activityLevel, onHead: hmd.hmdOnHead },
    };
  }
}
