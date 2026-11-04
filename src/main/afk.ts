import { execFile } from 'child_process';
import type { AfkState } from '../shared/types';

/**
 * Detects system-wide idle time (mouse + keyboard) to drive an auto-AFK status.
 *
 * On Windows we read idle milliseconds via the Win32 `GetLastInputInfo` API
 * through a tiny inline C# snippet compiled by PowerShell's Add-Type. This
 * captures GLOBAL input (not just this app's window), which is what we want.
 *
 * On other platforms we currently return idle 0 (never AFK); a macOS path
 * could shell out to `ioreg`/HIDIdleTime and Linux to `xprintidle`.
 */
const PS_IDLE = String.raw`
$src = @"
using System;
using System.Runtime.InteropServices;
public static class IdleTime {
  [StructLayout(LayoutKind.Sequential)]
  struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
  [DllImport("kernel32.dll")] static extern uint GetTickCount();
  public static uint GetIdleMs() {
    LASTINPUTINFO lii = new LASTINPUTINFO();
    lii.cbSize = (uint)Marshal.SizeOf(lii);
    GetLastInputInfo(ref lii);
    return GetTickCount() - lii.dwTime;
  }
}
"@
Add-Type -TypeDefinition $src
[IdleTime]::GetIdleMs()
`;

export class AfkDetector {
  private available = process.platform === 'win32';
  private afk = false;

  /** External AFK override sourced from VRChat's own /avatar/parameters/AFK
   *  OSC signal (VRCOSC's AFK Detection module behaves the same way).
   *  null = never set this session; true/false = trust VRChat's signal. */
  private externalAfk: boolean | null = null;
  private externalAt = 0;

  /** Source preference set from settings.afk.source.
   *  'vrchat' = only trust the OSC signal (idle ignored even when no signal).
   *  'idle'   = legacy Win32 idle behaviour.
   *  'auto'   = prefer the OSC signal when we've seen one in the last
   *             ~10 minutes; otherwise fall back to idle. (Default.) */
  private source: 'vrchat' | 'idle' | 'auto' = 'auto';
  private static readonly EXTERNAL_TTL_MS = 10 * 60_000;

  /** True when the OSC target is a remote host (i.e. a standalone Quest on
   *  the LAN, not this PC). In that case the user is in the headset, NOT at
   *  the PC — so PC keyboard/mouse idle is meaningless for AFK and must not
   *  be used, or the app would falsely mark them AFK after the idle
   *  threshold. Set from main whenever the OSC endpoint changes. */
  private remoteTarget = false;

  setSource(s: 'vrchat' | 'idle' | 'auto' | undefined): void {
    this.source = s ?? 'auto';
  }

  setRemoteTarget(remote: boolean): void {
    this.remoteTarget = remote;
  }

  /** Feed in VRChat's `/avatar/parameters/AFK` value when we observe it. */
  setVrchatAfk(afk: boolean): void {
    this.externalAfk = afk;
    this.externalAt = Date.now();
  }

  async poll(thresholdSec: number): Promise<AfkState> {
    const idleSec = await this.idleSeconds();
    const idleAfk = idleSec >= thresholdSec;

    // Decide whose signal wins this tick.
    const externalFresh =
      this.externalAfk !== null && Date.now() - this.externalAt < AfkDetector.EXTERNAL_TTL_MS;
    if (this.source === 'vrchat') {
      this.afk = externalFresh ? !!this.externalAfk : false;
    } else if (this.source === 'idle') {
      // Explicit idle choice is honored on a local target, but on a remote
      // Quest PC-idle is meaningless — never auto-AFK from it there.
      this.afk = this.remoteTarget ? false : idleAfk;
    } else {
      // auto: trust VRChat's AFK param when we've heard from it. Otherwise
      // fall back to PC idle ONLY on a local target — on a standalone Quest
      // the user is in the headset, so PC idle would falsely mark them AFK.
      this.afk = externalFresh ? !!this.externalAfk : this.remoteTarget ? false : idleAfk;
    }
    return { afk: this.afk, idleSec };
  }

  isAfk(): boolean {
    return this.afk;
  }

  private idleSeconds(): Promise<number> {
    if (!this.available) return Promise.resolve(0);
    return new Promise((resolve) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', PS_IDLE],
        { windowsHide: true, timeout: 3000 },
        (err, stdout) => {
          if (err) return resolve(0);
          const ms = parseInt(String(stdout).trim(), 10);
          resolve(Number.isFinite(ms) ? Math.floor(ms / 1000) : 0);
        },
      );
    });
  }
}
