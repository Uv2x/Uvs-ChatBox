// Status tab — everything about what the chatbox is currently showing:
// the status switcher (multi-pin with cap), the live pin cycle (statuses +
// manual messages), rotation/shuffle controls, keep-alive, and time-of-day
// scheduled statuses. Split out of the old Control panel so "what am I
// broadcasting" lives on its own page.

import { useEffect, useState } from 'react';
import type { AppSettings, AppState } from '../shared/types';
import { ScheduledStatusPanel } from './vrcoscPanels2';

export function StatusTab(props: {
  settings: AppSettings;
  onPersist: (s: AppSettings) => void;
  flash: (m: string) => void;
}) {
  const { settings, onPersist, flash } = props;
  const [state, setState] = useState<AppState | null>(null);

  useEffect(() => {
    window.chatbox.getState().then(setState);
    const off = window.chatbox.onStateUpdate(setState);
    return () => {
      off();
    };
  }, []);

  const pinnedKeys = new Set((state?.pinnedItems ?? []).map((p) => p.key));
  const pinnedStatusCount = (state?.pinnedItems ?? []).filter((p) =>
    p.key.startsWith('status:'),
  ).length;
  const statusMax = settings.pinStatusMax ?? 10;

  const toggleStatus = async (id: string) => {
    const key = `status:${id}`;
    if (pinnedKeys.has(key)) {
      await window.chatbox.removePin(key);
      flash('Status removed from cycle');
      return;
    }
    if (pinnedStatusCount >= statusMax) {
      flash(`Max ${statusMax} pinned statuses — unpin one first`);
      return;
    }
    const r = await window.chatbox.setStatus(id);
    const ok = (r as { ok?: boolean })?.ok !== false;
    flash(ok ? 'Status added to cycle' : `Couldn't pin: ${(r as { error?: string })?.error ?? 'blocked'}`);
  };

  const manuals = (state?.pinnedItems ?? []).filter((p) => p.key.startsWith('manual:'));
  const manMax = settings.pinManualMax ?? 10;

  return (
    <div className="control">
      {/* Status switcher — click to pin (joins the cycle), click again to
          remove. Capped at pinStatusMax. */}
      <h3 className="ctl-h">
        Status
        <span className="pin-counter" title="Pinned statuses / cap">
          {pinnedStatusCount}/{statusMax}
        </span>
      </h3>
      <div className="status-row">
        {settings.statuses.map((s) => {
          const on = pinnedKeys.has(`status:${s.id}`);
          const capped = !on && pinnedStatusCount >= statusMax;
          return (
            <button
              key={s.id}
              className={`status-btn ${on ? 'on' : ''} ${capped ? 'disabled' : ''}`}
              onClick={() => toggleStatus(s.id)}
              title={
                on
                  ? 'Click to remove from cycle'
                  : capped
                    ? `Cap reached — max ${statusMax} pinned statuses`
                    : 'Click to add to cycle'
              }
            >
              <span>{s.icon}</span>
              {s.label}
              {on && (
                <span className="pin-dot" aria-hidden>
                  📌
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Active pins — one row per item in the live cycle. */}
      {settings.pinSentMessages !== false && (state?.pinnedItems?.length ?? 0) > 0 && (
        <div className="pin-list">
          <div className="pin-list-head">
            <span className="pin-tag">📌 In cycle ({state!.pinnedItems!.length})</span>
            <button
              className="btn ghost tiny"
              onClick={async () => {
                await window.chatbox.clearPin();
                flash('All pins cleared.');
              }}
              title="Remove every pinned item from the cycle"
            >
              ✕ Unpin all
            </button>
          </div>
          {state!.pinnedItems!.map((p) => (
            <div className="pin-row" key={p.key}>
              <span className="pin-key small muted">{labelForKey(p.key, settings)}</span>
              <span className="pin-text" title={p.text}>
                {p.text.length > 60 ? p.text.slice(0, 60) + '…' : p.text}
              </span>
              <button
                className="btn ghost tiny"
                onClick={async () => {
                  await window.chatbox.removePin(p.key);
                  flash(`Removed: ${p.text.slice(0, 30)}`);
                }}
                title="Remove just this pin"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Pinned manual messages, with per-row unpin. */}
      {manuals.length > 0 && (
        <>
          <h3 className="ctl-h">
            Pinned messages
            <span className="pin-counter" title="Pinned manual messages / cap">
              {manuals.length}/{manMax}
            </span>
          </h3>
          <ul className="manual-pin-list">
            {manuals.map((p) => (
              <li key={p.key} className="manual-pin-row">
                <span className="manual-pin-text">{p.text}</span>
                <button
                  className="btn ghost tiny"
                  title="Unpin"
                  onClick={async () => {
                    await window.chatbox.removePin(p.key);
                    flash('Unpinned');
                  }}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Saved Messages — persisted composer text + persona phrase packs.
          Click a message to send it; ✕ deletes it. Saved from the ★ Save
          button on the Control composer / the AI Personality panel. */}
      {(settings.savedMessages?.length ?? 0) > 0 && (
        <>
          <h3 className="ctl-h">Saved Messages</h3>
          <div className="saved-msgs">
            {settings.savedMessages!.map((m) => (
              <div className="saved-msg" key={m.id}>
                <button
                  className="saved-msg-text"
                  title="Send this message"
                  onClick={() => {
                    void window.chatbox.sendMessage(m.text);
                    flash('Sent');
                  }}
                >
                  {m.text}
                </button>
                <button
                  className="saved-msg-del btn ghost tiny"
                  title="Delete saved message"
                  onClick={() =>
                    onPersist({
                      ...settings,
                      savedMessages: (settings.savedMessages ?? []).filter((x) => x.id !== m.id),
                    })
                  }
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Cycle behaviour */}
      <h3 className="ctl-h">Cycle</h3>
      <label className="chk pin-toggle">
        <input
          type="checkbox"
          checked={settings.pinSentMessages !== false}
          onChange={(e) => onPersist({ ...settings, pinSentMessages: e.target.checked })}
        />
        <span>
          📌 Keep sent messages in the live cycle
          <span className="ka-hint"> (auto-include manual sends every tick)</span>
        </span>
      </label>
      <label className="chk pin-toggle">
        <input
          type="checkbox"
          checked={settings.pinRotate !== false}
          onChange={(e) => onPersist({ ...settings, pinRotate: e.target.checked })}
        />
        <span>
          🔄 Rotate pinned items (cycle one at a time, loop around)
          <span className="ka-hint"> off = stack them all as separate lines</span>
        </span>
      </label>
      {settings.pinRotate !== false && (
        <div className="pin-cycle-row row">
          <label className="chk small">
            <input
              type="checkbox"
              checked={settings.pinShuffle ?? false}
              onChange={(e) => onPersist({ ...settings, pinShuffle: e.target.checked })}
            />
            🔀 Shuffle pins (random order)
          </label>
          <label className="small">
            Cycle every
            <input
              type="number"
              min={2}
              max={60}
              className="mini-input"
              value={settings.pinRotateSec ?? 5}
              onChange={(e) =>
                onPersist({
                  ...settings,
                  pinRotateSec: Math.max(2, Math.min(60, Number(e.target.value) || 5)),
                })
              }
            />
            s
          </label>
        </div>
      )}

      {/* Keep-alive — re-send the last message so VRChat's ~20s auto-clear
          never blanks the chatbox. */}
      <div className="keepalive-row">
        <label className="chk">
          <input
            type="checkbox"
            checked={settings.refreshLoop.enabled}
            onChange={(e) =>
              onPersist({
                ...settings,
                refreshLoop: { ...settings.refreshLoop, enabled: e.target.checked },
              })
            }
          />
          <span className="ka-label">
            📌 Keep alive
            <span className="ka-hint">re-send last every</span>
          </span>
        </label>
        <input
          className="mini-input ka-secs"
          type="number"
          min={4}
          max={60}
          value={settings.refreshLoop.intervalSec}
          onChange={(e) =>
            onPersist({
              ...settings,
              refreshLoop: {
                ...settings.refreshLoop,
                intervalSec: Math.max(4, Number(e.target.value)),
              },
            })
          }
        />
        <span className="ka-unit">sec</span>
        <span className={`ka-pill ${settings.refreshLoop.enabled ? 'on' : 'off'}`}>
          {settings.refreshLoop.enabled ? 'PINNED' : 'OFF'}
        </span>
      </div>

      {/* Time-of-day scheduled statuses (moved here from Features). */}
      <ScheduledStatusPanel settings={settings} onPersist={onPersist} />
    </div>
  );
}

/** Human-readable label for a pin slot key. */
function labelForKey(key: string, settings: AppSettings): string {
  if (key === 'manual') return '✏️ Manual';
  if (key.startsWith('manual:')) return '✏️ Manual';
  if (key === 'autoresponder') return '💤 Auto-responder';
  if (key.startsWith('status:')) {
    const id = key.slice('status:'.length);
    const s = settings.statuses.find((x) => x.id === id);
    return s ? `${s.icon ?? ''} ${s.label}`.trim() : key;
  }
  if (key.startsWith('phrase:')) {
    const id = key.slice('phrase:'.length);
    const p = settings.phrases.find((x) => x.id === id);
    return p ? `⚡ ${p.label}` : key;
  }
  return key;
}
