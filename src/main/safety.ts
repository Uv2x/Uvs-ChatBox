import type { SafetyConfig } from '../shared/core';

/**
 * Anti-spam guard (spec §13). Sits in front of every OSC send:
 *  - global rate limiter (token-ish: max N sends per rolling second)
 *  - per-action cooldowns (keyed by an action signature)
 *  - duplicate-send debounce (drops identical text within a window)
 *
 * All checks are best-effort and fail-open if disabled.
 */
export class SafetyGuard {
  private cfg: SafetyConfig;
  private sendTimes: number[] = []; // epoch ms of recent sends
  private cooldowns = new Map<string, number>(); // key -> next-allowed epoch ms
  private lastText = '';
  private lastTextAt = 0;

  constructor(cfg: SafetyConfig) {
    this.cfg = cfg;
  }

  update(cfg: SafetyConfig): void {
    this.cfg = cfg;
  }

  /**
   * Returns { allowed, reason }. `key` identifies the action for cooldown
   * tracking; `dedupeText` (if provided) enables duplicate suppression.
   */
  check(
    key: string,
    dedupeText?: string,
    cooldownMs?: number,
    bypassDedupe?: boolean,
  ): { allowed: boolean; reason?: string } {
    if (!this.cfg.enabled) return { allowed: true };
    const now = Date.now();

    // Global rate limit (rolling 1s window).
    this.sendTimes = this.sendTimes.filter((t) => now - t < 1000);
    if (this.sendTimes.length >= this.cfg.globalRatePerSec) {
      return { allowed: false, reason: 'rate-limited' };
    }

    // Per-action cooldown.
    const cd = cooldownMs ?? this.cfg.defaultCooldownMs;
    if (cd > 0) {
      const nextAllowed = this.cooldowns.get(key) ?? 0;
      if (now < nextAllowed) {
        return { allowed: false, reason: 'cooldown' };
      }
    }

    // Duplicate debounce. StatusRelay keep-alive sends pass bypassDedupe to
    // re-send identical text on purpose (VRChat chatbox would otherwise time
    // out). Rate-limit + cooldown still apply.
    if (!bypassDedupe && dedupeText !== undefined && this.cfg.dedupeWindowMs > 0) {
      if (dedupeText === this.lastText && now - this.lastTextAt < this.cfg.dedupeWindowMs) {
        return { allowed: false, reason: 'duplicate' };
      }
    }

    return { allowed: true };
  }

  /** Record that a send actually went through (updates limiter state). */
  commit(key: string, dedupeText?: string, cooldownMs?: number): void {
    const now = Date.now();
    this.sendTimes.push(now);
    const cd = cooldownMs ?? this.cfg.defaultCooldownMs;
    if (cd > 0) this.cooldowns.set(key, now + cd);
    if (dedupeText !== undefined) {
      this.lastText = dedupeText;
      this.lastTextAt = now;
    }
  }
}
