// Battery reader — VR devices with a PC/laptop fallback.
//
// Priority:
//   1. Quest HEADSET battery via adb (AdbBatteryProbe). Meta's Link runtime
//      won't expose Quest battery through OpenVR (every property reads back
//      UnknownProperty), so for Quest-over-Link this is the only working
//      source. See questBattery.ts.
//   2. SteamVR device battery (HMD / controllers / trackers) via VRBatteryProbe
//      — works for NATIVE SteamVR headsets (Index, Vive) that actually report
//      battery through OpenVR. On Quest these read 0%, so we drop those bogus
//      readings when adb has given us a real headset number.
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

  async collect(): Promise<BatteryStatus> {
    // Kick both probes; each self-throttles.
    const [vr, adb] = await Promise.all([this.vr.poll(), this.adb.read()]);

    if (adb.available) {
      // Quest headset from adb + any VR controllers/trackers that report a
      // REAL value (percent > 0). Quest's OpenVR controllers read 0% (bogus),
      // so those get dropped; a native SteamVR device with a real % is kept.
      const devices: BatteryDevice[] = [
        { kind: 'hmd', name: 'Headset', percent: adb.percent, charging: adb.charging },
      ];
      for (const d of vr.devices) {
        if (d.kind !== 'hmd' && d.percent > 0) devices.push(d);
      }
      return { available: true, devices };
    }

    // No adb headset reading — trust OpenVR for native SteamVR headsets.
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
