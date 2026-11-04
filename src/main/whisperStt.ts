// Whisper-based speech-to-text engine (ported from VRCOSC's Whisper module).
//
// Architectural shape mirrors the existing UWP `SpeechRecognizer` in stt.ts so
// main.ts can pick one at runtime via settings.sttEngine. The Whisper engine
// is a "push" engine: the *renderer* captures audio (16 kHz mono PCM Int16)
// via Web Audio and posts chunks here via IPC. We batch ~3 s windows, write a
// minimal WAV, spawn whisper.cpp's CLI on it, parse stdout, emit phrases.
//
// Why renderer-side capture: Electron's main process has no direct mic API.
// The renderer's AudioContext does the resampling for free if we ask for
// sampleRate 16000.
//
// Why whisper.cpp via CLI: bundling a Node binding would need native
// compilation per platform. The CLI is cross-platform, self-contained, and
// the user (or installer) drops one binary into userData/whisper/bin.
//
// Auto-detect order for the binary: settings.whisper.binPath > userData
// path > PATH. Same for the model: settings.whisper.modelPath > userData
// path. Both surface a clear "not found" error event so the UI can prompt
// the user to download.

import { app } from 'electron';
import { spawn } from 'child_process';
import { promises as fsp, existsSync } from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import log from 'electron-log';

export interface WhisperConfig {
  /** Optional override; empty = auto-detect. */
  binPath: string;
  /** Optional override; empty = use modelChoice + default models dir. */
  modelPath: string;
  /** Pick a known GGML model. 'custom' means use modelPath verbatim. */
  modelChoice: 'tiny' | 'tiny.en' | 'base' | 'base.en' | 'small' | 'small.en' | 'custom';
  /** ISO 639-1 code or 'auto'. */
  language: string;
}

export interface WhisperPhraseEvent {
  event: 'phrase';
  text: string;
  /** Always 0 for whisper (no confidence in CLI output). */
  status: 0;
  /** Always 0 (high) for whisper. */
  confidence: 0;
}
export type WhisperEvent =
  | { event: 'ready' }
  | WhisperPhraseEvent
  | { event: 'error'; message: string }
  | { event: 'fatal'; message: string }
  | { event: 'stopped' }
  | { event: 'progress'; bufferedSec: number };

/** Target audio properties — what whisper.cpp expects on its WAV input. */
const SR = 16000;
const CHANNELS = 1;
/** Window size: ~3 seconds is a sweet spot between latency and accuracy. */
const WINDOW_SAMPLES = SR * 3;

export class WhisperRecognizer extends EventEmitter {
  private cfg: WhisperConfig = {
    binPath: '',
    modelPath: '',
    modelChoice: 'tiny.en',
    language: 'auto',
  };
  private running = false;
  private buf: Int16Array[] = [];
  private bufLen = 0;
  private busy = false;

  configure(cfg: Partial<WhisperConfig>): void {
    this.cfg = { ...this.cfg, ...cfg };
  }

  start(cfg?: Partial<WhisperConfig>): void {
    if (cfg) this.configure(cfg);
    if (this.running) return;
    // Sanity check the bin + model are reachable; if not, surface an error
    // event but stay "running" so the renderer can fix the path and we
    // pick up on the next chunk.
    const bin = this.resolveBin();
    const model = this.resolveModel();
    if (!bin)
      this.emit('event', {
        event: 'error',
        message: 'whisper binary not found — see Settings → Whisper STT.',
      });
    else if (!model)
      this.emit('event', {
        event: 'error',
        message: 'whisper model not found — download or set a path in Settings → Whisper STT.',
      });
    else this.emit('event', { event: 'ready' });
    this.running = true;
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.buf = [];
    this.bufLen = 0;
    this.emit('stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  /** Receive a chunk of 16 kHz mono Int16 PCM from the renderer. */
  pushPcm(chunk: Int16Array): void {
    if (!this.running) return;
    this.buf.push(chunk);
    this.bufLen += chunk.length;
    this.emit('event', { event: 'progress', bufferedSec: this.bufLen / SR });
    if (this.bufLen >= WINDOW_SAMPLES && !this.busy) {
      void this.flushWindow();
    }
  }

  private async flushWindow(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const bin = this.resolveBin();
    const model = this.resolveModel();
    if (!bin || !model) {
      // Drop the data — keep buffer short so we don't OOM while user fixes paths.
      if (this.bufLen > WINDOW_SAMPLES * 4) {
        this.buf = [];
        this.bufLen = 0;
      }
      this.busy = false;
      return;
    }
    const samples = this.drainBuf();
    let tmpPath = '';
    try {
      tmpPath = await this.writeWav(samples);
      const text = await this.runWhisper(bin, model, tmpPath);
      const trimmed = text.trim();
      if (trimmed) {
        this.emit('event', {
          event: 'phrase',
          text: trimmed,
          status: 0,
          confidence: 0,
        } as WhisperPhraseEvent);
      }
    } catch (e) {
      log.warn('[whisper] flushWindow failed:', (e as Error).message);
      this.emit('event', { event: 'error', message: (e as Error).message });
    } finally {
      if (tmpPath) {
        try {
          await fsp.unlink(tmpPath);
        } catch {
          /* ignore */
        }
      }
      this.busy = false;
      // If we've buffered MORE while busy, kick another flush so latency stays bounded.
      if (this.running && this.bufLen >= WINDOW_SAMPLES) void this.flushWindow();
    }
  }

  private drainBuf(): Int16Array {
    const out = new Int16Array(this.bufLen);
    let off = 0;
    for (const c of this.buf) {
      out.set(c, off);
      off += c.length;
    }
    this.buf = [];
    this.bufLen = 0;
    return out;
  }

  /** Resolve whisper.cpp binary. Order: explicit > userData/whisper/bin > PATH. */
  private resolveBin(): string {
    const want = (this.cfg.binPath || '').trim();
    if (want && existsSync(want)) return want;
    const candidates = [
      path.join(app.getPath('userData'), 'whisper', 'bin', 'whisper-cli.exe'),
      path.join(app.getPath('userData'), 'whisper', 'bin', 'main.exe'),
      path.join(app.getPath('userData'), 'whisper', 'bin', 'whisper-cli'),
    ];
    for (const c of candidates) if (existsSync(c)) return c;
    return '';
  }

  /** Resolve a model file path from settings + modelChoice. */
  private resolveModel(): string {
    if (this.cfg.modelChoice === 'custom') {
      const want = (this.cfg.modelPath || '').trim();
      return want && existsSync(want) ? want : '';
    }
    const fname = `ggml-${this.cfg.modelChoice}.bin`;
    const full = path.join(app.getPath('userData'), 'whisper', 'models', fname);
    return existsSync(full) ? full : '';
  }

  /** Write a 16-bit PCM WAV to a temp file and return the path. */
  private async writeWav(samples: Int16Array): Promise<string> {
    const tmpDir = path.join(app.getPath('temp'), 'uvs-chatbox-whisper');
    await fsp.mkdir(tmpDir, { recursive: true });
    const filePath = path.join(
      tmpDir,
      `chunk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.wav`,
    );
    const dataBytes = samples.byteLength;
    const buf = Buffer.alloc(44 + dataBytes);
    // RIFF header
    buf.write('RIFF', 0, 'ascii');
    buf.writeUInt32LE(36 + dataBytes, 4);
    buf.write('WAVE', 8, 'ascii');
    // fmt chunk
    buf.write('fmt ', 12, 'ascii');
    buf.writeUInt32LE(16, 16); // chunk size
    buf.writeUInt16LE(1, 20); // PCM
    buf.writeUInt16LE(CHANNELS, 22);
    buf.writeUInt32LE(SR, 24);
    buf.writeUInt32LE(SR * CHANNELS * 2, 28); // byte rate
    buf.writeUInt16LE(CHANNELS * 2, 32); // block align
    buf.writeUInt16LE(16, 34); // bits per sample
    // data chunk
    buf.write('data', 36, 'ascii');
    buf.writeUInt32LE(dataBytes, 40);
    Buffer.from(samples.buffer, samples.byteOffset, dataBytes).copy(buf, 44);
    await fsp.writeFile(filePath, buf);
    return filePath;
  }

  /** Spawn whisper.cpp and parse its stdout. Compatible with both the
   *  modern `whisper-cli` and the legacy `main` build of whisper.cpp. */
  private runWhisper(bin: string, model: string, wavPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = [
        '-m',
        model,
        '-f',
        wavPath,
        '-otxt',
        '-of',
        wavPath, // write to wavPath + ".txt"
        '-l',
        this.cfg.language || 'auto',
        '-nt', // no timestamps
        '-np', // no progress
        '-bs',
        '5', // beam size 5 — quality
      ];
      const ps = spawn(bin, args, { windowsHide: true });
      let stderr = '';
      ps.stdout.on('data', () => {
        /* discard — we parse the .txt file */
      });
      ps.stderr.on('data', (d) => {
        stderr += d.toString();
      });
      ps.on('error', (e) => reject(e));
      ps.on('close', async (code) => {
        if (code !== 0) {
          return reject(new Error(`whisper exit ${code}: ${stderr.trim().slice(0, 300)}`));
        }
        const txtPath = wavPath + '.txt';
        try {
          const t = await fsp.readFile(txtPath, 'utf8');
          try {
            await fsp.unlink(txtPath);
          } catch {
            /* ignore */
          }
          resolve(t);
        } catch (e) {
          reject(e as Error);
        }
      });
    });
  }
}
