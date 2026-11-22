// Anthropic Claude client for the chatbox app.
//
// Thin wrappers over `client.messages.create`:
//   - testConnection()  — verify the key + model (Settings → AI → Test)
//   - generateLine(ctx) — produce a short chatbox sentence (✨ on Control)
//
// Cost discipline:
//  - Each call caps `max_tokens` low (chatbox is 144 chars max anyway).
//  - The system prompt is the stable prefix with `cache_control: ephemeral`
//    so repeated calls hit the cache (~90% cheaper). Per-call user content
//    is the volatile suffix and never has a breakpoint.
//  - Default model is `claude-opus-4-7` (per Claude API skill defaults).
//    Users who want lower cost can pick `claude-haiku-4-5` in Settings.
//
// Auth: API key comes from settings.ai.apiKey (renderer → Settings UI).
//   Falls back to process.env.ANTHROPIC_API_KEY for dev. We never log the key.
//
// Errors: the SDK throws typed exceptions. We catch + return a `{ok:false, error}`
// shape so the renderer never sees raw SDK objects across IPC.

import Anthropic from '@anthropic-ai/sdk';
import log from 'electron-log';

export interface AiConfig {
  enabled: boolean;
  /** User's Anthropic API key (kept in settings.json — local only). */
  apiKey: string;
  /** Model id. Default 'claude-opus-4-7' (best); 'claude-haiku-4-5' for cost. */
  model: string;
  /** Persona / voice description fed to the model as part of the system
   *  prompt. Lets the user tune tone ("casual, kawaii, lots of emoji"). */
  persona: string;
}

/** Result envelope so the renderer doesn't have to know about SDK error types. */
export type AiResult<T> = { ok: true; data: T } | { ok: false; error: string };

export class AiClient {
  private client: Anthropic | null = null;
  private lastApiKey = '';

  constructor(private getConfig: () => AiConfig) {}

  /** Lazily build/refresh the Anthropic client when the API key changes. */
  private ensure(): { client: Anthropic; cfg: AiConfig } | null {
    const cfg = this.getConfig();
    if (!cfg.enabled) return null;
    const key = cfg.apiKey || process.env.ANTHROPIC_API_KEY || '';
    if (!key) return null;
    if (!this.client || this.lastApiKey !== key) {
      this.client = new Anthropic({ apiKey: key });
      this.lastApiKey = key;
    }
    return { client: this.client, cfg };
  }

  /** Cheap connection probe — fires a 5-token "say ok" call to verify the
   *  key is valid + the model is reachable. Surfaces typed errors so the
   *  Settings UI can render a clear hint (bad key vs no internet etc.). */
  async testConnection(): Promise<
    AiResult<{ model: string; usage: { input: number; output: number } }>
  > {
    const ctx = this.ensure();
    if (!ctx) return { ok: false, error: 'AI is disabled or no API key set.' };
    try {
      const r = await ctx.client.messages.create({
        model: ctx.cfg.model,
        max_tokens: 16,
        messages: [{ role: 'user', content: 'Reply with just the word OK.' }],
      });
      return {
        ok: true,
        data: {
          model: r.model,
          usage: { input: r.usage.input_tokens, output: r.usage.output_tokens },
        },
      };
    } catch (e) {
      return { ok: false, error: this.errorString(e) };
    }
  }

  // ---- Feature 1: generate a chatbox line --------------------------------

  /** Produce a single chatbox line given current context. The model should
   *  produce something the user could plausibly want to send right now —
   *  e.g. while listening to music + in VR, output something casual that
   *  references that context. Returns the raw line (no quotes). */
  async generateLine(ctx: {
    status?: string;
    music?: { title: string; artist: string } | null;
    world?: string;
    persona: string;
  }): Promise<AiResult<string>> {
    return this.shortGeneration({
      systemSuffix:
        '\n\nYour job: produce ONE short chatbox line (max 80 chars). No quotes, no preamble, no markdown.',
      user: this.contextBlock(ctx),
      maxTokens: 100,
    });
  }

  // ---- Shared helpers ----------------------------------------------------

  /** Common code path for short free-form generations. Caches the system
   *  prompt so repeated calls are ~90% cheaper after the first one. */
  private async shortGeneration(opts: {
    systemSuffix: string;
    user: string;
    maxTokens: number;
  }): Promise<AiResult<string>> {
    const ctx = this.ensure();
    if (!ctx) return { ok: false, error: 'AI disabled' };
    try {
      const r = await ctx.client.messages.create({
        model: ctx.cfg.model,
        max_tokens: opts.maxTokens,
        system: [
          {
            type: 'text',
            text: this.systemPrompt(ctx.cfg.persona) + opts.systemSuffix,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: opts.user }],
      });
      const text = this.extractText(r);
      return { ok: true, data: text.trim() };
    } catch (e) {
      return { ok: false, error: this.errorString(e) };
    }
  }

  /** The stable, cacheable system prompt prefix. Persona slot is volatile
   *  but stays small, so cache-write cost stays minimal. */
  private systemPrompt(persona: string): string {
    return [
      'You are the AI assistant inside "Uv\'s Chat Box", a VRChat chatbox controller.',
      'Constraints:',
      "- Output goes directly to VRChat's chatbox (144 char hard limit per line).",
      '- Be concise. One short sentence. No filler. No quotes around the output.',
      "- Match the user's persona exactly:",
      `  ${persona}`,
    ].join('\n');
  }

  /** Pull the first text block out of a Messages response. Handles the
   *  discriminated-union ContentBlock[] shape required by the SDK types. */
  private extractText(msg: Anthropic.Message): string {
    for (const block of msg.content) {
      if (block.type === 'text') return block.text;
    }
    return '';
  }

  /** Convert an SDK exception (or any unknown thrown value) into a one-line
   *  human-readable string. Avoids leaking the raw API key into logs. */
  private errorString(e: unknown): string {
    if (e instanceof Anthropic.AuthenticationError) return 'Invalid API key — check Settings → AI.';
    if (e instanceof Anthropic.RateLimitError) return 'Rate limited — try again in a few seconds.';
    if (e instanceof Anthropic.PermissionDeniedError)
      return 'API key lacks permission for this model.';
    if (e instanceof Anthropic.NotFoundError)
      return 'Model not found — pick a different model in Settings.';
    if (e instanceof Anthropic.APIError) return `API error ${e.status}: ${e.message}`;
    if (e instanceof Error) {
      // No-internet looks like a generic Error from fetch.
      const m = e.message;
      log.warn('[ai] non-API error:', m);
      return m.length > 200 ? m.slice(0, 200) + '…' : m;
    }
    return 'Unknown error.';
  }

  /** Build a compact context string for line generation. Keeps total tokens
   *  low — every byte of variable content is uncached. */
  private contextBlock(ctx: {
    status?: string;
    music?: { title: string; artist: string } | null;
    world?: string;
  }): string {
    const parts: string[] = [];
    if (ctx.status) parts.push(`status=${ctx.status}`);
    if (ctx.music) parts.push(`music="${ctx.music.title}" by ${ctx.music.artist}`);
    if (ctx.world) parts.push(`world=${ctx.world}`);
    if (parts.length === 0) parts.push('no special context');
    return `Context: ${parts.join('; ')}.\n\nGenerate one chatbox line.`;
  }
}
