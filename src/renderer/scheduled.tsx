import { useEffect, useState } from 'react';

interface Scheduled {
  id: string;
  text: string;
  fireAt: number;
}

/** Scheduled-send outbox panel. Compose a message + pick a delay (minutes)
 *  or an absolute time — the entry is stored in settings and fired by the
 *  main-process scheduler ticker (every 5s). Survives app restarts. */
export function ScheduledSendsPanel(props: { flash: (m: string) => void }) {
  const { flash } = props;
  const [queue, setQueue] = useState<Scheduled[]>([]);
  const [text, setText] = useState('');
  // Delay in minutes (most common case). Falls back to absolute clock when
  // > 0 — keeps the picker simple instead of a full date-time control.
  const [delayMin, setDelayMin] = useState(5);

  const refresh = async () => {
    try {
      setQueue(await window.chatbox.scheduleList());
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    void refresh();
    // Poll every 5s so fired items disappear from the UI promptly.
    const id = window.setInterval(refresh, 5000);
    return () => window.clearInterval(id);
  }, []);

  const add = async () => {
    const t = text.trim();
    if (!t) {
      flash('Type a message first');
      return;
    }
    const fireAt = Date.now() + Math.max(1, delayMin) * 60_000;
    const res = await window.chatbox.scheduleAdd(t, fireAt);
    if (res.ok) {
      flash(`Scheduled for ${new Date(fireAt).toLocaleTimeString()}`);
      setText('');
      void refresh();
    } else {
      flash(`Schedule failed: ${res.reason}`);
    }
  };

  const cancel = async (id: string) => {
    await window.chatbox.scheduleRemove(id);
    void refresh();
  };

  // Pretty time-until display: "in 12 min" / "in 1 h 5 min" / "any second now".
  const untilStr = (fireAt: number): string => {
    const ms = fireAt - Date.now();
    if (ms <= 0) return 'any second now';
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `in ${h}h ${m}m`;
    if (m > 0) return `in ${m}m ${s}s`;
    return `in ${s}s`;
  };

  return (
    <div className="sched-panel">
      <h3 className="ctl-h">📨 Scheduled Sends</h3>
      <div className="sched-compose">
        <input
          className="mini-input"
          placeholder="Message to send later…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void add();
          }}
        />
        <label className="interval">
          in
          <input
            type="number"
            min={1}
            max={1440}
            value={delayMin}
            onChange={(e) => setDelayMin(Math.max(1, Number(e.target.value) || 1))}
          />
          min
        </label>
        <button className="btn primary tiny" onClick={() => void add()}>
          Queue
        </button>
      </div>

      {queue.length === 0 ? (
        <p className="small muted mt">No queued messages.</p>
      ) : (
        <div className="sched-list">
          {queue
            .slice()
            .sort((a, b) => a.fireAt - b.fireAt)
            .map((s) => (
              <div className="sched-item" key={s.id}>
                <span className="sched-text">{s.text}</span>
                <span className="sched-when">{untilStr(s.fireAt)}</span>
                <button className="btn ghost tiny" onClick={() => void cancel(s.id)}>
                  ✕
                </button>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
