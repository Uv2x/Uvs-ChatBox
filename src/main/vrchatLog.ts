// VRChat output-log tailer. Reads the rolling text log VRChat writes to
//   %LOCALAPPDATA%Low\VRChat\VRChat\output_log_*.txt
// and extracts useful events without ever talking to the VRChat API
// (which has API-key rotation + ban risk).
//
// We watch the newest file in that directory, read appended bytes once per
// second, and parse known line shapes. State is in-memory only and the
// tailer is restart-safe: if VRChat creates a new log file, we re-anchor
// to the new newest one on the next tick.
//
// Exposes a small reactive snapshot via getSnapshot() — consumed by the
// live loop + Settings UI tokens.

import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';
import log from 'electron-log';

export interface VrchatLogSnapshot {
  /** Currently in a VRChat world (we saw a Joining wrld_ recently). */
  inWorld: boolean;
  /** Human-readable world name from "Entering Room: <name>". */
  world: string;
  /** Instance type — public / friends / friends+ / invite / invite+ /
   *  group / group+ / group public / unknown. Parsed from the
   *  "wrld_xxx:NNN~tag" tail. */
  instanceType: string;
  /** Tracked headcount in the current room. */
  playerCount: number;
  /** Most recent player to join (display name). */
  lastJoin: string;
  /** Most recent player to leave (display name). */
  lastLeave: string;
  /** Avatar name from "Switching ... to avtr_..." (best-effort, may be
   *  empty if the line shape changed). */
  avatar: string;
  /** Local time (epoch ms) of the most recent log update we processed. */
  lastUpdate: number;
}

const EMPTY: VrchatLogSnapshot = {
  inWorld: false,
  world: '',
  instanceType: '',
  playerCount: 0,
  lastJoin: '',
  lastLeave: '',
  avatar: '',
  lastUpdate: 0,
};

/** Default log directory on Windows. (LOCALAPPDATA "Low" — note: this is
 *  a separate folder from %LOCALAPPDATA%; Unity apps that opt into low
 *  integrity get this directory.) */
function defaultLogDir(): string {
  return path.join(os.homedir(), 'AppData', 'LocalLow', 'VRChat', 'VRChat');
}

export class VrchatLog extends EventEmitter {
  private snap: VrchatLogSnapshot = { ...EMPTY };
  private timer: NodeJS.Timeout | null = null;
  private currentFile: string | null = null;
  private offset = 0;
  private readonly dir: string;
  /** Carry-over for split lines across reads. */
  private tail = '';
  /** Whether we've ever seen a join/leave so the count is non-imaginary. */
  private playersSeen = new Set<string>();

  constructor(dir = defaultLogDir()) {
    super();
    this.dir = dir;
  }

  start(): void {
    if (this.timer) return;
    log.info('[vrchatLog] starting; dir =', this.dir);
    this.timer = setInterval(() => {
      void this.tick();
    }, 1000);
    void this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.currentFile = null;
    this.offset = 0;
    this.tail = '';
    this.snap = { ...EMPTY };
    this.playersSeen.clear();
  }

  getSnapshot(): VrchatLogSnapshot {
    return { ...this.snap };
  }

  private async tick(): Promise<void> {
    try {
      const newest = await this.findNewestLog();
      if (!newest) return;
      if (newest !== this.currentFile) {
        // New log file (VRChat just launched). Reset reader state but keep
        // the existing snapshot so we don't briefly clear tokens.
        log.info('[vrchatLog] switching to', newest);
        this.currentFile = newest;
        this.offset = 0;
        this.tail = '';
        this.playersSeen.clear();
      }
      const stat = await fs.stat(newest);
      if (stat.size < this.offset) {
        // File truncated (rare — VRChat doesn't usually do this) — reset.
        this.offset = 0;
      }
      if (stat.size === this.offset) return; // nothing new
      const fh = await fs.open(newest, 'r');
      try {
        const buf = Buffer.alloc(stat.size - this.offset);
        await fh.read(buf, 0, buf.length, this.offset);
        this.offset = stat.size;
        const chunk = this.tail + buf.toString('utf-8');
        const lines = chunk.split(/\r?\n/);
        // Last element might be a partial line — stash for next read.
        this.tail = lines.pop() ?? '';
        for (const line of lines) this.processLine(line);
        this.snap.lastUpdate = Date.now();
        this.emit('update', this.getSnapshot());
      } finally {
        await fh.close();
      }
    } catch {
      // Silently swallow — log dir may not exist (VRChat never run on this
      // PC, or non-Windows host). Logging on every tick would spam.
    }
  }

  /** Find the most-recently-modified output_log_*.txt in the log dir. */
  private async findNewestLog(): Promise<string | null> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.dir);
    } catch {
      return null;
    }
    let best: { file: string; mtime: number } | null = null;
    for (const name of entries) {
      if (!name.startsWith('output_log_') || !name.endsWith('.txt')) continue;
      const full = path.join(this.dir, name);
      try {
        const st = await fs.stat(full);
        if (!best || st.mtimeMs > best.mtime) {
          best = { file: full, mtime: st.mtimeMs };
        }
      } catch {
        /* skip */
      }
    }
    return best?.file ?? null;
  }

  /** Parse a single log line for known events. Line shape (typical):
   *    2024.07.04 17:23:01 Log        -  [Behaviour] OnPlayerJoined Alice
   *  We match on the message body after the dash, ignoring timestamps. */
  private processLine(raw: string): void {
    // Fast-skip empty lines.
    if (!raw || raw.length < 10) return;

    // World entry — emitted as either "Joining wrld_xxx:1234~..." or
    // "Entering Room: <world name>". We pair them: the wrld_ line gives us
    // the instance tag (public/friends/etc.), the room line gives us the
    // human-readable world name.
    const joining = raw.match(/Joining (wrld_[a-z0-9-]+):([0-9]+)~?(\S*)/i);
    if (joining) {
      const tag = joining[3] ?? '';
      this.snap.inWorld = true;
      this.snap.instanceType = this.deriveInstanceType(tag);
      // New instance = new headcount.
      this.playersSeen.clear();
      this.snap.playerCount = 0;
      this.snap.lastJoin = '';
      this.snap.lastLeave = '';
      return;
    }
    const room = raw.match(/Entering Room: (.+)$/);
    if (room) {
      this.snap.world = (room[1] ?? '').trim();
      return;
    }

    const join = raw.match(/OnPlayerJoined\s+(.+?)(?:\s\(usr_|$)/);
    if (join) {
      const name = (join[1] ?? '').trim();
      if (name) {
        if (!this.playersSeen.has(name)) {
          this.playersSeen.add(name);
          this.snap.playerCount = this.playersSeen.size;
        }
        this.snap.lastJoin = name;
      }
      return;
    }

    const leave = raw.match(/OnPlayerLeft\s+(.+?)(?:\s\(usr_|$)/);
    if (leave) {
      const name = (leave[1] ?? '').trim();
      if (name) {
        if (this.playersSeen.delete(name)) {
          this.snap.playerCount = this.playersSeen.size;
        }
        this.snap.lastLeave = name;
      }
      return;
    }

    // Leaving the world / quitting VRChat.
    if (raw.includes('OnLeftRoom') || raw.includes('OnDestroy')) {
      this.snap.inWorld = false;
      this.snap.playerCount = 0;
      this.playersSeen.clear();
      return;
    }

    // Avatar switch: "Switching <something> to avtr_<id>" or
    // "Initialized player <displayName> ..." — name often appears only in
    // the metadata fetch line. We try a couple of forms.
    const avtr = raw.match(/Switching .* to (.+?)(?:\s\(avtr_|$)/);
    if (avtr) {
      const name = (avtr[1] ?? '').trim();
      if (name && !name.startsWith('avtr_')) this.snap.avatar = name;
      return;
    }
  }

  /** "~friends(usr_x)" -> "friends"; "~hidden" -> "friends+"; etc. */
  private deriveInstanceType(tag: string): string {
    if (!tag) return 'public';
    const lc = tag.toLowerCase();
    if (lc.startsWith('hidden')) return 'friends+';
    if (lc.startsWith('friends')) return 'friends';
    if (lc.startsWith('private') && lc.includes('canrequestinvite')) return 'invite+';
    if (lc.startsWith('private')) return 'invite';
    if (lc.startsWith('group(') && lc.includes('grouppublic')) return 'group public';
    if (lc.startsWith('group(') && lc.includes('grouponly')) return 'group';
    if (lc.startsWith('group(')) return 'group+';
    return 'public';
  }
}
