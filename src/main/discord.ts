// Discord Rich Presence via the local Discord client's IPC socket.
//
// No account or token: the desktop Discord app exposes a named pipe
// (\\.\pipe\discord-ipc-0 .. 9). We connect, handshake with a Discord
// *application* client_id (a public id the user creates for free in the
// Discord Developer Portal — its app name is the "Playing X" line), then push
// SET_ACTIVITY frames. Everything degrades gracefully: no Discord running, bad
// client id, or a closed socket just means "not connected" and a periodic
// reconnect.
//
// Frame format: [opcode int32-LE][length int32-LE][utf8 JSON].
//   op 0 HANDSHAKE, 1 FRAME, 2 CLOSE, 3 PING, 4 PONG.

import net from 'net';
import { EventEmitter } from 'events';
import log from 'electron-log';

export interface DiscordActivity {
  details?: string;
  state?: string;
  startTimestampMs?: number;
  largeImageKey?: string;
  largeImageText?: string;
  smallImageKey?: string;
  smallImageText?: string;
}

export type DiscordState =
  | 'off'
  | 'connecting'
  | 'connected'
  | 'no-client' // Discord app not running / no pipe
  | 'invalid-id'
  | 'error';

const UPDATE_MS = 15_000; // stay well under Discord's ~5/20s rate limit
const RECONNECT_MS = 12_000;

export class DiscordPresence extends EventEmitter {
  private sock: net.Socket | null = null;
  private buf = Buffer.alloc(0);
  private ready = false;
  private clientId = '';
  private enabled = false;
  private pending: DiscordActivity | null = null;
  private lastSentAt = 0;
  private flushTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stateStr: DiscordState = 'off';
  private lastError = '';

  status(): { state: DiscordState; error: string } {
    return { state: this.stateStr, error: this.lastError };
  }

  /** Apply enabled + clientId. Connects, reconnects on id change, or shuts down. */
  reconfigure(enabled: boolean, clientId: string): void {
    const id = (clientId ?? '').trim();
    if (!enabled || !id) {
      this.enabled = false;
      this.teardown('off');
      return;
    }
    if (this.enabled && id === this.clientId && (this.sock || this.reconnectTimer)) return;
    this.enabled = true;
    this.clientId = id;
    this.teardown('connecting', true); // keep enabled; drop old socket
    this.connect();
  }

  /** Push the latest activity (throttled). Null clears presence. */
  setActivity(activity: DiscordActivity | null): void {
    this.pending = activity;
    this.maybeFlush();
  }

  private setState(s: DiscordState, err = ''): void {
    if (this.stateStr !== s || (err && err !== this.lastError)) {
      this.stateStr = s;
      this.lastError = err;
      this.emit('status', this.status());
    }
  }

  private connect(): void {
    this.setState('connecting');
    this.tryPipe(0);
  }

  private tryPipe(i: number): void {
    if (!this.enabled) return;
    if (i > 9) {
      this.setState('no-client', 'Discord desktop app not running');
      this.scheduleReconnect();
      return;
    }
    const pipePath = `\\\\?\\pipe\\discord-ipc-${i}`;
    const sock = net.connect(pipePath);
    let settled = false;
    sock.once('connect', () => {
      settled = true;
      this.sock = sock;
      this.buf = Buffer.alloc(0);
      this.ready = false;
      sock.on('data', (d) => this.onData(d));
      sock.on('error', (e) => this.onSocketDown(e.message));
      sock.on('close', () => this.onSocketDown('closed'));
      // HANDSHAKE
      this.send(0, { v: 1, client_id: this.clientId });
    });
    sock.once('error', () => {
      if (settled) return;
      sock.destroy();
      this.tryPipe(i + 1); // this index not present; try the next
    });
  }

  private onSocketDown(why: string): void {
    if (!this.sock) return;
    log.info('[discord] socket down:', why);
    try {
      this.sock.destroy();
    } catch {
      /* ignore */
    }
    this.sock = null;
    this.ready = false;
    if (this.enabled) {
      if (this.stateStr !== 'invalid-id') this.setState('error', why);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || !this.enabled) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.enabled) this.connect();
    }, RECONNECT_MS);
  }

  private onData(chunk: Buffer): void {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (this.buf.length >= 8) {
      const op = this.buf.readInt32LE(0);
      const len = this.buf.readInt32LE(4);
      if (this.buf.length < 8 + len) break;
      const body = this.buf.slice(8, 8 + len).toString('utf8');
      this.buf = this.buf.slice(8 + len);
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(body);
      } catch {
        /* ignore */
      }
      this.onFrame(op, payload);
    }
  }

  private onFrame(op: number, payload: Record<string, unknown>): void {
    if (op === 3) {
      this.send(4, payload); // PING -> PONG
      return;
    }
    if (op === 2) {
      // CLOSE — usually a bad client_id.
      const code = Number((payload as { code?: number }).code);
      const msg = String((payload as { message?: string }).message ?? 'closed');
      if (code === 4000 || /client id/i.test(msg)) {
        this.setState('invalid-id', 'Invalid Discord Application ID');
      }
      this.onSocketDown(msg);
      return;
    }
    if (op === 1) {
      const evt = (payload as { evt?: string }).evt;
      if (evt === 'READY') {
        this.ready = true;
        this.setState('connected');
        this.lastSentAt = 0;
        this.maybeFlush(true);
      } else if (evt === 'ERROR') {
        const data = (payload as { data?: { code?: number; message?: string } }).data;
        this.setState('error', data?.message ?? 'Discord error');
      }
    }
  }

  private maybeFlush(force = false): void {
    if (!this.ready || !this.sock) return;
    const wait = UPDATE_MS - (Date.now() - this.lastSentAt);
    if (force || wait <= 0) {
      this.flushNow();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flushNow();
      }, wait);
    }
  }

  private flushNow(): void {
    if (!this.ready || !this.sock) return;
    this.lastSentAt = Date.now();
    const a = this.pending;
    const activity = a
      ? {
          details: clip(a.details),
          state: clip(a.state),
          timestamps: a.startTimestampMs ? { start: a.startTimestampMs } : undefined,
          assets:
            a.largeImageKey || a.smallImageKey
              ? {
                  large_image: a.largeImageKey || undefined,
                  large_text: clip(a.largeImageText),
                  small_image: a.smallImageKey || undefined,
                  small_text: clip(a.smallImageText),
                }
              : undefined,
        }
      : undefined;
    this.send(1, {
      cmd: 'SET_ACTIVITY',
      args: { pid: process.pid, activity },
      nonce: Math.random().toString(36).slice(2),
    });
  }

  private send(op: number, obj: unknown): void {
    if (!this.sock) return;
    try {
      const body = Buffer.from(JSON.stringify(obj), 'utf8');
      const header = Buffer.alloc(8);
      header.writeInt32LE(op, 0);
      header.writeInt32LE(body.length, 4);
      this.sock.write(Buffer.concat([header, body]));
    } catch (e) {
      log.warn('[discord] send failed:', (e as Error).message);
    }
  }

  private teardown(state: DiscordState, keepEnabled = false): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.sock) {
      try {
        this.sock.destroy();
      } catch {
        /* ignore */
      }
      this.sock = null;
    }
    this.ready = false;
    if (!keepEnabled) this.enabled = false;
    this.setState(state);
  }

  stop(): void {
    this.teardown('off');
  }
}

/** Discord requires details/state to be 2–128 chars; trim + drop if too short. */
function clip(s: string | undefined): string | undefined {
  const t = (s ?? '').trim();
  if (t.length < 2) return undefined;
  return t.length > 128 ? t.slice(0, 128) : t;
}
