// Voice command matcher (ported from VRCOSC's Voice Commands module).
//
// Listens for STT phrases coming out of the existing speech-to-text pipeline
// (src/main/stt.ts → IPC.STT_EVENT). When a phrase begins with the configured
// wake word, the remainder is matched (case-insensitive substring) against the
// user's command table. The first matching command's action list is handed off
// to the standard action dispatcher.
//
// Why a separate module: keeps STT cleanup (AI) and command interpretation
// decoupled, so a user without an AI key can still get voice control by
// adding plain-text matches. Falls back gracefully when STT isn't running.

import log from 'electron-log';

export interface VoiceCommandEntry {
  id: string;
  match: string;
  /** Opaque action list — dispatched by the existing action runner in main. */
  actions: unknown[];
}

export interface VoiceCommandConfig {
  enabled: boolean;
  wakeWord: string;
  commands: VoiceCommandEntry[];
}

export type VoiceCommandRunner = (actions: unknown[], source: string) => void | Promise<void>;

export class VoiceCommandMatcher {
  constructor(
    private readonly getConfig: () => VoiceCommandConfig | undefined,
    private readonly run: VoiceCommandRunner,
  ) {}

  /** Feed a single STT phrase. Returns the matched entry id, or null. */
  feed(rawPhrase: string): string | null {
    const cfg = this.getConfig();
    if (!cfg?.enabled) return null;
    const phrase = (rawPhrase || '').trim();
    if (!phrase) return null;

    const lower = phrase.toLowerCase();
    const wake = (cfg.wakeWord || '').trim().toLowerCase();
    let payload = lower;

    // If a wake word is configured we require it as a prefix; if not, every
    // phrase is open to matching (VRCOSC's default behaviour when blank).
    if (wake) {
      if (!lower.startsWith(wake)) return null;
      payload = lower
        .slice(wake.length)
        .replace(/^[\s,.!?]+/, '')
        .trim();
      if (!payload) return null;
    }

    for (const cmd of cfg.commands ?? []) {
      const needle = (cmd.match || '').toLowerCase().trim();
      if (!needle) continue;
      if (payload.includes(needle)) {
        log.info(`[voice] match: "${needle}" -> ${cmd.id}`);
        try {
          void this.run(cmd.actions, `voice:${cmd.id}`);
        } catch (e) {
          log.warn('[voice] action run failed:', (e as Error).message);
        }
        return cmd.id;
      }
    }
    return null;
  }
}
