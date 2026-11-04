// Quest headset battery via adb (Android Debug Bridge).
//
// WHY: Meta's Oculus Link runtime does NOT publish battery through OpenVR —
// every property read comes back UnknownProperty (verified: the HMD's display
// frequency reads fine through the same call, battery doesn't). The only way a
// PC app can learn the Quest's battery is to talk to the headset's Android OS
// directly over adb. This reads the HEADSET level via `dumpsys battery`.
// Controllers are Bluetooth peripherals of the headset and are not exposed
// this way — nothing on the PC side can read them over Link.
//
// Requirements (one-time, on the user's side):
//   1. Quest Developer Mode ON (free Meta dev account + toggle in the phone app)
//   2. Android platform-tools installed (adb.exe), or a path set in Settings
//   3. Plug in the Link cable and tap "Allow USB debugging" in the headset
//
// Everything degrades gracefully: no adb / no device / unauthorized just yields
// available:false with a reason the panel surfaces.

import { execFile } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import log from 'electron-log';
import type { QuestAdbState as QuestBatteryResult } from '../shared/types';

const NONE: QuestBatteryResult = {
  available: false,
  percent: 0,
  charging: false,
  state: 'no-adb',
  detail: 'adb not found',
};

export class AdbBatteryProbe {
  private adbPath: string | null | undefined; // undefined = not yet resolved
  private last: QuestBatteryResult = NONE;
  private lastAt = 0;
  private inflight: Promise<QuestBatteryResult> | null = null;
  // Battery moves slowly and adb spawns aren't free; poll modestly.
  private static MIN_INTERVAL_MS = 20_000;

  constructor(private getConfiguredPath: () => string | undefined) {}

  state(): QuestBatteryResult {
    return this.last;
  }

  /** Re-resolve the adb path next call (after the user sets one in Settings). */
  invalidatePath(): void {
    this.adbPath = undefined;
  }

  private resolveAdb(): string | null {
    if (this.adbPath !== undefined) return this.adbPath;
    const configured = (this.getConfiguredPath() ?? '').trim();
    const candidates = [
      configured,
      path.join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
      path.join(process.env.USERPROFILE ?? '', 'platform-tools', 'adb.exe'),
      'C:\\platform-tools\\adb.exe',
      path.join(process.env.ProgramFiles ?? '', 'platform-tools', 'adb.exe'),
      path.join(
        process.env.LOCALAPPDATA ?? '',
        'Programs',
        'SideQuest',
        'resources',
        'app.asar.unpacked',
        'build',
        'platform-tools',
        'adb.exe',
      ),
    ].filter(Boolean);
    for (const c of candidates) {
      if (c && existsSync(c)) {
        this.adbPath = c;
        return c;
      }
    }
    // Last resort: adb on PATH (execFile resolves it). We can't existsSync a
    // bare command, so trust PATH and let the call fail into 'no-adb' if wrong.
    this.adbPath = 'adb';
    return this.adbPath;
  }

  private run(adb: string, args: string[], timeoutMs = 6000): Promise<{ out: string; err: string; code: number | null }> {
    return new Promise((resolve) => {
      execFile(adb, args, { windowsHide: true, timeout: timeoutMs }, (error, stdout, stderr) => {
        const code = error && typeof (error as { code?: number }).code === 'number' ? (error as { code: number }).code : error ? 1 : 0;
        resolve({ out: String(stdout || ''), err: String(stderr || ''), code });
      });
    });
  }

  async read(): Promise<QuestBatteryResult> {
    if (process.platform !== 'win32') return { ...NONE, state: 'no-adb', detail: 'Windows only' };
    if (this.inflight) return this.inflight;
    if (Date.now() - this.lastAt < AdbBatteryProbe.MIN_INTERVAL_MS) return this.last;

    this.inflight = this.doRead().then((res) => {
      this.last = res;
      this.lastAt = Date.now();
      this.inflight = null;
      log.info(`[questBattery] ${res.state} ${res.available ? res.percent + '%' : res.detail}`);
      return res;
    });
    return this.inflight;
  }

  /** Force a fresh read now (used by the panel's Re-scan button). */
  async readNow(): Promise<QuestBatteryResult> {
    this.lastAt = 0;
    this.invalidatePath();
    return this.read();
  }

  private async doRead(): Promise<QuestBatteryResult> {
    const adb = this.resolveAdb();
    if (!adb) return { ...NONE, state: 'no-adb', detail: 'adb not found' };

    // 1. Which devices does adb see, and are they authorized?
    const dev = await this.run(adb, ['devices']);
    if (dev.code !== 0 && !dev.out) {
      return { ...NONE, state: 'no-adb', detail: `adb not runnable (${(dev.err || 'spawn failed').slice(0, 60)})` };
    }
    // Lines after the header: "SERIAL\tdevice" | "SERIAL\tunauthorized" | "SERIAL\toffline"
    const rows = dev.out
      .split(/\r?\n/)
      .slice(1)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('*') && !l.startsWith('adb '));
    if (rows.length === 0) {
      return { ...NONE, state: 'no-device', detail: 'No Quest seen by adb — plug in Link cable' };
    }
    if (rows.some((r) => /\bunauthorized\b/.test(r))) {
      return { ...NONE, state: 'unauthorized', detail: 'Put on the headset and tap "Allow USB debugging"' };
    }
    if (!rows.some((r) => /\bdevice$/.test(r) || /\tdevice\b/.test(r))) {
      return { ...NONE, state: 'no-device', detail: `Quest not ready (${rows[0]?.slice(0, 40)})` };
    }

    // 2. Read the battery.
    const bat = await this.run(adb, ['shell', 'dumpsys', 'battery']);
    if (!bat.out) {
      return { ...NONE, state: 'error', detail: `dumpsys failed (${(bat.err || 'no output').slice(0, 60)})` };
    }
    const level = Number(bat.out.match(/\blevel:\s*(\d+)/)?.[1] ?? NaN);
    const scaleRaw = Number(bat.out.match(/\bscale:\s*(\d+)/)?.[1] ?? NaN);
    const scale = Number.isFinite(scaleRaw) && scaleRaw > 0 ? scaleRaw : 100;
    const status = Number(bat.out.match(/\bstatus:\s*(\d+)/)?.[1] ?? NaN);
    // Android BatteryManager: 2 = Charging, 5 = Full. AC/USB "plugged" is nonzero.
    const plugged = Number(bat.out.match(/\b(?:AC|USB) powered:\s*true/i) ? 1 : 0);
    if (!Number.isFinite(level)) {
      return { ...NONE, state: 'error', detail: 'Could not parse battery level' };
    }
    const percent = Math.max(0, Math.min(100, Math.round((level / scale) * 100)));
    const charging = status === 2 || status === 5 || plugged === 1;
    return { available: true, percent, charging, state: 'ok', detail: `headset ${percent}%` };
  }
}
