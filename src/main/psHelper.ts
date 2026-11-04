// Long-lived PowerShell + inline-C# helper process.
//
// The SteamVR probes used to spawn PowerShell and recompile their C# on every
// poll (~2 s of CPU each time, every few seconds, while VR is running). A
// PsJsonHelper keeps one process instead: the script compiles its C# once,
// then answers one JSON line per request line written to stdin. "QUIT" — or
// stdin closing because the app exited — ends it. The overlay harness
// (overlay.ts) uses the same stdin/stdout line protocol.

import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import log from 'electron-log';

export class PsJsonHelper {
  private ps: ChildProcessWithoutNullStreams | null = null;
  private outBuf = '';
  /** The request waiting for a reply, tied to the process it was sent to so
   *  a late exit of a killed process can't answer a newer request. */
  private waiting: { ps: ChildProcessWithoutNullStreams; reply: (line: string) => void } | null =
    null;
  private queue: Promise<unknown> = Promise.resolve();
  /** Why the last request got no reply (timeout, exit, spawn error). */
  lastFailure = '';

  constructor(
    private readonly name: string,
    private readonly script: string,
  ) {}

  /** Send one request line. Resolves with the reply line, or '' when the
   *  helper timed out or died (see lastFailure). One request at a time. */
  request(line: string, timeoutMs: number): Promise<string> {
    const run = this.queue.then(() => this.send(line, timeoutMs));
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Stop the helper (app quit). */
  dispose(): void {
    const ps = this.ps;
    this.ps = null;
    if (!ps) return;
    try {
      ps.stdin.write('QUIT\n');
    } catch {
      /* already gone */
    }
    setTimeout(() => {
      try {
        ps.kill();
      } catch {
        /* ignore */
      }
    }, 800);
  }

  private send(line: string, timeoutMs: number): Promise<string> {
    return new Promise((resolve) => {
      this.lastFailure = '';
      const ps = this.ensure();
      const timer = setTimeout(() => {
        this.waiting = null;
        this.lastFailure = 'timeout';
        if (this.ps === ps) this.ps = null;
        ps.kill();
        resolve('');
      }, timeoutMs);
      this.waiting = {
        ps,
        reply: (reply) => {
          clearTimeout(timer);
          if (!reply) this.lastFailure ||= 'helper exited';
          resolve(reply);
        },
      };
      ps.stdin.write(`${line}\n`);
    });
  }

  private ensure(): ChildProcessWithoutNullStreams {
    if (this.ps) return this.ps;
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', this.script], {
      windowsHide: true,
    });
    this.ps = ps;
    // A write racing the helper's exit must not become an unhandled error.
    ps.stdin.on('error', (e) => log.warn(`[${this.name}] stdin:`, e.message));
    ps.stdout.setEncoding('utf-8');
    ps.stdout.on('data', (chunk: string) => {
      this.outBuf += chunk;
      const lines = this.outBuf.split(/\r?\n/);
      this.outBuf = lines.pop() ?? '';
      for (const l of lines) if (l.trim().startsWith('{')) this.settle(ps, l.trim());
    });
    ps.stderr.on('data', (d: Buffer) =>
      log.warn(`[${this.name}] stderr:`, d.toString().slice(0, 200)),
    );
    ps.on('error', (e) => {
      this.lastFailure = e.message;
      this.settle(ps, '');
    });
    ps.on('close', (code) => {
      log.info(`[${this.name}] helper exited code=${code}`);
      if (this.ps === ps) {
        this.ps = null;
        this.outBuf = '';
      }
      this.settle(ps, '');
    });
    return ps;
  }

  private settle(ps: ChildProcessWithoutNullStreams, line: string): void {
    const w = this.waiting;
    if (!w || w.ps !== ps) return;
    this.waiting = null;
    w.reply(line);
  }
}
