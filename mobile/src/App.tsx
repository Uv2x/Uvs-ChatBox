import { useCallback, useEffect, useRef, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import { STATUSES } from './statuses';
import { sendChatbox } from './osc';
import * as spotify from './spotify';

const LS = {
  host: 'uvs.host',
  port: 'uvs.port',
  saved: 'uvs.saved',
};

function load(key: string, dflt: string): string {
  try {
    return localStorage.getItem(key) ?? dflt;
  } catch {
    return dflt;
  }
}

export function App() {
  const [host, setHost] = useState(() => load(LS.host, '192.168.1.'));
  const [port, setPort] = useState(() => load(LS.port, '9000'));
  const [message, setMessage] = useState('');
  const [saved, setSaved] = useState<string[]>(() => {
    try {
      return JSON.parse(load(LS.saved, '[]')) as string[];
    } catch {
      return [];
    }
  });
  const [pinned, setPinned] = useState<string | null>(null);
  const [flash, setFlash] = useState('');
  const [busy, setBusy] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Spotify now-playing
  const [spClientId, setSpClientId] = useState(() => spotify.getClientId());
  const [spConnected, setSpConnected] = useState(() => spotify.isConnected());
  const [spSend, setSpSend] = useState(false);
  const [spTrack, setSpTrack] = useState<string>('');
  const [spTemplate, setSpTemplate] = useState(() => load('uvs.spTemplate', '🎵 {title} — {artist}'));

  useEffect(() => {
    try {
      localStorage.setItem(LS.host, host);
    } catch {
      /* ignore */
    }
  }, [host]);
  useEffect(() => {
    try {
      localStorage.setItem(LS.port, port);
    } catch {
      /* ignore */
    }
  }, [port]);
  useEffect(() => {
    try {
      localStorage.setItem(LS.saved, JSON.stringify(saved));
    } catch {
      /* ignore */
    }
  }, [saved]);

  const say = useCallback((m: string) => {
    setFlash(m);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(''), 2600);
  }, []);

  const portNum = Math.max(1, Math.min(65535, parseInt(port, 10) || 9000));

  const send = useCallback(
    async (text: string, label?: string) => {
      const h = host.trim();
      if (!h || h.endsWith('.')) {
        say('⚠ Set the headset IP first');
        return false;
      }
      setBusy(true);
      try {
        await sendChatbox(h, portNum, text);
        say(text ? `Sent: ${label ?? text}` : 'Chatbox cleared');
        return true;
      } catch (e) {
        say(`⚠ Failed: ${(e as Error).message}`);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [host, portNum, say],
  );

  // Keep-alive: VRChat fades the chatbox after a bit, so while a message is
  // "pinned" we resend it every 8s (works while the app is foregrounded).
  useEffect(() => {
    if (!pinned) return;
    const id = setInterval(() => {
      const h = host.trim();
      if (h && !h.endsWith('.')) void sendChatbox(h, portNum, pinned).catch(() => {});
    }, 8000);
    return () => clearInterval(id);
  }, [pinned, host, portNum]);

  useEffect(() => {
    try {
      localStorage.setItem('uvs.spTemplate', spTemplate);
    } catch {
      /* ignore */
    }
  }, [spTemplate]);

  // Spotify OAuth deep-link (uvschatbox://spotify-callback?code=…) comes back
  // into the app here.
  useEffect(() => {
    const handle = CapApp.addListener('appUrlOpen', ({ url }) => {
      if (!url.includes('spotify-callback')) return;
      void spotify.handleRedirect(url).then((ok) => {
        setSpConnected(ok);
        say(ok ? '✅ Spotify connected' : '⚠ Spotify sign-in failed');
      });
    });
    return () => void handle.then((sub) => sub.remove());
  }, [say]);

  // While enabled, poll Spotify and push the current track to the chatbox.
  useEffect(() => {
    if (!spSend || !spConnected) return;
    let cancelled = false;
    const tick = async () => {
      const np = await spotify.getCurrentTrack().catch(() => null);
      if (cancelled) return;
      if (np && np.playing && np.title) {
        setSpTrack(`${np.title} — ${np.artist}`);
        const line = spTemplate.replace(/\{title\}/g, np.title).replace(/\{artist\}/g, np.artist).trim();
        const h = host.trim();
        if (line && h && !h.endsWith('.')) void sendChatbox(h, portNum, line).catch(() => {});
      } else {
        setSpTrack(np ? '(paused)' : '(nothing playing)');
      }
    };
    void tick();
    const id = setInterval(tick, 12000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [spSend, spConnected, spTemplate, host, portNum]);

  const sendMessage = async () => {
    const t = message.trim();
    if (!t) return;
    await send(t);
  };
  const saveMessage = () => {
    const t = message.trim();
    if (!t || saved.includes(t)) return;
    setSaved([t, ...saved].slice(0, 30));
    say('Saved');
  };
  const togglePin = async (text: string) => {
    if (pinned === text) {
      setPinned(null);
      say('Unpinned (stops keeping it up)');
    } else {
      const ok = await send(text);
      if (ok) {
        setPinned(text);
        say('Pinned — keeping it shown');
      }
    }
  };

  return (
    <div className="app">
      <header className="hdr">
        <h1>Uv&apos;s Chat Box</h1>
        <span className="sub">VRChat chatbox · standalone</span>
      </header>

      <section className="card">
        <label className="lbl">Headset IP &amp; port</label>
        <div className="row">
          <input
            className="in ip"
            inputMode="decimal"
            placeholder="192.168.1.42"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            autoCapitalize="off"
            autoCorrect="off"
          />
          <input
            className="in port"
            inputMode="numeric"
            value={port}
            onChange={(e) => setPort(e.target.value)}
          />
        </div>
        <p className="hint">
          In VRChat on the headset: <b>Settings → OSC → Enabled</b>. The IP is the
          headset&apos;s WiFi address (VRChat OSC menu shows it, or your router).
          This phone must be on the <b>same WiFi</b>.
        </p>
        <div className="row">
          <button className="btn ghost" disabled={busy} onClick={() => void send('👋 connected', '👋')}>
            Test
          </button>
          <button className="btn ghost" disabled={busy} onClick={() => void send('')}>
            Clear chatbox
          </button>
        </div>
      </section>

      <section className="card">
        <label className="lbl">Statuses</label>
        <div className="grid">
          {STATUSES.map((s) => (
            <button
              key={s.id}
              className={`chip ${pinned === s.text ? 'on' : ''}`}
              disabled={busy}
              onClick={() => void send(s.text, `${s.icon} ${s.label}`)}
              onDoubleClick={() => void togglePin(s.text)}
            >
              <span className="ico">{s.icon}</span>
              <span className="cap">{s.label}</span>
            </button>
          ))}
        </div>
        <p className="hint">Tap to send · double-tap to pin (keeps it shown)</p>
      </section>

      <section className="card">
        <label className="lbl">Message</label>
        <textarea
          className="ta"
          rows={2}
          placeholder="Type a chatbox message…"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={144}
        />
        <div className="row">
          <button className="btn primary" disabled={busy} onClick={() => void sendMessage()}>
            Send
          </button>
          <button className="btn ghost" disabled={busy} onClick={() => void togglePin(message.trim())}>
            {pinned && pinned === message.trim() ? '📌 Pinned' : 'Pin'}
          </button>
          <button className="btn ghost" onClick={saveMessage}>
            ★ Save
          </button>
        </div>
      </section>

      <section className="card">
        <label className="lbl">Spotify now-playing</label>
        {!spConnected ? (
          <>
            <p className="hint">
              Puts your Spotify track in the chatbox. Create a free app at{' '}
              <b>developer.spotify.com</b>, add the redirect URI{' '}
              <code>uvschatbox://spotify-callback</code>, paste the <b>Client ID</b>
              , and connect. Spotify <b>Premium</b> is required for dev-mode apps.
            </p>
            <input
              className="in"
              placeholder="Spotify Client ID"
              value={spClientId}
              onChange={(e) => setSpClientId(e.target.value.trim())}
              autoCapitalize="off"
              autoCorrect="off"
            />
            <button
              className="btn primary"
              disabled={!spClientId}
              onClick={() => void spotify.connect(spClientId)}
            >
              Connect Spotify
            </button>
          </>
        ) : (
          <>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="hint">✅ Connected{spTrack ? ` · ${spTrack}` : ''}</span>
              <button
                className="x"
                onClick={() => {
                  spotify.disconnect();
                  setSpConnected(false);
                  setSpSend(false);
                  setSpTrack('');
                }}
              >
                Disconnect
              </button>
            </div>
            <label className="row" style={{ gap: 8 }}>
              <input type="checkbox" checked={spSend} onChange={(e) => setSpSend(e.target.checked)} />
              <span className="hint">Send now-playing to chatbox (updates ~12s, while app is open)</span>
            </label>
            <input className="in" value={spTemplate} onChange={(e) => setSpTemplate(e.target.value)} />
            <p className="hint">
              Tokens: <code>{'{title}'}</code> <code>{'{artist}'}</code>
            </p>
          </>
        )}
      </section>

      {saved.length > 0 && (
        <section className="card">
          <label className="lbl">Saved</label>
          <div className="saved">
            {saved.map((t, i) => (
              <div className="saved-row" key={i}>
                <button className="saved-text" disabled={busy} onClick={() => void send(t)}>
                  {t}
                </button>
                <button
                  className="x"
                  onClick={() => setSaved(saved.filter((_, j) => j !== i))}
                  aria-label="Delete"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {pinned && (
        <div className="pinbar">
          📌 Keeping shown: <b>{pinned.length > 40 ? pinned.slice(0, 40) + '…' : pinned}</b>
          <button className="x" onClick={() => setPinned(null)}>
            ✕
          </button>
        </div>
      )}

      {flash && <div className="flash">{flash}</div>}
    </div>
  );
}
