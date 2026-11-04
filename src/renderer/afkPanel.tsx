import { useEffect, useRef, useState } from 'react';
import type { AppSettings, AfkState } from '../shared/types';

/** Smart AFK feature panel. Wires the AFK module's threshold/label config
 *  AND surfaces the auto-responder toggle (which used to be buried under
 *  Settings) so users can enable "send my AFK message after N minutes of
 *  inactivity" right where they expect it. Also shows a live idle counter
 *  so users can confirm detection is actually working before relying on it. */
export function AfkPanel(props: {
  settings: AppSettings;
  onPersist: (s: AppSettings) => void;
  renderModuleHeader: (id: string) => JSX.Element | null;
}) {
  const { settings, onPersist, renderModuleHeader } = props;
  const [live, setLive] = useState<AfkState | null>(null);
  // Track when the panel was mounted so we can show "polling for X seconds"
  // — useful sanity feedback if the AFK probe fails silently.
  const mountedAt = useRef(Date.now());

  // Poll system idle every 2s while the panel is open. Cheap (one PowerShell
  // spawn) and gives the user immediate visual feedback when they touch the
  // mouse / leave it alone.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const s = await window.chatbox.getAfkNow();
        if (alive) setLive(s);
      } catch {
        /* main side will log */
      }
    };
    void tick();
    const id = window.setInterval(tick, 2000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  const fmt = (secs: number) => {
    if (secs < 60) return `${secs}s`;
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}m ${s}s`;
  };

  const idleSec = live?.idleSec ?? 0;
  const thresholdSec = settings.afk.thresholdSec;
  const pct = Math.min(100, (idleSec / Math.max(1, thresholdSec)) * 100);
  const isAfk = !!live?.afk;
  const cfgAuto = settings.autoResponder;
  const hmd = live?.hmd;
  // Effective AFK decision the auto-responder will reach, surfaced so users
  // can preview what'll happen before enabling.
  const effectiveAfk = hmd?.available ? !hmd.onHead : isAfk;
  const hmdLabel = !hmd?.available
    ? '— (SteamVR not detected)'
    : hmd.onHead
      ? '🥽 On head (in VR)'
      : '🪑 Off head';

  return (
    <div className="feat">
      <h3>💤 Smart AFK Detector</h3>
      {renderModuleHeader('afk')}

      <div className="row">
        <label className="interval">
          Idle threshold
          <input
            type="number"
            min={10}
            value={settings.afk.thresholdSec}
            onChange={(e) =>
              onPersist({
                ...settings,
                afk: { ...settings.afk, thresholdSec: Number(e.target.value) },
              })
            }
          />
          s
        </label>
        <input
          className="mini-input"
          value={settings.afk.label}
          onChange={(e) =>
            onPersist({ ...settings, afk: { ...settings.afk, label: e.target.value } })
          }
        />
      </div>

      {/* Live state — confirms detection is actually working. */}
      <div className={`afk-live ${effectiveAfk ? 'on' : ''}`}>
        <div className="afk-live-head">
          <span className="afk-live-label">{effectiveAfk ? '😴 AFK' : '🟢 Active'}</span>
          <span className="afk-live-num">
            idle: <b>{fmt(idleSec)}</b> / {fmt(thresholdSec)}
          </span>
        </div>
        <div className="afk-bar">
          <div className="afk-bar-fill" style={{ width: `${pct}%` }} />
        </div>
        {/* HMD row — separate so users can see the override that's about
            to take effect (or be told SteamVR isn't reachable). */}
        <div className="afk-hmd">
          <span className="small muted">VR headset</span>
          <span className={`hmd-pill ${hmd?.onHead ? 'on' : hmd?.available ? 'off' : 'na'}`}>
            {hmdLabel}
          </span>
        </div>
        {hmd?.available && (
          <p className="small muted mt">
            {hmd.onHead
              ? "AFK detection is paused while you're in VR."
              : "Headset off-head — you'll be flagged AFK immediately."}
          </p>
        )}
        {live === null && (
          <span className="small muted">
            Probing system idle time…
            {Date.now() - mountedAt.current > 6000 && ' (slower than expected; check terminal log)'}
          </span>
        )}
      </div>

      {/* Auto-responder — promoted from Settings so people can find it. */}
      <h4 className="mini-h mt">Auto-respond when AFK</h4>
      <p className="small muted">
        When you cross the idle threshold above, send a message to the chatbox automatically.
        Edge-triggered: fires once on entering AFK, clears when you come back.
      </p>
      <label className="chk">
        <input
          type="checkbox"
          checked={cfgAuto.enabled}
          onChange={(e) =>
            onPersist({
              ...settings,
              autoResponder: { ...cfgAuto, enabled: e.target.checked },
            })
          }
        />
        Enable auto-response
      </label>
      <label className="chk">
        <input
          type="checkbox"
          checked={cfgAuto.onMute}
          onChange={(e) =>
            onPersist({
              ...settings,
              autoResponder: { ...cfgAuto, onMute: e.target.checked },
            })
          }
        />
        Also trigger when muted in VRChat
      </label>
      <div className="row mt">
        <label className="interval">
          After
          <input
            type="number"
            min={1}
            value={cfgAuto.afterMin}
            onChange={(e) =>
              onPersist({
                ...settings,
                autoResponder: { ...cfgAuto, afterMin: Math.max(1, Number(e.target.value)) },
              })
            }
          />
          min
        </label>
        <input
          className="mini-input"
          placeholder="AFK message to send"
          value={cfgAuto.message}
          onChange={(e) =>
            onPersist({
              ...settings,
              autoResponder: { ...cfgAuto, message: e.target.value },
            })
          }
        />
      </div>
    </div>
  );
}
