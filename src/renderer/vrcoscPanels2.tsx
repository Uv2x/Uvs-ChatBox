// Second batch of feature panels: Scheduled Status, Battery, and VR
// Notifications. Split from vrcoscPanels.tsx purely to keep each file readable.

import { useEffect, useState, type ReactNode } from 'react';
import type { AppSettings, QuestAdbState } from '../shared/types';
import { TokenToggles } from './tokenToggles';

type Persist = (next: AppSettings) => void;

// ---------- SteamVR in-headset notifications ------------------------------

type VrNotifyCfg = NonNullable<AppSettings['vrNotifications']>;
const VR_NOTIFY_DEFAULT: VrNotifyCfg = {
  enabled: false,
  onStatusChange: true,
  onLowBattery: true,
  lowBatteryPct: 20,
  durationSec: 6,
};

export function VrNotifyPanel(props: { settings: AppSettings; onPersist: Persist }) {
  const { settings, onPersist } = props;
  const cfg = settings.vrNotifications ?? VR_NOTIFY_DEFAULT;
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<string>('');
  const save = (patch: Partial<VrNotifyCfg>) =>
    onPersist({ ...settings, vrNotifications: { ...cfg, ...patch } });

  const runTest = async () => {
    setTesting(true);
    setResult('Sending… put your headset on.');
    const r = await window.chatbox.vrNotifyTest();
    setTesting(false);
    setResult(
      r.ok
        ? '✅ Toast sent — you should have seen it in your headset.'
        : `⚠ Failed: ${r.error ?? 'unknown'}${r.debug ? ` (${r.debug})` : ''}`,
    );
  };

  return (
    <div className="feat">
      <h3>🔔 VR Notifications</h3>
      <p className="small muted">
        Pops a toast <b>inside your headset</b> for key events, so you don&apos;t
        have to check the desktop window. <b>SteamVR only</b> (Quest Link / Air
        Link / Virtual Desktop) — a standalone Quest can&apos;t receive these.
      </p>
      <label className="chk">
        <input
          type="checkbox"
          checked={cfg.enabled}
          onChange={(e) => save({ enabled: e.target.checked })}
        />
        Enable in-headset notifications
      </label>

      <div className={cfg.enabled ? '' : 'muted'} style={{ opacity: cfg.enabled ? 1 : 0.5 }}>
        <label className="chk mt">
          <input
            type="checkbox"
            disabled={!cfg.enabled}
            checked={cfg.onStatusChange}
            onChange={(e) => save({ onStatusChange: e.target.checked })}
          />
          When my status changes
        </label>
        <label className="chk mt">
          <input
            type="checkbox"
            disabled={!cfg.enabled}
            checked={cfg.onLowBattery}
            onChange={(e) => save({ onLowBattery: e.target.checked })}
          />
          When a VR device battery is low
        </label>
        <label className="row grow small mt">
          Low-battery threshold
          <input
            type="number"
            min={5}
            max={95}
            disabled={!cfg.enabled || !cfg.onLowBattery}
            value={cfg.lowBatteryPct}
            onChange={(e) =>
              save({ lowBatteryPct: Math.max(5, Math.min(95, Number(e.target.value) || 20)) })
            }
            style={{ width: 70 }}
          />
          %
        </label>
        <label className="row grow small mt">
          Toast duration
          <input
            type="range"
            min={2}
            max={20}
            step={1}
            disabled={!cfg.enabled}
            value={cfg.durationSec ?? 6}
            onChange={(e) => save({ durationSec: Number(e.target.value) })}
            className="grow"
          />
          <b style={{ minWidth: 34, textAlign: 'right' }}>{cfg.durationSec ?? 6}s</b>
        </label>
      </div>

      <div className="row mt">
        <button className="btn ghost" disabled={testing} onClick={runTest}>
          {testing ? 'Sending…' : '🔔 Send test toast'}
        </button>
      </div>
      {result && (
        <p className="small mt" style={{ wordBreak: 'break-word' }}>
          {result}
        </p>
      )}
    </div>
  );
}

// ---------- Scheduled Status by time-of-day -------------------------------

type SchedStatus = NonNullable<AppSettings['scheduledStatuses']>[number];

export function ScheduledStatusPanel(props: { settings: AppSettings; onPersist: Persist }) {
  const { settings, onPersist } = props;
  const list = settings.scheduledStatuses ?? [];
  const save = (next: SchedStatus[]) => onPersist({ ...settings, scheduledStatuses: next });

  const add = () => save([
    ...list,
    {
      id: 'ss_' + Math.random().toString(36).slice(2, 8),
      time: '22:00',
      statusId: settings.statuses[0]?.id ?? '',
      enabled: true,
    },
  ]);
  const update = (id: string, patch: Partial<SchedStatus>) =>
    save(list.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const remove = (id: string) => save(list.filter((s) => s.id !== id));

  return (
    <div className="feat">
      <h3>⏰ Scheduled Status</h3>
      <p className="small muted">
        Automatically switch to a status at a set local time — e.g. flip to
        Sleeping at 23:00. Fires once when the clock reaches the time.
      </p>
      {list.length === 0 && <em className="muted small">No schedules yet.</em>}
      <div className="ss-list">
        {list.map((s) => (
          <div className="ss-row row" key={s.id}>
            <label className="chk small">
              <input type="checkbox" checked={s.enabled} onChange={(e) => update(s.id, { enabled: e.target.checked })} />
            </label>
            <input type="time" value={s.time} onChange={(e) => update(s.id, { time: e.target.value })} />
            <select value={s.statusId} onChange={(e) => update(s.id, { statusId: e.target.value })} className="grow">
              {settings.statuses.map((st) => (
                <option key={st.id} value={st.id}>{st.icon} {st.label}</option>
              ))}
            </select>
            <button className="btn ghost tiny" onClick={() => remove(s.id)}>✕</button>
          </div>
        ))}
      </div>
      <div className="row mt">
        <button className="btn ghost" onClick={add}>+ Add schedule</button>
      </div>
    </div>
  );
}

// ---------- Discord Rich Presence -----------------------------------------

type DiscordCfg = NonNullable<AppSettings['discord']>;
const DISCORD_DEFAULT: DiscordCfg = {
  enabled: false,
  clientId: '',
  details: 'In VRChat',
  state: '{status}',
  showElapsed: true,
  largeImageKey: '',
  largeImageText: "Uv's Chat Box",
};

const DISCORD_STATE_LABEL: Record<string, { text: string; tone: 'ok' | 'warn' | 'muted' }> = {
  off: { text: 'Off', tone: 'muted' },
  connecting: { text: 'Connecting…', tone: 'muted' },
  connected: { text: '✅ Connected — presence is live on your Discord profile', tone: 'ok' },
  'no-client': { text: '⚠ Discord desktop app isn’t running', tone: 'warn' },
  'invalid-id': { text: '⚠ Invalid Application ID — check the number below', tone: 'warn' },
  error: { text: '⚠ Connection error — will retry', tone: 'warn' },
};

export function DiscordPanel(props: { settings: AppSettings; onPersist: Persist }) {
  const { settings, onPersist } = props;
  const cfg = settings.discord ?? DISCORD_DEFAULT;
  const [status, setStatus] = useState<{ state: string; error: string }>({ state: 'off', error: '' });
  const save = (patch: Partial<DiscordCfg>) =>
    onPersist({ ...settings, discord: { ...cfg, ...patch } });

  useEffect(() => {
    let cancelled = false;
    void window.chatbox.getDiscordStatus().then((s) => !cancelled && setStatus(s));
    const off = window.chatbox.onDiscordStatus((s) => setStatus(s));
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const sl = DISCORD_STATE_LABEL[status.state] ?? DISCORD_STATE_LABEL.off!;
  const slColor =
    sl.tone === 'ok' ? 'var(--good, #5fd08a)' : sl.tone === 'warn' ? 'var(--danger)' : undefined;

  return (
    <div className="feat">
      <h3>💬 Discord Rich Presence</h3>
      <p className="small muted">
        Shows what you&apos;re up to on your <b>Discord profile</b> — e.g.{' '}
        <i>Playing VRChat · In VRChat · 2h elapsed</i> — through the local Discord
        app. No login or token; it talks to the Discord client already running on
        this PC.
      </p>
      <label className="chk">
        <input
          type="checkbox"
          checked={cfg.enabled}
          onChange={(e) => save({ enabled: e.target.checked })}
        />
        Enable Discord presence
      </label>

      <div className="small mt" style={{ color: slColor }}>
        <b>Status:</b> {sl.text}
        {status.error && sl.tone === 'warn' ? ` (${status.error})` : ''}
      </div>

      {/* One-time setup: a free Discord application id. */}
      <ol className="small muted" style={{ paddingLeft: 18, marginTop: 8, lineHeight: 1.6 }}>
        <li>
          Go to <b>discord.com/developers/applications</b> → <b>New Application</b>.
          Name it whatever you want the <b>&quot;Playing …&quot;</b> line to say
          (e.g. <i>VRChat</i>).
        </li>
        <li>
          On the app&apos;s <b>General Information</b> page, copy the{' '}
          <b>Application ID</b> and paste it below.
        </li>
        <li>Make sure the <b>Discord desktop app</b> is running.</li>
      </ol>

      <label className="grow mt small">
        Discord Application ID
        <input
          type="text"
          className="mono"
          placeholder="e.g. 1180000000000000000"
          value={cfg.clientId}
          onChange={(e) => save({ clientId: e.target.value.trim() })}
        />
      </label>

      <div className="row mt" style={{ gap: 8 }}>
        <label className="grow small">
          Line 1 (details)
          <input type="text" value={cfg.details} onChange={(e) => save({ details: e.target.value })} />
        </label>
        <label className="grow small">
          Line 2 (state)
          <input type="text" value={cfg.state} onChange={(e) => save({ state: e.target.value })} />
        </label>
      </div>
      <p className="small muted mt">
        Tokens: <code>{'{world}'}</code> <code>{'{instanceType}'}</code>{' '}
        <code>{'{players}'}</code> <code>{'{status}'}</code> <code>{'{title}'}</code>{' '}
        <code>{'{artist}'}</code> <code>{'{session}'}</code> <code>{'{time}'}</code>
      </p>

      <label className="chk mt">
        <input
          type="checkbox"
          checked={cfg.showElapsed}
          onChange={(e) => save({ showElapsed: e.target.checked })}
        />
        Show elapsed timer (counts from when VRChat launched)
      </label>

      <details className="mt">
        <summary className="small muted">Optional artwork</summary>
        <p className="small muted mt">
          Upload art under <b>Rich Presence → Art Assets</b> in the Discord app,
          then put an asset&apos;s <b>name</b> here as the large image.
        </p>
        <div className="row" style={{ gap: 8 }}>
          <label className="grow small">
            Large image key
            <input
              type="text"
              value={cfg.largeImageKey}
              onChange={(e) => save({ largeImageKey: e.target.value.trim() })}
            />
          </label>
          <label className="grow small">
            Large image tooltip
            <input
              type="text"
              value={cfg.largeImageText}
              onChange={(e) => save({ largeImageText: e.target.value })}
            />
          </label>
        </div>
      </details>
    </div>
  );
}

// ---------- SteamVR dashboard control overlay -----------------------------

type VrOverlayCfg = NonNullable<AppSettings['vrOverlay']>;

export function VrOverlayPanel(props: { settings: AppSettings; onPersist: Persist }) {
  const { settings, onPersist } = props;
  const cfg = settings.vrOverlay ?? { enabled: false, statusIds: [] };
  const chosen = cfg.statusIds ?? [];
  const save = (patch: Partial<VrOverlayCfg>) =>
    onPersist({ ...settings, vrOverlay: { ...cfg, ...patch } });

  const effective = chosen.length > 0 ? chosen : settings.statuses.slice(0, 6).map((s) => s.id);
  const toggleStatus = (id: string) => {
    const has = chosen.includes(id);
    if (has) {
      save({ statusIds: chosen.filter((x) => x !== id) });
    } else if (chosen.length < 6) {
      save({ statusIds: [...chosen, id] });
    }
  };

  return (
    <div className="feat">
      <h3>🎛️ VR Overlay (control panel)</h3>
      <p className="small muted">
        A laser-clickable panel in VR — switch status, clear pins, and toggle
        dictation without taking the headset off. Choose a <b>dashboard tab</b>
        (open with the SteamVR system button) or an always-visible <b>wrist</b>
        panel on a controller. <b>SteamVR only</b> (Quest Link / Air Link /
        Virtual Desktop).
      </p>
      <label className="chk">
        <input
          type="checkbox"
          checked={cfg.enabled}
          onChange={(e) => save({ enabled: e.target.checked })}
        />
        Enable VR control overlay
      </label>

      {/* Mode: dashboard tab vs always-visible wrist panel. */}
      <div className="row mt" style={{ opacity: cfg.enabled ? 1 : 0.5 }}>
        <label className="small">
          Placement
          <select
            className="mini-input"
            disabled={!cfg.enabled}
            value={cfg.mode ?? 'dashboard'}
            onChange={(e) => save({ mode: e.target.value as 'dashboard' | 'wrist' })}
            style={{ marginLeft: 8 }}
          >
            <option value="dashboard">Dashboard tab (system button)</option>
            <option value="wrist">Wrist — always visible on a controller</option>
          </select>
        </label>
      </div>

      {(cfg.mode ?? 'dashboard') === 'wrist' && (
        <div className="quest-note mt" style={{ opacity: cfg.enabled ? 1 : 0.5 }}>
          <p className="small muted">
            Floats on your chosen controller — point at it with the{' '}
            <b>other</b> controller and pull the trigger to click. Adjust the
            sliders live while wearing the headset until it sits right.
          </p>
          <label className="row small mt">
            Attach to
            <select
              className="mini-input"
              disabled={!cfg.enabled}
              value={cfg.hand ?? 'left'}
              onChange={(e) => save({ hand: e.target.value as 'left' | 'right' })}
              style={{ marginLeft: 8 }}
            >
              <option value="left">Left controller</option>
              <option value="right">Right controller</option>
            </select>
          </label>
          {(
            [
              ['Size', 'sizeCm', 8, 40, 'cm'],
              ['Tilt', 'tiltDeg', -90, 20, '°'],
              ['Up', 'upCm', -15, 20, 'cm'],
              ['Toward you', 'fwdCm', -15, 25, 'cm'],
              ['Right', 'rightCm', -20, 20, 'cm'],
            ] as const
          ).map(([label, key, min, max, unit]) => {
            const dflt: Record<string, number> = {
              sizeCm: 22,
              tiltDeg: -50,
              upCm: 2,
              fwdCm: 6,
              rightCm: 0,
            };
            const val = (cfg[key as keyof VrOverlayCfg] as number | undefined) ?? dflt[key];
            return (
              <label className="row grow small mt" key={key}>
                <span style={{ minWidth: 88 }}>{label}</span>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={1}
                  disabled={!cfg.enabled}
                  value={val}
                  onChange={(e) => save({ [key]: Number(e.target.value) } as Partial<VrOverlayCfg>)}
                  className="grow"
                />
                <b style={{ minWidth: 46, textAlign: 'right' }}>
                  {val}
                  {unit}
                </b>
              </label>
            );
          })}
        </div>
      )}

      <p className="small muted mt">
        Status buttons to show (pick up to 6 — leave all unchecked to use the
        first 6). The panel always adds <b>🧹 Clear pins</b> and <b>🎤 Dictate</b>.
      </p>
      <div className="status-row" style={{ opacity: cfg.enabled ? 1 : 0.5 }}>
        {settings.statuses.map((s) => {
          const on = effective.includes(s.id);
          const isExplicit = chosen.includes(s.id);
          const capped = !isExplicit && chosen.length >= 6;
          return (
            <button
              key={s.id}
              className={`status-btn ${on ? 'on' : ''} ${capped ? 'disabled' : ''}`}
              disabled={!cfg.enabled || capped}
              onClick={() => toggleStatus(s.id)}
              title={capped ? 'Max 6 chosen' : on ? 'Shown on overlay' : 'Add to overlay'}
            >
              <span>{s.icon}</span>
              {s.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Battery (Quest via adb + SteamVR + PC fallback) ----------------

type BatDevice = { kind: string; name: string; percent: number; charging: boolean };

/** One-line, actionable status for each adb state. */
function adbHint(a: QuestAdbState | null): { tone: 'ok' | 'warn' | 'muted'; msg: ReactNode } {
  if (!a) return { tone: 'muted', msg: 'Checking for a Quest over adb…' };
  switch (a.state) {
    case 'ok':
      return { tone: 'ok', msg: `Connected — headset ${a.percent}%${a.charging ? ' ⚡' : ''}.` };
    case 'unauthorized':
      return {
        tone: 'warn',
        msg: (
          <>
            Quest detected but not authorized. Put the headset on and tap{' '}
            <b>Allow USB debugging</b>, then Re-scan.
          </>
        ),
      };
    case 'no-device':
      return {
        tone: 'warn',
        msg: (
          <>
            adb is installed but sees no Quest. Enable <b>Developer Mode</b> (Meta
            phone app), plug in the <b>Link cable</b>, then Re-scan.
          </>
        ),
      };
    case 'no-adb':
      return {
        tone: 'warn',
        msg: (
          <>
            <b>adb.exe not found.</b> Install Android <b>platform-tools</b> (~5&nbsp;MB),
            then set its path below or drop it in your PATH.
          </>
        ),
      };
    default:
      return { tone: 'warn', msg: a.detail || 'adb error.' };
  }
}

export function BatteryPanel(props: { settings: AppSettings; onPersist: Persist }) {
  const { settings, onPersist } = props;
  const [devices, setDevices] = useState<BatDevice[] | null>(null);
  const [diag, setDiag] = useState<string>('');
  const [adb, setAdb] = useState<QuestAdbState | null>(null);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const r = await window.chatbox.getBattery();
      if (!cancelled) {
        setDevices(r.available ? (r.devices as BatDevice[]) : []);
        setDiag(r.diag ?? '');
        setAdb((r.adb as QuestAdbState) ?? null);
      }
    };
    tick();
    const id = setInterval(tick, 8000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const mod = settings.modules.find((m) => m.id === 'battery');
  const on = !!mod?.enabled;
  const setShow = (show: boolean) =>
    onPersist({
      ...settings,
      modules: settings.modules.map((m) => (m.id === 'battery' ? { ...m, enabled: show } : m)),
    });
  const setTemplate = (template: string) =>
    onPersist({
      ...settings,
      modules: settings.modules.map((m) => (m.id === 'battery' ? { ...m, template } : m)),
    });

  const icon = (k: string) =>
    k === 'hmd' ? '🥽' : k === 'controller' ? '🎮' : k === 'tracker' ? '📍' : '🔋';

  const rescan = async () => {
    setScanning(true);
    setDevices(null);
    const r = await window.chatbox.questBatteryRescan();
    setDevices(r.available ? (r.devices as BatDevice[]) : []);
    setDiag(r.diag ?? '');
    setAdb((r.adb as QuestAdbState) ?? null);
    setScanning(false);
  };

  const hint = adbHint(adb);
  const hintColor =
    hint.tone === 'ok' ? 'var(--good, #5fd08a)' : hint.tone === 'warn' ? 'var(--danger)' : undefined;

  return (
    <div className="feat">
      <h3>🔋 Battery</h3>
      <p className="small muted">
        Shows your <b>Quest headset battery</b> (read over <b>adb</b>) plus any
        native SteamVR devices that report battery. Falls back to the PC/laptop
        battery otherwise.
      </p>
      <p className="small muted">
        ⚠ On <b>Meta Link</b>, the Quest does <b>not</b> expose battery through
        SteamVR/OpenVR — so the headset is read straight from the device over
        adb. <b>Controllers can&apos;t be read over Link</b> by any PC app.
      </p>
      <label className="chk">
        <input type="checkbox" checked={on} onChange={(e) => setShow(e.target.checked)} />
        Show battery in chatbox
      </label>
      <div className="svr-status">
        {!devices ? (
          <em className="muted small">Reading…</em>
        ) : devices.length > 0 ? (
          <ul className="kv">
            {devices.map((d, i) => (
              <li key={i}>
                <span>
                  {icon(d.kind)} {d.name}
                </span>
                <b>
                  {d.percent}% {d.charging ? '⚡' : ''}
                </b>
              </li>
            ))}
          </ul>
        ) : (
          <div className="small muted">No battery reading yet — see adb status below.</div>
        )}
      </div>

      {/* Quest-over-adb status + setup guidance. */}
      <div className="quest-note mt">
        <div className="small" style={{ color: hintColor }}>
          <b>Quest battery (adb):</b> {hint.msg}
        </div>
        {adb && adb.state === 'no-adb' && (
          <ol className="small muted" style={{ paddingLeft: 18, marginTop: 6, lineHeight: 1.6 }}>
            <li>
              In the <b>Meta Horizon</b> phone app: Menu → Devices → your headset →{' '}
              <b>Developer Mode</b> → ON (needs a free Meta developer account).
            </li>
            <li>
              Download <b>Android platform-tools</b> from
              developer.android.com/tools/releases/platform-tools, unzip it.
            </li>
            <li>Paste the full path to that folder&apos;s <code>adb.exe</code> below.</li>
            <li>Plug in the Link cable, put the headset on, tap <b>Allow USB debugging</b>.</li>
            <li>Hit Re-scan.</li>
          </ol>
        )}
        <label className="grow mt small">
          Path to adb.exe (optional — auto-detected if in PATH / platform-tools)
          <input
            type="text"
            className="mono"
            placeholder="C:\platform-tools\adb.exe"
            value={settings.questAdbPath ?? ''}
            onChange={(e) => onPersist({ ...settings, questAdbPath: e.target.value })}
          />
        </label>
        {diag && (
          <div className="mono small muted mt" style={{ wordBreak: 'break-all' }}>
            probe: {diag}
          </div>
        )}
      </div>

      <div className="row mt">
        <button className="btn ghost tiny" disabled={scanning} onClick={rescan}>
          {scanning ? 'Scanning…' : '↻ Re-scan'}
        </button>
      </div>
      <label className="grow mt">
        Chatbox line format
        <input
          type="text"
          value={mod?.template ?? '{devices}'}
          onChange={(e) => setTemplate(e.target.value)}
        />
      </label>
      <TokenToggles
        template={mod?.template ?? '{devices}'}
        tokens={['devices', 'percent', 'charging', 'status']}
        onChange={setTemplate}
      />
      <p className="small muted mt">
        <code>{`{devices}`}</code> lists them all (🥽/🎮/📍); <code>{`{percent}`}</code>{' '}
        is the first device. Requires <b>Live Updates</b> + <b>SteamVR</b> running.
      </p>
    </div>
  );
}
