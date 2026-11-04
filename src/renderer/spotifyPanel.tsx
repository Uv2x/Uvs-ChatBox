import { useEffect, useState } from 'react';
import type { AppSettings } from '../shared/types';
import { renderBar, BAR_STYLES, type BarStyle } from '../shared/progressBar';

/** "Spotify" feature panel — controls the now-playing chatbox module AND
 *  the standalone Live Lyrics toggle. Lyrics no longer live inside the
 *  StatusRelay; turning the toggle on appends the current synced lyric line
 *  under the song-info line in the chatbox while the live loop is running.
 *
 *  Despite the name "Spotify", the data source is Windows Media Session
 *  (Spotify, YouTube, Apple Music, browser players, …). */
export function SpotifyPanel(props: {
  settings: AppSettings;
  onPersist: (s: AppSettings) => void;
  renderModuleHeader: (id: string) => JSX.Element | null;
}) {
  const { settings, onPersist, renderModuleHeader } = props;
  const ll = settings.liveLyrics ?? { enabled: false };
  const lyricsOn = !!ll.enabled;

  const patchLyrics = (patch: Partial<NonNullable<AppSettings['liveLyrics']>>) =>
    onPersist({ ...settings, liveLyrics: { ...ll, ...patch } });
  const toggleLyrics = (enabled: boolean) => patchLyrics({ enabled });

  // Lyrics source health — so an LRCLib outage shows as a clear warning
  // instead of lyrics silently disappearing. Polled only while lyrics are on.
  const [lyricsHealth, setLyricsHealth] = useState<{
    available: boolean;
    error: string;
    retryInSec: number;
  } | null>(null);
  useEffect(() => {
    if (!lyricsOn) {
      setLyricsHealth(null);
      return;
    }
    let cancelled = false;
    const tick = () =>
      void window.chatbox
        .getLyricsStatus()
        .then((s) => !cancelled && setLyricsHealth(s))
        .catch(() => {});
    tick();
    const id = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [lyricsOn]);

  const LANGS: [string, string][] = [
    ['en', 'English'],
    ['ja', 'Japanese'],
    ['ko', 'Korean'],
    ['es', 'Spanish'],
    ['fr', 'French'],
    ['de', 'German'],
    ['ar', 'Arabic'],
    ['zh', 'Chinese'],
    ['pt', 'Portuguese'],
    ['ru', 'Russian'],
    ['it', 'Italian'],
  ];

  // ---- Progress bar ({bar}/{time} media tokens) ----
  const mp = settings.mediaProgress ?? { style: 'knob' as BarStyle, width: 8 };
  const patchBar = (patch: Partial<NonNullable<AppSettings['mediaProgress']>>) =>
    onPersist({ ...settings, mediaProgress: { ...mp, ...patch } });
  const mediaTemplate = settings.modules.find((m) => m.id === 'media')?.template ?? '';
  // The bar is "on" whenever the media template carries a bar token. The
  // toggle adds/removes those tokens so the checkbox directly controls the
  // in-chatbox bar without the user hand-editing the template.
  const barOn = /\{bar\}|\{time\}|\{elapsed\}|\{total\}/.test(mediaTemplate);
  const setBarEnabled = (on: boolean) => {
    let tpl = mediaTemplate;
    if (on) {
      if (!/\{bar\}/.test(tpl)) tpl = `${tpl.trim()} {bar} {time}`.trim();
    } else {
      tpl = tpl
        .replace(/\s*\{bar\}/g, '')
        .replace(/\s*\{time\}/g, '')
        .replace(/\s*\{elapsed\}/g, '')
        .replace(/\s*\{total\}/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
    }
    onPersist({
      ...settings,
      modules: settings.modules.map((m) => (m.id === 'media' ? { ...m, template: tpl } : m)),
    });
  };
  const barPreview = `♪ Song Title ${renderBar(0.62, mp.style, mp.width)} 2:14/3:45`;

  return (
    <div className="feat">
      <h3>🎵 Spotify</h3>
      {renderModuleHeader('media')}
      <p className="small muted">
        Reads the currently-playing track from any app registered with Windows Media Session. Edit
        the template above to change how the line is formatted.
      </p>

      <h4 className="mini-h mt">📊 Progress bar</h4>
      <label className="chk">
        <input type="checkbox" checked={barOn} onChange={(e) => setBarEnabled(e.target.checked)} />
        Show a live progress bar with the song
      </label>
      <p className="small muted">
        Toggles the <code>{'{bar}'}</code> + <code>{'{time}'}</code> tokens in the media template.
        The bar advances every update tick.
      </p>
      <div className="row">
        <label className="grow">
          Style
          <select
            value={mp.style}
            onChange={(e) => patchBar({ style: e.target.value as BarStyle })}
          >
            {BAR_STYLES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Width
          <input
            type="number"
            min={3}
            max={20}
            value={mp.width}
            onChange={(e) =>
              patchBar({ width: Math.max(3, Math.min(20, Number(e.target.value) || 8)) })
            }
          />
        </label>
      </div>
      <div className="bar-preview mono">{barPreview}</div>

      <h4 className="mini-h mt">🎤 Live lyrics</h4>
      <p className="small muted">
        When on, the chatbox shows the current synced lyric line right under the song name — updates
        every live tick. Source: LRCLib (free, no account). Best coverage on mainstream tracks.
      </p>
      <label className="chk">
        <input
          type="checkbox"
          checked={lyricsOn}
          onChange={(e) => toggleLyrics(e.target.checked)}
        />
        Send live lyrics with the song name
      </label>
      {lyricsOn && lyricsHealth && !lyricsHealth.available && (
        <p className="small mt" style={{ color: 'var(--danger)' }}>
          ⚠ The lyrics database (LRCLib) isn&apos;t responding right now
          {lyricsHealth.error ? ` (${lyricsHealth.error})` : ''} — this is on their end, not the
          app. Lyrics will come back on their own when it&apos;s back up
          {lyricsHealth.retryInSec > 0 ? ` (next check in ${lyricsHealth.retryInSec}s)` : ''}.
        </p>
      )}
      {lyricsOn && (
        <>
          <label className="row grow small mt">
            <span style={{ minWidth: 150 }}>Update lyrics every</span>
            <input
              type="range"
              min={1}
              max={5}
              step={0.5}
              value={ll.intervalSec ?? 2}
              onChange={(e) => patchLyrics({ intervalSec: Number(e.target.value) })}
              className="grow"
            />
            <b style={{ minWidth: 40, textAlign: 'right' }}>{ll.intervalSec ?? 2}s</b>
          </label>
          <p className="small muted">
            Lower = snappier, but VRChat drops chatbox messages sent faster than ~1 per second.
          </p>
          <label className="chk mt">
            <input
              type="checkbox"
              checked={!!ll.romaji}
              onChange={(e) => patchLyrics({ romaji: e.target.checked })}
            />
            Add romaji line (kana → rōmaji, for Japanese tracks)
          </label>
          <label className="chk">
            <input
              type="checkbox"
              checked={!!ll.translate}
              onChange={(e) => patchLyrics({ translate: e.target.checked })}
            />
            Translate the current line
          </label>
          {ll.translate && (
            <label className="row small mt">
              Translate to
              <select
                value={ll.translateLang ?? 'en'}
                onChange={(e) => patchLyrics({ translateLang: e.target.value })}
              >
                {LANGS.map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="small muted mt">
            Requires Live Updates to be running (the ▶ button on the left). Romaji covers kana only
            (kanji stays as-is). Translation uses the free gateway and is cached per line.
          </p>
        </>
      )}
    </div>
  );
}
