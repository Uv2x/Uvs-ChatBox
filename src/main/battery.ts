// Battery reader — VR devices with a PC/laptop fallback.
//
// Priority:
//   1. SteamVR device battery (HMD / controllers / trackers) via
//      VRBatteryProbe — only devices that genuinely report battery. Over Quest
//      Link that is the headset plus trackers (e.g. SlimeVR); Touch
//      controllers report nothing there, so they are simply absent.
//   2. Quest HEADSET battery via adb (AdbBatteryProbe), optional: when it
//      works it is read straight from the headset, so it replaces SteamVR's
//      headset entry (and covers the headset while SteamVR isn't running).
//   3. If neither, fall back to the host PC / laptop battery.
//
// Returns the shared BatteryStatus { available, devices[] } shape so the
// chatbox module + panel can render one or many devices uniformly.

import si from 'systeminformation';
import log from 'electron-log';
import type { BatteryStatus, BatteryDevice } from '../shared/types';
import { VRBatteryProbe } from './vrBattery';
import { AdbBatteryProbe } from './questBattery';

export class BatteryCollector {
  private vr = new VRBatteryProbe();
  private adb: AdbBatteryProbe;
  private pcCache: BatteryStatus = { available: false, devices: [] };
  private pcAt = 0;
  private static readonly PC_TTL_MS = 20_000;

  constructor(getAdbPath: () => string | undefined = () => undefined) {
    this.adb = new AdbBatteryProbe(getAdbPath);
  }

  /** Diagnostic string from the last VR + adb probes (for the panel). */
  vrError(): string {
    const a = this.adb.state();
    const adbPart = a.available ? `adb: ${a.percent}%` : `adb: ${a.state} (${a.detail})`;
    const vrPart = this.vr.error();
    return vrPart ? `${adbPart} | vr: ${vrPart}` : adbPart;
  }

  /** Structured adb state for the panel's setup guidance. */
  adbState() {
    return this.adb.state();
  }

  /** Force an immediate fresh adb read (panel Re-scan button). */
  async rescanAdb() {
    return this.adb.readNow();
  }

  /** Stop the SteamVR helper process (app quit). */
  dispose(): void {
    this.vr.dispose();
  }

  async collect(): Promise<BatteryStatus> {
    // Kick both probes; each self-throttles.
    const [vr, adb] = await Promise.all([this.vr.poll(), this.adb.read()]);

    if (adb.available) {
      const devices: BatteryDevice[] = [
        { kind: 'hmd', name: 'Headset', percent: adb.percent, charging: adb.charging },
        ...vr.devices.filter((d) => d.kind !== 'hmd'),
      ];
      return { available: true, devices };
    }

    if (vr.available && vr.devices.length > 0) return vr;

    // Nothing from VR — PC / laptop battery fallback.
    return this.collectPc();
  }

  private async collectPc(): Promise<BatteryStatus> {
    if (Date.now() - this.pcAt < BatteryCollector.PC_TTL_MS) return this.pcCache;
    try {
      const b = await si.battery();
      this.pcCache = b.hasBattery
        ? {
            available: true,
            devices: [
              {
                kind: 'other',
                name: 'PC',
                percent: Math.max(0, Math.min(100, Math.round(b.percent ?? 0))),
                charging: !!b.isCharging || !!b.acConnected,
              },
            ],
          }
        : { available: false, devices: [] };
    } catch (e) {
      log.warn('[battery] PC read failed:', (e as Error).message);
      this.pcCache = { available: false, devices: [] };
    }
    this.pcAt = Date.now();
    return this.pcCache;
  }
}
