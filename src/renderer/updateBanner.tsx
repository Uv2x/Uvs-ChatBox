import { useEffect, useState } from 'react';
import type { UpdateStatus } from '../shared/types';

/** App-wide update bar. The main process checks GitHub Releases in the
 *  background and pushes UPDATE_STATUS; this shows Download → progress →
 *  "Restart to update". Nothing downloads until the user clicks. */
export function UpdateBanner() {
  const [u, setU] = useState<UpdateStatus | null>(null);
  const [hiddenFor, setHiddenFor] = useState<string | null>(null);

  useEffect(() => window.chatbox.onUpdateStatus((s: UpdateStatus) => setU(s)), []);

  if (!u || !(u.available || u.downloading || u.downloaded)) return null;
  // "Later" hides it for this version only — a newer release shows again.
  if (hiddenFor && hiddenFor === u.latestVersion && !u.downloading) return null;

  return (
    <div className="update-banner">
      {u.downloaded ? (
        <>
          <span>
            ✓ Update <b>v{u.latestVersion}</b> is ready.
          </span>
          <span className="grow" />
          <button className="btn primary tiny" onClick={() => void window.chatbox.installUpdate()}>
            Restart to update
          </button>
          <button className="btn ghost tiny" onClick={() => setHiddenFor(u.latestVersion ?? '')}>
            On next quit
          </button>
        </>
      ) : u.downloading ? (
        <>
          <span>Downloading update…</span>
          <div className="update-progress grow">
            <div style={{ width: `${u.percent ?? 0}%` }} />
          </div>
          <b>{u.percent ?? 0}%</b>
        </>
      ) : (
        <>
          <span>
            ⬆ Update <b>v{u.latestVersion}</b> is available (you have v{u.currentVersion}).
          </span>
          <span className="grow" />
          <button className="btn primary tiny" onClick={() => void window.chatbox.applyUpdate()}>
            Download
          </button>
          <button className="btn ghost tiny" onClick={() => setHiddenFor(u.latestVersion ?? '')}>
            Later
          </button>
        </>
      )}
    </div>
  );
}
