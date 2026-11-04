import { useCallback, useEffect, useState } from 'react';
import type { HealthCheck, HealthStatus } from '../shared/types';

/** System Check — one screen answering "why isn't X working?". Runs every
 *  check in the main process (src/main/health.ts) and shows problems first,
 *  each with a plain-English fix. */

const ORDER: Record<HealthStatus, number> = { error: 0, warn: 1, ok: 2, off: 3 };
const ICON: Record<HealthStatus, string> = { error: '✕', warn: '!', ok: '✓', off: '–' };

export function HealthPanel(props: { flash: (m: string) => void }) {
  const { flash } = props;
  const [rows, setRows] = useState<HealthCheck[] | null>(null);
  const [running, setRunning] = useState(false);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);

  const run = useCallback(async () => {
    setRunning(true);
    try {
      const r = await window.chatbox.systemCheck();
      // Problems first; keep the original order within each group.
      setRows(
        r
          .map((c, i) => ({ c, i }))
          .sort((a, b) => ORDER[a.c.status] - ORDER[b.c.status] || a.i - b.i)
          .map((x) => x.c),
      );
      setCheckedAt(new Date());
    } catch (e) {
      flash(`System check failed: ${(e as Error).message}`);
    } finally {
      setRunning(false);
    }
  }, [flash]);

  useEffect(() => {
    void run();
  }, [run]);

  const errors = rows?.filter((r) => r.status === 'error').length ?? 0;
  const warns = rows?.filter((r) => r.status === 'warn').length ?? 0;
  const summary = !rows
    ? 'Checking…'
    : errors + warns === 0
      ? '✓ Everything that’s turned on is working'
      : [
          errors && `${errors} problem${errors > 1 ? 's' : ''}`,
          warns && `${warns} warning${warns > 1 ? 's' : ''}`,
        ]
          .filter(Boolean)
          .join(' · ');

  const copyReport = async () => {
    if (!rows) return;
    const text = [
      `Uv's Chat Box — System Check (${checkedAt?.toLocaleString() ?? ''})`,
      ...rows.map(
        (r) => `[${r.status.toUpperCase()}] ${r.label}: ${r.detail}${r.fix ? ` → ${r.fix}` : ''}`,
      ),
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      flash('Report copied — paste it anywhere');
    } catch {
      flash('Could not copy the report');
    }
  };

  return (
    <div className="feat">
      <h3>🩺 System Check</h3>
      <p className="small muted">
        Checks every outside service the app relies on — VRChat&apos;s OSC connection, the lyrics
        source, Discord, SteamVR, your Quest, updates — and tells you exactly what to do when
        something&apos;s off. Grey rows are features you have turned off.
      </p>
      <div className="row mt" style={{ alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <b className={`health-summary ${errors ? 'error' : warns ? 'warn' : rows ? 'ok' : ''}`}>
          {summary}
        </b>
        <span className="grow" />
        {checkedAt && <span className="small muted">Checked {checkedAt.toLocaleTimeString()}</span>}
        <button className="btn ghost tiny" disabled={!rows} onClick={() => void copyReport()}>
          Copy report
        </button>
        <button className="btn primary tiny" disabled={running} onClick={() => void run()}>
          {running ? 'Checking…' : '↻ Run check'}
        </button>
      </div>
      <div className="health-list mt">
        {(rows ?? []).map((r) => (
          <div key={r.id} className={`health-row ${r.status}`}>
            <span className={`health-dot ${r.status}`} aria-label={r.status}>
              {ICON[r.status]}
            </span>
            <div className="grow">
              <div>
                <b>{r.label}</b> <span className="small">{r.detail}</span>
              </div>
              {r.fix && <div className="health-fix small">→ {r.fix}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
