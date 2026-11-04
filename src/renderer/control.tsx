import { useEffect, useState } from 'react';
import type { AppSettings, AppState, HistoryEntry, ConnStatus } from '../shared/types';
import { ScheduledSendsPanel } from './scheduled';

/**
 * Control surface: connection health, profile switcher, panic switch,
 * scheduled sends, AI line generator, macros, timelines, variables, live
 * param monitor, and recent history. All actions route through the
 * main-process ActionEngine via window.chatbox.
 *
 * Status pinning / cycle controls moved to their own Status tab
 * (statusTab.tsx); the quick-phrase library UI was retired.
 */
export function ControlPanel(props: {
  settings: AppSettings;
  onPersist: (s: AppSettings) => void;
  flash: (m: string) => void;
}) {
  const { settings, flash } = props;
  const [state, setState] = useState<AppState | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [conn, setConn] = useState<ConnStatus | null>(null);
  const [varName, setVarName] = useState('name');
  const [varValue, setVarValue] = useState('');
  // Global pause flag mirror. The main process owns the truth; we just
  // listen for pushed updates and show the right UI affordance.
  const [paused, setPausedState] = useState(false);

  useEffect(() => {
    window.chatbox.getPaused().then(setPausedState);
    const off = window.chatbox.onPauseUpdate(setPausedState);
    return () => {
      off();
    };
  }, []);

  const togglePaused = async () => {
    const next = await window.chatbox.setPaused(!paused);
    setPausedState(next);
    flash(next ? '⏸ All sending paused' : '▶ Sending resumed');
  };

  useEffect(() => {
    window.chatbox.getState().then(setState);
    window.chatbox.getHistory().then(setHistory);
    const offState = window.chatbox.onStateUpdate((s) => {
      setState(s);
      window.chatbox.getHistory().then(setHistory);
    });
    const offConn = window.chatbox.onConnUpdate(setConn);
    const offHot = window.chatbox.onHotkeyFired((info) => flash(`Hotkey: ${info.type} ${info.id}`));
    return () => {
      offState();
      offConn();
      offHot();
    };
  }, [flash]);

  const runMacro = async (id: string, name: string) => {
    await window.chatbox.runMacro(id);
    flash(`Macro: ${name}`);
  };
  const runTimeline = async (id: string, name: string) => {
    await window.chatbox.runTimeline(id);
    flash(`Timeline: ${name}`);
  };
  const switchProfile = async (id: string) => {
    await window.chatbox.switchProfile(id);
    flash('Profile switched');
  };
  const undo = async () => {
    await window.chatbox.undoLast();
    flash('Undid last');
  };

  const currentStatus = settings.statuses.find((s) => s.id === state?.currentStatusId);

  const setVariable = async () => {
    if (!varName.trim()) return;
    await window.chatbox.runAction({ kind: 'setVariable', name: varName, value: varValue });
    flash(`Set {${varName}}`);
  };

  return (
    <div className="control">
      {/* Connection + state header */}
      <div className="ctl-head">
        <div
          className={`conn-dot ${conn?.health ?? 'idle'}`}
          title={conn?.lastError || conn?.health}
        />
        <span className="ctl-conn">{(conn?.health ?? 'idle').toUpperCase()}</span>
        <span className="ctl-status">
          {currentStatus ? `${currentStatus.icon} ${currentStatus.label}` : '—'}
        </span>
        {/* Profile chip picker — each profile renders as a colored chip
            with its emoji + name. Click switches. Active profile is
            outlined in its own accent color. Falls back to a vanilla
            <select> when there are 4+ profiles to avoid horizontal sprawl. */}
        {settings.profiles.length <= 4 ? (
          <div className="profile-chips">
            {settings.profiles.map((p) => (
              <button
                key={p.id}
                className={`profile-chip ${settings.activeProfileId === p.id ? 'on' : ''}`}
                style={p.color ? { ['--prof-color' as string]: p.color } : undefined}
                onClick={() => switchProfile(p.id)}
                title={p.name}
              >
                {p.icon && <span className="profile-chip-icon">{p.icon}</span>}
                <span>{p.name}</span>
              </button>
            ))}
          </div>
        ) : (
          <select
            className="profile-sel"
            value={settings.activeProfileId}
            onChange={(e) => switchProfile(e.target.value)}
          >
            {settings.profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.icon ? `${p.icon} ` : ''}
                {p.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* 🛑 Panic switch — single button that gates ALL chatbox sends at
          the OSC layer. While ON, no subsystem can write to /chatbox/input.
          State is mirrored from main so the tray menu and this button
          stay in sync. Big and red on purpose — this is a "something is
          on fire" button, not a casual toggle. */}
      <button
        className={`panic-btn ${paused ? 'on' : ''}`}
        onClick={togglePaused}
        title={
          paused
            ? 'Currently paused — nothing is being sent to VRChat. Click to resume.'
            : 'Stop every subsystem from sending to the chatbox. Tray menu has the same toggle.'
        }
      >
        {paused
          ? '▶ Resume Sending  (all subsystems blocked)'
          : '🛑 Stop Everything  (panic — kills all sends)'}
      </button>

      {/* Scheduled send-later outbox — compose now, send at a delay. */}
      <ScheduledSendsPanel flash={flash} />

      {/* ✨ AI generator — one-click "suggest me a chatbox line". When AI
          is on, the button fires generateLine + pipes the result into the
          manual textarea (you can edit before sending) or sends directly. */}
      {settings.ai?.enabled && settings.ai?.features?.generateLine && (
        <AiGenerateRow settings={settings} flash={flash} />
      )}

      {/* Macros + Timelines */}
      <div className="ctl-cols">
        {settings.featureToggles.macros && (
          <div>
            <h3 className="ctl-h">Macros</h3>
            {settings.macros.map((m) => (
              <button key={m.id} className="run-btn" onClick={() => runMacro(m.id, m.name)}>
                ⚙ {m.name}
              </button>
            ))}
          </div>
        )}
        {settings.featureToggles.timelines && (
          <div>
            <h3 className="ctl-h">Timelines</h3>
            {settings.timelines.map((t) => (
              <div key={t.id} className="tl-row">
                <button className="run-btn" onClick={() => runTimeline(t.id, t.name)}>
                  ▶ {t.name}
                </button>
              </div>
            ))}
            <button className="btn ghost tiny" onClick={() => window.chatbox.stopTimeline()}>
              ■ Stop
            </button>
          </div>
        )}
      </div>

      {/* Variables (spec §4) */}
      <h3 className="ctl-h">Variables</h3>
      <div className="var-row">
        <input
          className="mini-input"
          value={varName}
          onChange={(e) => setVarName(e.target.value)}
          placeholder="name"
        />
        <input
          className="mini-input"
          value={varValue}
          onChange={(e) => setVarValue(e.target.value)}
          placeholder="value"
        />
        <button className="btn ghost tiny" onClick={setVariable}>
          Set
        </button>
      </div>
      {state && Object.keys(state.variables).length > 0 && (
        <div className="var-list">
          {Object.entries(state.variables).map(([k, v]) => (
            <span key={k} className="var-chip">
              {`{${k}}`}={v}
            </span>
          ))}
        </div>
      )}

      {/* Live OSC parameter monitor (spec §12) */}
      {settings.featureToggles.connectionMonitor && conn && conn.monitor.length > 0 && (
        <>
          <h3 className="ctl-h">OSC Monitor</h3>
          <div className="monitor">
            {conn.monitor.slice(0, 8).map((m, i) => (
              <div key={i} className="mon-row">
                <span className="mon-addr">{m.address}</span>
                <span className="mon-val">{m.value}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* History (spec §11) */}
      {settings.featureToggles.history && (
        <>
          <div className="row between">
            <h3 className="ctl-h">History</h3>
            <button className="btn ghost tiny" onClick={undo}>
              ↶ Undo
            </button>
          </div>
          <div className="history">
            {history.length === 0 ? (
              <span className="muted small">No actions yet.</span>
            ) : (
              history.slice(0, 12).map((h, i) => (
                <div key={i} className={`hist-row ${h.ok ? '' : 'err'}`}>
                  <span className="hist-time">
                    {new Date(h.at).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>
                  <span className="hist-desc">{h.describe}</span>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Inline AI generator chip on the Control panel. Two buttons:
 *  ✨ Suggest — drops the generated line into the manual textarea so the
 *               user can edit before sending.
 *  ⚡ Send now — fires the line straight to the chatbox via runActions,
 *               so it joins the cycle like any other manual send.
 *  Picks up music / status / world context from main so the model can
 *  reference what's actually happening. */
function AiGenerateRow(props: { settings: AppSettings; flash: (m: string) => void }) {
  const { settings, flash } = props;
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<string>('');

  const fetchLine = async (): Promise<string | null> => {
    setBusy(true);
    try {
      const media = await window.chatbox.getMediaNow().catch(() => null);
      const status = settings.statuses.find((s) => s.id === settings.state?.currentStatusId)?.label;
      const r = await window.chatbox.aiGenerateLine({
        status,
        music: media && media.title ? { title: media.title, artist: media.artist || '' } : null,
      });
      if (!r.ok || !r.data) {
        flash(`AI: ${r.error ?? 'no response'}`);
        return null;
      }
      setLast(r.data);
      return r.data;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ai-row">
      <span className="ai-tag">✨ AI</span>
      <button
        className="btn ghost tiny"
        disabled={busy}
        onClick={async () => {
          const text = await fetchLine();
          if (text) flash(`Suggested: ${text} — copy below`);
        }}
        title="Generate a line and show it here"
      >
        {busy ? '…' : 'Suggest'}
      </button>
      <button
        className="btn primary tiny"
        disabled={busy}
        onClick={async () => {
          const text = await fetchLine();
          if (text) {
            await window.chatbox.sendMessage(text);
            flash(`Sent: ${text}`);
          }
        }}
        title="Generate + send immediately (joins the live cycle)"
      >
        {busy ? '…' : '⚡ Send now'}
      </button>
      {last && (
        <span className="ai-last" title={last}>
          {last.length > 50 ? last.slice(0, 50) + '…' : last}
        </span>
      )}
    </div>
  );
}
