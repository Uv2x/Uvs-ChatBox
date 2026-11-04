// SteamVR dashboard overlay service.
//
// Spawns a persistent PowerShell process that compiles + runs the overlay
// harness (native/overlayHarness.cs + the vendored Valve binding) and talks to
// it over stdio. The harness owns the SteamVR overlay + input; this service
// owns the button model and turns clicks into app actions.
//
// Protocol — see native/overlayHarness.cs. We send STATE lines and receive
// READY / CLICK / ERR lines.

import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import log from 'electron-log';
import { findRuntimeDir } from './vrActivity';

export interface OverlayButton {
  id: string;
  label: string;
  active: boolean;
}

export interface OverlayConfig {
  mode: 'dashboard' | 'wrist';
  hand: 'left' | 'right';
  /** wrist panel width in meters */
  sizeM: number;
  tiltDeg: number;
  /** offsets in meters, relative to the controller */
  up: number;
  fwd: number;
  right: number;
}

export class OverlayService extends EventEmitter {
  private ps: ChildProcessWithoutNullStreams | null = null;
  private ready = false;
  private outBuf = '';
  private lastState = '';
  private lastConfig = '';
  private starting = false;
  private mode: 'dashboard' | 'wrist' = 'dashboard';

  /** @param nativeDir directory holding openvr_api.cs + overlayHarness.cs */
  constructor(private nativeDir: () => string) {
    super();
  }

  isRunning(): boolean {
    return this.ps !== null;
  }

  /** The mode the running process was spawned with (mode changes need a restart
   *  since dashboard vs regular overlays are created differently). */
  currentMode(): 'dashboard' | 'wrist' {
    return this.mode;
  }

  async start(cfg: OverlayConfig): Promise<void> {
    if (this.ps || this.starting) return;
    if (process.platform !== 'win32') return;
    this.starting = true;
    try {
      const dir = await findRuntimeDir();
      if (!dir) {
        log.info('[overlay] SteamVR not found — not starting');
        this.emit('error', 'SteamVR not found');
        return;
      }
      const nat = this.nativeDir();
      const binding = path.join(nat, 'openvr_api.cs');
      const harness = path.join(nat, 'overlayHarness.cs');
      if (!existsSync(binding) || !existsSync(harness)) {
        log.error('[overlay] native sources missing in', nat);
        this.emit('error', 'overlay sources missing');
        return;
      }

      // Compile both C# files together, then run the harness loop. Paths are
      // passed via env so quoting/escaping can't break the command.
      const psCmd = [
        "$ErrorActionPreference='Stop'",
        "try {",
        "  Add-Type -Path @($env:UVS_BINDING, $env:UVS_HARNESS) -ReferencedAssemblies 'System.Drawing.dll' | Out-Null",
        "  [UvOverlay]::Run($env:UVS_OVR_RUNTIME)",
        "} catch {",
        "  [Console]::Out.WriteLine('ERR' + [char]9 + ($_.Exception.Message -replace '[\\r\\n\\t]',' '))",
        "}",
      ].join('\n');

      this.mode = cfg.mode;
      this.lastConfig = configLine(cfg);
      const ps = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psCmd],
        {
          windowsHide: true,
          env: {
            ...process.env,
            UVS_BINDING: binding,
            UVS_HARNESS: harness,
            UVS_OVR_RUNTIME: dir,
            UVS_OVERLAY_MODE: cfg.mode,
            UVS_OVERLAY_HAND: cfg.hand,
            UVS_OVERLAY_SIZE: String(cfg.sizeM),
            UVS_OVERLAY_TILT: String(cfg.tiltDeg),
            UVS_OVERLAY_UP: String(cfg.up),
            UVS_OVERLAY_FWD: String(cfg.fwd),
            UVS_OVERLAY_RIGHT: String(cfg.right),
          },
        },
      );
      this.ps = ps;
      ps.stdout.setEncoding('utf-8');
      ps.stdout.on('data', (d: string) => this.onStdout(d));
      ps.stderr.on('data', (d: Buffer) => log.warn('[overlay] stderr:', d.toString().slice(0, 200)));
      ps.on('error', (e) => {
        log.error('[overlay] spawn error:', e);
        this.emit('error', e.message);
      });
      ps.on('close', (code) => {
        log.info(`[overlay] exited code=${code}`);
        this.ps = null;
        this.ready = false;
        this.outBuf = '';
        this.emit('exit');
      });
    } finally {
      this.starting = false;
    }
  }

  stop(): void {
    if (!this.ps) return;
    try {
      this.ps.stdin.write('QUIT\n');
    } catch {
      /* ignore */
    }
    const dying = this.ps;
    this.ps = null;
    this.ready = false;
    setTimeout(() => {
      try {
        dying.kill();
      } catch {
        /* ignore */
      }
    }, 800);
  }

  private onStdout(chunk: string): void {
    this.outBuf += chunk;
    const lines = this.outBuf.split(/\r?\n/);
    this.outBuf = lines.pop() ?? '';
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (line === 'READY') {
        this.ready = true;
        this.emit('ready');
        if (this.lastConfig) this.writeLine(this.lastConfig);
        if (this.lastState) this.writeLine(this.lastState); // flush queued state
      } else if (line.startsWith('CLICK\t')) {
        this.emit('click', line.slice(6));
      } else if (line.startsWith('ERR\t')) {
        log.warn('[overlay] harness:', line.slice(4));
        this.emit('error', line.slice(4));
      } else {
        log.info('[overlay]', line);
      }
    }
  }

  /** Push the button model to the overlay. Safe to call before READY — the
   *  latest state is flushed once the harness reports ready. */
  setState(title: string, buttons: OverlayButton[]): void {
    const spec = buttons
      .slice(0, 8)
      .map((b) => `${sanitize(b.id)}|${sanitize(b.label)}|${b.active ? 1 : 0}`)
      .join(';');
    const line = `STATE\t${sanitize(title)}\t${spec}`;
    this.lastState = line;
    if (this.ready) this.writeLine(line);
  }

  /** Live-update the wrist placement/size (no restart). Ignored by the
   *  harness in dashboard mode. */
  setConfig(cfg: OverlayConfig): void {
    this.lastConfig = configLine(cfg);
    if (this.ready) this.writeLine(this.lastConfig);
  }

  private writeLine(line: string): void {
    if (!this.ps) return;
    try {
      this.ps.stdin.write(line + '\n');
    } catch (e) {
      log.warn('[overlay] write failed:', (e as Error).message);
    }
  }
}

function configLine(cfg: OverlayConfig): string {
  return [
    'CONFIG',
    cfg.hand,
    cfg.sizeM,
    cfg.tiltDeg,
    cfg.up,
    cfg.fwd,
    cfg.right,
  ].join('\t');
}

/** Strip the protocol delimiters from a field so labels/ids can't corrupt
 *  the line format. */
function sanitize(s: string): string {
  return (s ?? '').replace(/[\t\r\n|;]/g, ' ').trim();
}
