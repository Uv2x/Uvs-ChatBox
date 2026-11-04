// Downloads pre-trained Whisper GGML models from HuggingFace's ggerganov/whisper.cpp
// repo to userData/whisper/models. Streams to disk with progress events.
//
// All URLs are HTTPS to ggerganov's well-known release page — the same place
// every whisper.cpp wrapper points at. We pin only the filename, so future
// model retrains served at the same URL are picked up without app updates.

import { app } from 'electron';
import { promises as fsp, createWriteStream } from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import log from 'electron-log';

const BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

/** Approx download sizes — used for the progress bar when the server omits Content-Length. */
const SIZE_HINTS: Record<string, number> = {
  tiny: 77_700_000,
  'tiny.en': 77_700_000,
  base: 147_900_000,
  'base.en': 147_900_000,
  small: 487_600_000,
  'small.en': 487_600_000,
};

export type DownloaderEvent =
  | { event: 'start'; model: string; total: number }
  | { event: 'progress'; model: string; got: number; total: number }
  | { event: 'done'; model: string; path: string }
  | { event: 'error'; model: string; message: string };

export class WhisperDownloader extends EventEmitter {
  /** Begin downloading the named model. Resolves to the final file path. */
  async download(
    modelChoice: 'tiny' | 'tiny.en' | 'base' | 'base.en' | 'small' | 'small.en',
  ): Promise<string> {
    const fname = `ggml-${modelChoice}.bin`;
    const dir = path.join(app.getPath('userData'), 'whisper', 'models');
    await fsp.mkdir(dir, { recursive: true });
    const out = path.join(dir, fname);
    const tmp = out + '.part';
    const url = `${BASE_URL}/${fname}`;

    log.info(`[whisper-dl] fetching ${fname} -> ${out}`);
    let resp: Response;
    try {
      resp = await fetch(url);
    } catch (e) {
      const m = (e as Error).message;
      this.emit('event', { event: 'error', model: modelChoice, message: m } as DownloaderEvent);
      throw e;
    }
    if (!resp.ok || !resp.body) {
      const m = `HTTP ${resp.status}`;
      this.emit('event', { event: 'error', model: modelChoice, message: m });
      throw new Error(m);
    }
    const lengthHeader = resp.headers.get('content-length');
    const total = lengthHeader ? Number(lengthHeader) : (SIZE_HINTS[modelChoice] ?? 0);
    this.emit('event', { event: 'start', model: modelChoice, total } as DownloaderEvent);

    let got = 0;
    let lastEmit = 0;
    const ws = createWriteStream(tmp);
    const reader = resp.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        ws.write(Buffer.from(value));
        got += value.byteLength;
        if (Date.now() - lastEmit > 250) {
          lastEmit = Date.now();
          this.emit('event', {
            event: 'progress',
            model: modelChoice,
            got,
            total,
          } as DownloaderEvent);
        }
      }
    } finally {
      ws.end();
      await new Promise<void>((res) => ws.on('close', () => res()));
    }
    await fsp.rename(tmp, out);
    this.emit('event', { event: 'done', model: modelChoice, path: out } as DownloaderEvent);
    return out;
  }
}
