import { EventEmitter } from 'events';
import type { OscManager } from './osc';
import type { SafetyGuard } from './safety';
import type {
  Action,
  ActionResult,
  AppState,
  HistoryEntry,
  AppSettings,
  Timeline,
} from '../shared/types';
import type { PinnedItem } from '../shared/core';

/**
 * The central engine (spec §6). Everything that "does something" — quick
 * phrases, hotkeys, macros, timelines, the refresh loop, auto-responder —
 * produces Action objects and hands them here. This keeps every feature
 * modular and routed through one safety-checked, state-aware path.
 *
 * Pin-cycle integration: when pinSentMessages is on, sendText / setStatus
 * write the text to `state.pinnedItems` (a pure state change — no OSC send,
 * no SafetyGuard) and emit `request-tick`. Main owns the cycle loop: it
 * auto-starts on the first pin, rotates/keeps-alive the pins, and auto-stops
 * when the last pin is removed. The phrase enters the chatbox already wrapped
 * inside the full module cycle, never flashing alone.
 *
 * Emits:
 *   'state'   (AppState)        when persistent state changes
 *   'history' (HistoryEntry)    when an action is logged
 *   'profile' (profileId)       when a switchProfile action runs
 */
export class ActionEngine extends EventEmitter {
  private osc: OscManager;
  private safety: SafetyGuard;
  private getSettings: () => AppSettings;

  private state: AppState;
  private history: HistoryEntry[] = [];
  private activeTimeline: { id: string; timer: NodeJS.Timeout | null } | null = null;

  constructor(
    osc: OscManager,
    safety: SafetyGuard,
    getSettings: () => AppSettings,
    initialState: AppState,
  ) {
    super();
    this.osc = osc;
    this.safety = safety;
    this.getSettings = getSettings;
    this.state = initialState;
  }

  getState(): AppState {
    return { ...this.state, variables: { ...this.state.variables } };
  }

  // ---- Pinned-cycle management ----------------------------------------
  // Multi-pin model: every status / phrase / manual send tracked by its
  // own key in `state.pinnedItems`. The live loop renders each entry on
  // its own row, so the user can have several statuses or phrases active
  // at once. Click to add; click again on the same key to remove.

  /** Replace-or-add a pin by key. Returns the new pinnedItems list. */
  private upsertPin(key: string, text: string): PinnedItem[] {
    const cur = this.state.pinnedItems ?? [];
    const without = cur.filter((p) => p.key !== key);
    return [...without, { key, text }];
  }

  /** Remove a pin by key (no-op if not present). */
  removePin(key: string): void {
    const cur = this.state.pinnedItems ?? [];
    const next = cur.filter((p) => p.key !== key);
    if (next.length !== cur.length) {
      this.setState({ pinnedItems: next });
      // Ask the live loop to push the updated cycle out now, so unpinning
      // takes effect immediately instead of waiting up to updateIntervalSec.
      this.emit('request-tick');
    }
  }

  /** Toggle a pin: if a pin with this key exists, remove it; otherwise
   *  add it with the given text. Returns true if the key is now pinned. */
  togglePin(key: string, text: string): boolean {
    const cur = this.state.pinnedItems ?? [];
    const exists = cur.some((p) => p.key === key);
    if (exists) {
      this.setState({ pinnedItems: cur.filter((p) => p.key !== key) });
      this.emit('request-tick');
      return false;
    }
    this.setState({ pinnedItems: this.upsertPin(key, text) });
    this.emit('request-tick');
    return true;
  }

  clearAllPins(): void {
    if ((this.state.pinnedItems?.length ?? 0) === 0) return;
    this.setState({ pinnedItems: [] });
    this.emit('request-tick');
  }

  setState(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    this.emit('state', this.getState());
  }

  /** Hard-replace runtime state — used by the "Reset all settings" action so
   *  restored pins / current status / variables are wiped, not just settings
   *  on disk. Clears history and emits so the renderer + live loop update. */
  reset(state: AppState): void {
    this.state = { ...state, variables: { ...state.variables } };
    this.history = [];
    this.emit('state', this.getState());
  }

  getHistory(): HistoryEntry[] {
    return [...this.history];
  }

  /** Substitute {name} variables (spec §4) using current state + status. */
  substitute(text: string): string {
    const settings = this.getSettings();
    const vars: Record<string, string> = { ...this.state.variables };
    // Built-in convenience vars.
    const status = settings.statuses.find((s) => s.id === this.state.currentStatusId);
    vars.status = status ? status.label : '';
    vars.time = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hour12: !settings.clock24h,
    });
    return text.replace(/\{(\w+)\}/g, (_, k: string) =>
      Object.prototype.hasOwnProperty.call(vars, k) ? (vars[k] ?? '') : `{${k}}`,
    );
  }

  private log(entry: HistoryEntry): void {
    this.history.unshift(entry);
    if (this.history.length > 50) this.history.pop(); // spec §11: last 50
    this.emit('history', entry);
  }

  /** Execute a single action. */
  async run(action: Action): Promise<ActionResult> {
    try {
      const res = await this.dispatch(action);
      this.log({ at: Date.now(), describe: res.describe, ok: res.ok, text: (action as any).text });
      return res;
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      const result: ActionResult = { ok: false, error: err, describe: `Failed: ${err}` };
      this.log({ at: Date.now(), describe: result.describe, ok: false });
      return result;
    }
  }

  /** Execute a sequence (macro body), honoring delay steps. */
  async runSequence(actions: Action[]): Promise<ActionResult> {
    for (const a of actions) {
      if (a.kind === 'delay') {
        await new Promise((r) => setTimeout(r, Math.max(0, a.ms)));
        continue;
      }
      const res = await this.run(a);
      if (!res.ok && res.error !== 'rate-limited' && res.error !== 'cooldown') {
        // Continue the chain on soft throttle, abort on hard error.
      }
    }
    return { ok: true, describe: `Ran sequence of ${actions.length} steps` };
  }

  private async dispatch(action: Action): Promise<ActionResult> {
    const settings = this.getSettings();
    switch (action.kind) {
      case 'sendText': {
        const text = this.substitute(action.text);
        const pinning = settings.pinSentMessages !== false;
        const pinSlotKey = action.pinKey ?? 'manual';
        // Relay-OWNED chatbox short-circuits the pin route entirely.
        // When the relay is on, IT decides what shows up in the chatbox
        // by sending one short line per tick, so pins must not interfere.
        const relayOwnsChatbox = settings.relay?.enabled === true;
        // PIN PATH: when pinning is enabled, adding text to the cycle is a
        // pure STATE change. It must NOT pass through the SafetyGuard (its
        // 3/sec rate limit + dedupe would silently drop rapid pins — the
        // "can only pin 2" bug) and must NOT require the live loop to be
        // running. We write the pin slot, emit request-tick, and let main
        // auto-start the cycle loop, which owns the actual OSC send.
        // `noPin` senders (refresh-loop keep-alive) skip this — their text
        // is already pinned under its real key; re-pinning here would
        // duplicate it into the default 'manual' slot.
        if (pinning && !relayOwnsChatbox && !action.noPin) {
          this.setState({
            lastSentText: text,
            lastSentAt: Date.now(),
            pinnedItems: this.upsertPin(pinSlotKey, text),
          });
          this.emit('request-tick');
          return { ok: true, describe: `Pinned + cycled: ${text}` };
        }
        // One-shot path (pinning disabled or relay owns chatbox): this
        // really is a single send, so the safety gate applies.
        const key = `send:${text}`;
        const gate = this.safety.check(key, text, undefined, action.bypassDedupe);
        if (!gate.allowed)
          return { ok: false, error: gate.reason, describe: `Blocked (${gate.reason}): ${text}` };
        await this.osc.sendChatbox(text, settings.osc.sendImmediately, settings.osc.playSound);
        this.safety.commit(key, text);
        this.setState({ lastSentText: text, lastSentAt: Date.now() });
        return { ok: true, describe: `Sent: ${text}` };
      }
      case 'setStatus': {
        const status = settings.statuses.find((s) => s.id === action.statusId);
        this.setState({ currentStatusId: action.statusId });
        // Push the status to the chatbox so the click is visible in-game.
        // Prefer the curated `text` field, but FALL BACK to icon+label so
        // older settings.json entries (or freshly-added statuses without
        // a `text` configured yet) still produce a chatbox line.
        if (status) {
          const text =
            status.text && status.text.trim()
              ? status.text
              : `${status.icon ?? ''} ${status.label ?? ''}`.trim();
          if (text) {
            const pinKey = `status:${action.statusId}`;
            const pinning = settings.pinSentMessages !== false;
            const relayOwnsChatbox = settings.relay?.enabled === true;
            // PIN PATH: pinning a status is a pure STATE change, not a
            // one-shot send. It must NOT go through the SafetyGuard (which
            // rate-limits past ~3/sec and would silently drop the 3rd+ pin
            // — the "can only pin 2" bug) and must NOT require the live
            // loop to already be running. We just write the pin slot and
            // emit request-tick; main auto-starts the cycle loop if needed,
            // and that loop owns the actual OSC send + dedupe.
            if (pinning && !relayOwnsChatbox) {
              this.setState({
                lastSentText: text,
                lastSentAt: Date.now(),
                pinnedItems: this.upsertPin(pinKey, text),
              });
              this.emit('request-tick');
              return { ok: true, describe: `Pinned status: ${status.label}` };
            }
            // Fallback: pinning disabled or relay owns chatbox — one-shot
            // send via dispatch(sendText), which passes through the safety
            // gate (correct, since here it really is a one-shot send).
            await this.dispatch({ kind: 'sendText', text, pinKey });
          }
        }
        return { ok: true, describe: `Status → ${status ? status.label : action.statusId}` };
      }
      case 'setParameter': {
        const key = `param:${action.address}`;
        const gate = this.safety.check(key);
        if (!gate.allowed)
          return {
            ok: false,
            error: gate.reason,
            describe: `Blocked (${gate.reason}): ${action.address}`,
          };
        await this.osc.sendParameter(action.address, action.value, action.valueType);
        this.safety.commit(key);
        return { ok: true, describe: `Param ${action.address} = ${action.value}` };
      }
      case 'clearChatbox': {
        await this.osc.clear();
        this.setState({ lastSentText: '', lastSentAt: Date.now() });
        return { ok: true, describe: 'Cleared chatbox' };
      }
      case 'setVariable': {
        this.setState({ variables: { ...this.state.variables, [action.name]: action.value } });
        return { ok: true, describe: `Set {${action.name}} = ${action.value}` };
      }
      case 'switchProfile': {
        this.emit('profile', action.profileId);
        return { ok: true, describe: `Switched profile → ${action.profileId}` };
      }
      case 'runMacro': {
        const macro = settings.macros.find((m) => m.id === action.macroId);
        if (!macro) return { ok: false, error: 'not-found', describe: 'Macro not found' };
        await this.runSequence(macro.steps);
        return { ok: true, describe: `Ran macro: ${macro.name}` };
      }
      case 'runTimeline': {
        const tl = settings.timelines.find((t) => t.id === action.timelineId);
        if (!tl) return { ok: false, error: 'not-found', describe: 'Timeline not found' };
        this.startTimeline(tl);
        return { ok: true, describe: `Started timeline: ${tl.name}` };
      }
      case 'delay': {
        await new Promise((r) => setTimeout(r, Math.max(0, action.ms)));
        return { ok: true, describe: `Delay ${action.ms}ms` };
      }
      default:
        return { ok: false, error: 'unknown', describe: 'Unknown action' };
    }
  }

  /** Timeline = simulated text animation via timed frame swaps (spec §8). */
  startTimeline(tl: Timeline): void {
    this.stopTimeline();
    let i = 0;
    const settings = this.getSettings();
    const advance = async () => {
      if (i >= tl.frames.length) {
        if (tl.loop) {
          i = 0;
        } else {
          this.stopTimeline();
          return;
        }
      }
      const frame = tl.frames[i];
      i++;
      if (!frame) {
        this.stopTimeline();
        return;
      }
      // Unicode-safe: substitution + clamp handled by sendChatbox.
      const text = this.substitute(frame.text);
      const key = `tl:${tl.id}`;
      const gate = this.safety.check(key, undefined, 0); // timelines bypass dedupe
      if (gate.allowed) {
        try {
          await this.osc.sendChatbox(text, settings.osc.sendImmediately, false);
          this.safety.commit(key);
        } catch {
          /* ignore transient */
        }
      }
      this.activeTimeline = {
        id: tl.id,
        timer: setTimeout(advance, Math.max(200, frame.holdMs)),
      };
    };
    void advance();
  }

  stopTimeline(): void {
    if (this.activeTimeline?.timer) clearTimeout(this.activeTimeline.timer);
    this.activeTimeline = null;
  }

  /** Undo last (spec §11): best-effort — re-send previous text or clear. */
  async undoLast(): Promise<ActionResult> {
    // Find the previous successful send before the most recent one.
    const sends = this.history.filter((h) => h.ok && h.text !== undefined);
    const prev = sends[1]; // [0] is current, [1] is the one before
    if (prev && prev.text) {
      return this.run({ kind: 'sendText', text: prev.text });
    }
    return this.run({ kind: 'clearChatbox' });
  }
}
