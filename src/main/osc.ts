import { Client, Server } from 'node-osc';
import { EventEmitter } from 'events';
import log from 'electron-log';
import type { OscSettings, OscTelemetry, AudioStatus } from '../shared/types';
import { PILL_METHODS, type PillMethod } from '../shared/types';
import { transformFont, type FontStyle } from './fontTransformer';
import { applyTextEffects } from './textEffects';

/**
 * Wraps node-osc for both sending to VRChat and listening to inbound avatar
 * parameters, while tracking throughput telemetry.
 *
 * Outbound (to VRChat, default 127.0.0.1:9000):
 *   /chatbox/input  s b b   -> message, send-immediately, notification-sound
 *   /chatbox/typing b
 *
 * Inbound (VRChat sends to us, default 127.0.0.1:9001):
 *   /avatar/parameters/MuteSelf  b
 *   /avatar/parameters/Earmuffs  b   (deafen; name varies by avatar)
 */
export class OscManager extends EventEmitter {
  private client: Client | null = null;
  private server: Server | null = null;
  private ip = '127.0.0.1';
  private port = 9000;
  private listenPort = 9001;

  // Telemetry counters (reset each tick by sampleTelemetry()).
  private sent = 0;
  private recv = 0;
  private bytesOut = 0;
  private bytesIn = 0;
  private totalSent = 0;
  private totalRecv = 0;
  private history: number[] = new Array(30).fill(0);

  // Listener health, for the System Check page.
  private lastInboundAt = 0;
  private listening = false;
  private listenError = '';

  private audio: AudioStatus = { muted: false, deafened: false, changedAt: 0 };

  /** Global pause flag. When true, sendChatbox is a silent no-op so the
   *  chatbox stays empty regardless of which subsystem (live loop, relay,
   *  refresh, auto-responder, scheduled queue) is trying to write. This is
   *  the single chokepoint for the "Stop
   *  Everything" panic button — works because every send in the app
   *  ultimately funnels through this method. */
  private paused = false;

  /** Unicode font style applied to every chatbox send. Setter is called
   *  from main on startup + every settings save so the renderer's pick
   *  takes effect immediately. */
  private chatboxFont: FontStyle = 'plain';

  /** When true, apply markdown-ish Unicode text effects (*bold* _italic_
   *  ~strike~) to every chatbox send. Setter mirrors chatboxFont. */
  private chatboxMarkdown = false;

  /** When true, /chatbox/input is suppressed entirely so another OSC tool
   *  (Magic Chatbox, etc.) can own the in-VRChat chatbox. Set persistently
   *  from settings — different intent from the temporary `paused` panic
   *  flag, but the same final behavior at the send chokepoint. */
  private externalChatbox = false;

  /** When true, apply a minimal-background ("pill") trick to every chatbox
   *  send. Unofficial: VRChat doesn't document any of these, and the classic
   *  one (VRCOSC's "\u0003\u001f" suffix) stopped working when VRChat moved
   *  the client to Unity 6 (2026.3.3, Oct 2 2026) — whose reworked
   *  TextMeshPro measures text differently. `pillMethod` picks the variant;
   *  the Settings "Pill Lab" sends each so the user can find one that works. */
  private chatboxPill = false;
  private pillMethod: PillMethod = 'vrcosc';

  static readonly MAX_LEN = 144;

  setChatboxFont(style: FontStyle): void {
    this.chatboxFont = style;
  }
  setChatboxMarkdown(v: boolean): void {
    this.chatboxMarkdown = v;
  }
  setExternalChatbox(v: boolean): void {
    if (this.externalChatbox !== v) {
      log.info('[osc] externalChatbox =', v);
    }
    this.externalChatbox = v;
  }
  isExternalChatbox(): boolean {
    return this.externalChatbox;
  }
  setChatboxPill(v: boolean): void {
    this.chatboxPill = v;
  }
  setPillMethod(m: PillMethod | undefined): void {
    this.pillMethod = m && PILL_METHODS.includes(m) ? m : 'vrcosc';
  }

  setPaused(p: boolean): void {
    this.paused = p;
    this.emit('paused', p);
  }
  isPaused(): boolean {
    return this.paused;
  }

  /** Snapshot for the System Check page. */
  health(): {
    target: string;
    targetIp: string;
    listenPort: number;
    listening: boolean;
    listenError: string;
    lastInboundAt: number;
    totalSent: number;
    totalRecv: number;
  } {
    return {
      target: `${this.ip}:${this.port}`,
      targetIp: this.ip,
      listenPort: this.listenPort,
      listening: this.listening,
      listenError: this.listenError,
      lastInboundAt: this.lastInboundAt,
      totalSent: this.totalSent,
      totalRecv: this.totalRecv,
    };
  }

  configure(settings: OscSettings): void {
    const clientChanged = settings.ip !== this.ip || settings.port !== this.port;
    const serverChanged = settings.listenPort !== this.listenPort;
    this.ip = settings.ip;
    this.port = settings.port;
    this.listenPort = settings.listenPort;

    if (clientChanged || !this.client) {
      this.closeClient();
      this.client = new Client(this.ip, this.port);
    }
    if (serverChanged || !this.server) {
      this.startServer();
    }
  }

  private startServer(): void {
    this.closeServer();
    this.listening = false;
    this.listenError = '';
    try {
      this.server = new Server(this.listenPort, '0.0.0.0');
      this.server.on('listening', () => {
        this.listening = true;
        this.listenError = '';
      });
      // node-osc binds its UDP socket without an 'error' listener, so a bind
      // failure would surface as an unhandled exception. Record it instead so
      // the System Check can report it. (The socket is a private field.)
      const sock = (this.server as unknown as { _sock?: NodeJS.EventEmitter })._sock;
      sock?.on('error', (e: Error) => {
        this.listening = false;
        this.listenError = e.message;
        log.warn(`[osc] listener on port ${this.listenPort} failed:`, e.message);
      });
      this.server.on('message', (msg: unknown[]) => {
        // msg = [address, ...args]
        const address = String(msg[0] ?? '');
        const args = msg.slice(1);
        this.lastInboundAt = Date.now();
        this.recv++;
        this.totalRecv++;
        // OSC type-tag + value bytes (estimate): address bytes + ~8 byte arg.
        this.bytesIn += Buffer.byteLength(address, 'utf8') + 8;
        this.handleInbound(address, args);
      });
    } catch (e) {
      // Port likely in use; surface but don't crash.
      this.emit('error', e);
    }
  }

  private handleInbound(address: string, args: unknown[]): void {
    const val = args[0];
    const asBool = val === true || val === 1 || val === '1';
    let changed = false;

    // Live parameter monitor (spec §12) — emit every inbound message.
    const at = Date.now();
    this.emit('monitor', { address, value: String(val), at });

    if (address === '/avatar/parameters/MuteSelf') {
      if (this.audio.muted !== asBool) {
        this.audio.muted = asBool;
        changed = true;
      }
    } else if (
      address === '/avatar/parameters/Earmuffs' ||
      address === '/avatar/parameters/Deafen'
    ) {
      if (this.audio.deafened !== asBool) {
        this.audio.deafened = asBool;
        changed = true;
      }
    } else if (address === '/avatar/parameters/AFK') {
      // VRChat's own AFK signal (also used by VRCOSC's AFK Detection module).
      // Surfaced as a separate event so AfkDetector / main can prefer this
      // over the Win32-only idle-time fallback.
      this.emit('vrchat-afk', { afk: asBool, at: Date.now() });
    }

    if (changed) {
      this.audio.changedAt = Date.now();
      this.emit('audio', { ...this.audio });
    }
  }

  getAudioStatus(): AudioStatus {
    return { ...this.audio };
  }

  static clamp(text: string): string {
    return OscManager.clampTo(text, OscManager.MAX_LEN);
  }

  /** Clamp to `max` UTF-16 units — what VRChat actually counts (its 144 limit
   *  is C# string.Length). Counting codepoints let emoji / astral glyphs
   *  overshoot, so VRChat cut the END off the message — lyric tails and the
   *  pill suffix were the first casualties. Never splits a surrogate pair. */
  static clampTo(text: string, max: number): string {
    if (text.length <= max) return text;
    let out = '';
    for (const ch of text) {
      if (out.length + ch.length > max) break;
      out += ch;
    }
    return out;
  }

  /** Build a minimal-background ("pill") variant of `text`. Line breaks are
   *  swapped first (same length), then the body is capped so the suffix
   *  always lands inside the 144-unit limit — VRChat truncating it away was
   *  one silent way the trick could fail.
   *    legacy  \n kept,      + \u0003\u001f  (pre-Unity-6 trick)
   *    vrcosc  \n → \v,      + \u0003\u001f  (exact VRCOSC pipeline)
   *    etx     \n → \v,      + \u0003        (end-of-text only)
   *    us      \n → \v,      + \u001f        (unit separator only)
   *    lsep    \n → U+2028,  + \u0003\u001f  (TMP's line-separator path) */
  static applyPill(text: string, method: PillMethod): string {
    const brk = method === 'legacy' ? '\n' : method === 'lsep' ? ' ' : '\v';
    const body = brk === '\n' ? text : text.replace(/\n/g, brk);
    const suffix = method === 'etx' ? '\u0003' : method === 'us' ? '\u001F' : '\u0003\u001F';
    return OscManager.clampTo(body, OscManager.MAX_LEN - suffix.length) + suffix;
  }

  private ensureClient(): Client {
    if (!this.client) this.client = new Client(this.ip, this.port);
    return this.client;
  }

  sendChatbox(text: string, sendImmediately: boolean, playSound: boolean): Promise<void> {
    // Hard pause gate. Resolves immediately so callers don't deadlock
    // waiting on a promise — but no OSC packet leaves this process. The
    // user toggles this via the "Stop Everything" UI / tray menu.
    // Empty payloads are still allowed through so `clear()` (sent at the
    // moment of pausing) wipes the chatbox visually.
    if (this.paused && text !== '') {
      return Promise.resolve();
    }
    // External-chatbox mode: another tool owns /chatbox/input. Suppress
    // ALL chatbox sends, including empty (clear) — clearing would race
    // the other tool's writes. Avatar params are not affected; they go
    // through sendParameter, which doesn't pass this gate.
    if (this.externalChatbox) {
      return Promise.resolve();
    }
    // Apply markdown-ish Unicode text effects first (so *bold* etc. become
    // non-ASCII glyphs that the font transform then leaves alone), then the
    // font style. Both are no-ops when their setting is off.
    const effected = this.chatboxMarkdown ? applyTextEffects(text) : text;
    const styled = transformFont(effected, this.chatboxFont);
    // Pill variant when enabled. Skipped for an empty clear() so a suffix is
    // never sent on its own.
    const msg =
      this.chatboxPill && styled !== ''
        ? OscManager.applyPill(styled, this.pillMethod)
        : OscManager.clamp(styled);
    return this.writeChatbox(msg, sendImmediately, playSound);
  }

  /** Pill Lab: send one test message with a specific variant, ignoring the
   *  current pill setting. 'richtext' sends literal TMP tags un-styled, to
   *  probe whether the Unity 6 client now parses rich text in the chatbox
   *  (if it does, <size>/<line-height> become a real way to shrink it). */
  sendPillTest(text: string, method: PillMethod | 'richtext'): Promise<void> {
    if (this.paused || this.externalChatbox) return Promise.resolve();
    if (method === 'richtext') return this.writeChatbox(OscManager.clamp(text), true, false);
    const styled = transformFont(text, this.chatboxFont);
    return this.writeChatbox(OscManager.applyPill(styled, method), true, false);
  }

  private writeChatbox(msg: string, sendImmediately: boolean, playSound: boolean): Promise<void> {
    this.sent++;
    this.totalSent++;
    // /chatbox/input is "s b b": string body + ~16 bytes for address + tags.
    this.bytesOut +=
      Buffer.byteLength(msg, 'utf8') + Buffer.byteLength('/chatbox/input', 'utf8') + 4;
    return new Promise((resolve, reject) => {
      this.ensureClient().send(
        '/chatbox/input',
        msg,
        sendImmediately,
        playSound,
        (err: Error | null) => (err ? reject(err) : resolve()),
      );
    });
  }

  setTyping(isTyping: boolean): Promise<void> {
    this.sent++;
    this.totalSent++;
    this.bytesOut += Buffer.byteLength('/chatbox/typing', 'utf8') + 4;
    return new Promise((resolve, reject) => {
      this.ensureClient().send('/chatbox/typing', isTyping, (err: Error | null) =>
        err ? reject(err) : resolve(),
      );
    });
  }

  clear(): Promise<void> {
    return this.sendChatbox('', true, false);
  }

  /**
   * Send an arbitrary avatar parameter (spec §6 setParameter action).
   * VRChat address convention: /avatar/parameters/<Name>
   */
  sendParameter(
    address: string,
    value: number | boolean,
    valueType: 'int' | 'float' | 'bool',
  ): Promise<void> {
    let arg: number | boolean = value;
    if (valueType === 'int') arg = Math.round(Number(value));
    else if (valueType === 'float') arg = Number(value);
    else arg = Boolean(value);

    this.sent++;
    this.totalSent++;
    this.bytesOut += Buffer.byteLength(address, 'utf8') + 8;
    return new Promise((resolve, reject) => {
      this.ensureClient().send(address, arg, (err: Error | null) =>
        err ? reject(err) : resolve(),
      );
    });
  }

  /** Sample and reset per-second telemetry counters. Call ~1/sec. */
  sampleTelemetry(): OscTelemetry {
    const snapshot: OscTelemetry = {
      sendRate: this.sent,
      recvRate: this.recv,
      bytesOut: this.bytesOut,
      bytesIn: this.bytesIn,
      totalSent: this.totalSent,
      totalRecv: this.totalRecv,
      history: [...this.history],
    };
    this.history.push(this.sent);
    if (this.history.length > 30) this.history.shift();
    this.sent = 0;
    this.recv = 0;
    this.bytesOut = 0;
    this.bytesIn = 0;
    return snapshot;
  }

  private closeClient(): void {
    if (this.client) {
      try {
        this.client.close();
      } catch {
        /* ignore */
      }
      this.client = null;
    }
  }

  private closeServer(): void {
    if (this.server) {
      try {
        this.server.close();
      } catch {
        /* ignore */
      }
      this.server = null;
    }
  }

  close(): void {
    this.closeClient();
    this.closeServer();
  }
}
