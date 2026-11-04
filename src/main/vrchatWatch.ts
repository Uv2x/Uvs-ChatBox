// VRChat process watcher — polls for VRChat.exe and emits transitions.
//
// Powers two features:
//   - "Auto-start with VRChat": main.ts starts/stops the live loop when the
//     game appears/exits (only the loop it started itself — a manually
//     started loop is never killed by the watcher).
//   - Session Timer module: `runningSince()` feeds the "⏱️ in VR 2h 14m"
//     chatbox line.
//
// Poll transport is `tasklist` via execFile (no shell, ~zero cost). On the
// not-running → running transition we do a single PowerShell call to read
// the REAL process start time, so the session timer is correct even when
// this app was launched long after VRChat.

import { execFile } from 'child_process';
import { EventEmitter } from 'events';
import log from 'electron-log';

const POLL_MS = 10_000;

export class VrchatProcessWatcher extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private since: number | null = null;
  private checking = false;

  /** Epoch ms VRChat has been running since, or null when it isn't. */
  runningSince(): number | null {
    return this.since;
  }

  isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.timer || process.platform !== 'win32') return;
    log.info('[vrchatWatch] starting');
    this.timer = setInterval(() => void this.poll(), POLL_MS);
    void this.poll();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private poll(): Promise<void> {
    if (this.checking) return Promise.resolve();
    this.checking = true;
    return new Promise((resolve) => {
      execFile(
        'tasklist',
        ['/FI', 'IMAGENAME eq VRChat.exe', '/FO', 'CSV', '/NH'],
        { windowsHide: true, timeout: 8000 },
        (_err, stdout) => {
          this.checking = false;
          const nowRunning = /VRChat\.exe/i.test(String(stdout || ''));
          if (nowRunning && !this.running) {
            this.running = true;
            this.since = Date.now(); // provisional until the real start time lands
            void this.fetchStartTime();
            log.info('[vrchatWatch] VRChat started');
            this.emit('started');
          } else if (!nowRunning && this.running) {
            this.running = false;
            this.since = null;
            log.info('[vrchatWatch] VRChat exited');
            this.emit('stopped');
          }
          resolve();
        },
      );
    });
  }

  /** One-shot: replace the provisional `since` with the process's actual
   *  start time (matters when VRChat was already up before this app). */
  private fetchStartTime(): Promise<void> {
    return new Promise((resolve) => {
      execFile(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          // DateTimeOffset gives epoch ms directly; silence errors so a
          // permissions hiccup just keeps the provisional timestamp.
          "try { [long]([System.DateTimeOffset](Get-Process VRChat -ErrorAction Stop).StartTime).ToUnixTimeMilliseconds() } catch { '' }",
        ],
        { windowsHide: true, timeout: 8000 },
        (_err, stdout) => {
          const ms = Number(String(stdout || '').trim());
          if (Number.isFinite(ms) && ms > 0 && this.running) this.since = ms;
          resolve();
        },
      );
    });
  }
}
