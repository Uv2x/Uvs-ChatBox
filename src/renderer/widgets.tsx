import type { OscTelemetry, AudioStatus, AfkState, InstanceEvent } from '../shared/types';

/** Lobby Avatar HUD — the "ACTIVE OSC / Broadcasting via IP…" banner. */
export function LobbyHud(props: { live: boolean; ip: string; port: number; target: string }) {
  const { live, ip, port, target } = props;
  return (
    <div className={`hud ${live ? 'live' : ''}`}>
      <div className="hud-scan" />
      <div className="hud-row">
        <span className={`hud-led ${live ? 'on' : ''}`} />
        <span className="hud-state">{live ? 'ACTIVE OSC' : 'STANDBY'}</span>
        <span className="hud-target">{target.toUpperCase()}</span>
      </div>
      <div className="hud-line">
        Broadcasting via IP : <b>{ip}</b> on target port <b>{port}</b>
      </div>
    </div>
  );
}

/** Live OSC Telemetry — sparkline + throughput readouts. */
export function TelemetryPanel(props: { t: OscTelemetry | null }) {
  const t = props.t;
  const hist = t?.history ?? new Array(30).fill(0);
  const max = Math.max(1, ...hist);
  const w = 260;
  const h = 54;
  const step = w / (hist.length - 1 || 1);
  const points = hist
    .map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`)
    .join(' ');

  const kb = (bytes: number) => (bytes / 1024).toFixed(1);

  return (
    <div className="telemetry">
      <div className="telemetry-head">
        <span className="tele-title">LIVE OSC TELEMETRY · NETWORK FLOW</span>
        <span className="tele-sub">broadcast frequency &amp; throughput</span>
      </div>
      <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent-2)" stopOpacity="0.5" />
            <stop offset="100%" stopColor="var(--accent-2)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={`0,${h} ${points} ${w},${h}`} fill="url(#sparkFill)" />
        <polyline points={points} fill="none" stroke="var(--accent-2)" strokeWidth="1.5" />
      </svg>
      <div className="tele-grid">
        <Metric label="OUT /s" value={`${t?.sendRate ?? 0} msg`} accent />
        <Metric label="IN /s" value={`${t?.recvRate ?? 0} msg`} />
        <Metric label="↑ THRPUT" value={`${kb(t?.bytesOut ?? 0)} KB/s`} accent />
        <Metric label="↓ THRPUT" value={`${kb(t?.bytesIn ?? 0)} KB/s`} />
        <Metric label="Σ SENT" value={String(t?.totalSent ?? 0)} />
        <Metric label="Σ RECV" value={String(t?.totalRecv ?? 0)} />
      </div>
    </div>
  );
}

function Metric(props: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="metric">
      <span className="metric-label">{props.label}</span>
      <span className={`metric-value ${props.accent ? 'a' : ''}`}>{props.value}</span>
    </div>
  );
}

/** Compact audio (mute/deaf) indicator. */
export function AudioIndicator(props: { a: AudioStatus | null }) {
  const a = props.a;
  const state = a?.deafened ? 'deaf' : a?.muted ? 'muted' : 'open';
  const label = state === 'deaf' ? 'DEAFENED' : state === 'muted' ? 'MUTED' : 'MIC OPEN';
  const icon = state === 'deaf' ? '🙉' : state === 'muted' ? '🔇' : '🎙';
  return (
    <div className={`audio-pill ${state}`}>
      <span>{icon}</span>
      <span>{label}</span>
    </div>
  );
}

/** AFK + instance live status row. */
export function StatusStrip(props: { afk: AfkState | null; instance: InstanceEvent | null }) {
  const { afk, instance } = props;
  return (
    <div className="status-strip">
      <span className={`chip ${afk?.afk ? 'warn' : ''}`}>
        {afk?.afk ? `💤 AFK ${Math.floor((afk.idleSec || 0) / 60)}m` : '🟢 Active'}
      </span>
      {instance && (
        <span className="chip info">
          {instance.type === 'join'
            ? '➕'
            : instance.type === 'leave'
              ? '➖'
              : instance.type === 'world'
                ? '🌐'
                : '🚪'}{' '}
          {instance.detail}
        </span>
      )}
    </div>
  );
}
