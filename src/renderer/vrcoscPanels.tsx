// UI panels for the VRCOSC-ported features (Phase 1 + 2 scaffolding).
//
// One file holds the panels (Weather, Voice Commands, Whisper STT, ChatBox
// Clips) so the diff against App.tsx stays minimal — App.tsx just imports
// and renders these by featureModule id.

import { useEffect, useRef, useState } from 'react';
import type { AppSettings } from '../shared/types';
import { WhisperCapture } from './whisperCapture';
import { TokenToggles } from './tokenToggles';

type Persist = (next: AppSettings) => void;

// ---------- Weather --------------------------------------------------------

export function WeatherPanel(props: {
  settings: AppSettings;
  onPersist: Persist;
  flash: (m: string) => void;
}) {
  const { settings, onPersist, flash } = props;
  const cfg = settings.weather ?? { enabled: false, query: '', unit: 'C' as const, auto: false };
  const [query, setQuery] = useState(cfg.query);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{
    city: string;
    tempC: number;
    tempF: number;
    desc: string;
    windKph: number;
    available: boolean;
  } | null>(null);

  const save = (next: Partial<NonNullable<AppSettings['weather']>>) =>
    onPersist({ ...settings, weather: { ...cfg, ...next } });

  // The weather chatbox line has TWO switches that BOTH must be on:
  //  1. settings.weather.enabled — the lookup / fetch.
  //  2. the `weather` chatbox module in settings.modules — whether the line
  //     is composed into the chatbox at all.
  // The old Modules/Build tab (which toggled #2) is gone, so this panel now
  // drives both from a single "Show in chatbox" toggle.
  const weatherModule = settings.modules.find((m) => m.id === 'weather');
  const moduleOn = !!weatherModule?.enabled;
  const showInChatbox = cfg.enabled && moduleOn;
  const setShow = (on: boolean) =>
    onPersist({
      ...settings,
      weather: { ...cfg, enabled: on },
      modules: settings.modules.map((m) => (m.id === 'weather' ? { ...m, enabled: on } : m)),
    });
  const setTemplate = (template: string) =>
    onPersist({
      ...settings,
      modules: settings.modules.map((m) => (m.id === 'weather' ? { ...m, template } : m)),
    });

  const previewNow = async () => {
    setBusy(true);
    try {
      const r = await window.chatbox.getWeather();
      setPreview(r);
      if (!r.available) flash('Weather unavailable — check your query.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="feat">
      <h3>
        🌤️ Weather <span className="muted small">(VRCOSC)</span>
      </h3>
      <p className="small muted">
        Drives the Weather chatbox module. Uses Open-Meteo — no API key required. Cached for 30
        minutes per query.
      </p>
      <label className="chk">
        <input
          type="checkbox"
          checked={showInChatbox}
          onChange={(e) => setShow(e.target.checked)}
        />
        Show weather in chatbox
      </label>
      <label className="chk">
        <input
          type="checkbox"
          checked={!!cfg.auto}
          onChange={(e) => save({ auto: e.target.checked })}
        />
        📍 Auto-detect my location (from IP — no typing needed)
      </label>
      <div className="row mt">
        <label className="grow">
          City / Postcode / Zip
          <input
            type="text"
            placeholder={cfg.auto ? 'Auto-detecting from your IP…' : 'e.g. Tokyo, 90210, London'}
            value={query}
            disabled={!!cfg.auto}
            onChange={(e) => setQuery(e.target.value)}
            onBlur={() => save({ query: query.trim() })}
          />
        </label>
        <label>
          Unit
          <select value={cfg.unit} onChange={(e) => save({ unit: e.target.value as 'C' | 'F' })}>
            <option value="C">°C</option>
            <option value="F">°F</option>
          </select>
        </label>
      </div>
      <div className="row mt">
        <button
          className="btn ghost"
          disabled={busy || !cfg.enabled || (!cfg.auto && !query.trim())}
          onClick={previewNow}
        >
          {busy ? 'Fetching…' : cfg.auto ? '📍 Detect + preview' : 'Preview now'}
        </button>
        {preview && preview.available && (
          <span className="small">
            {preview.city}: {cfg.unit === 'F' ? preview.tempF : preview.tempC}° {preview.desc} ·
            wind {preview.windKph} km/h
          </span>
        )}
      </div>
      <label className="grow mt">
        Chatbox line format
        <input
          type="text"
          value={weatherModule?.template ?? '🌤️ {city} {temp}° {desc}'}
          onChange={(e) => setTemplate(e.target.value)}
        />
      </label>
      <TokenToggles
        template={weatherModule?.template ?? '🌤️ {city} {temp}° {desc}'}
        tokens={['city', 'temp', 'tempC', 'tempF', 'desc', 'code', 'windKph']}
        onChange={setTemplate}
      />
      <p className="small muted mt">
        💡 Toggle tokens above; type emoji / text directly in the box. The
        weather line only appears while <b>Live Updates</b> are running.
      </p>
    </div>
  );
}

// ---------- Voice Commands ------------------------------------------------

export function VoiceCommandsPanel(props: { settings: AppSettings; onPersist: Persist }) {
  const { settings, onPersist } = props;
  const cfg = settings.voiceCommands ?? { enabled: false, wakeWord: 'uvy', commands: [] };
  const save = (next: Partial<NonNullable<AppSettings['voiceCommands']>>) =>
    onPersist({ ...settings, voiceCommands: { ...cfg, ...next } });

  const updateCmd = (id: string, patch: { match?: string }) =>
    save({ commands: cfg.commands.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  const removeCmd = (id: string) => save({ commands: cfg.commands.filter((c) => c.id !== id) });
  const addCmd = () =>
    save({
      commands: [
        ...cfg.commands,
        {
          id: 'vc_' + Math.random().toString(36).slice(2, 8),
          match: '',
          actions: [{ kind: 'sendText', text: 'hi' }],
        },
      ],
    });

  return (
    <div className="feat">
      <h3>
        🗣️ Voice Commands <span className="muted small">(VRCOSC)</span>
      </h3>
      <p className="small muted">
        When speech-to-text is running, phrases prefixed with the wake word are matched against the
        table below; the first match's actions fire.
      </p>
      <label className="chk">
        <input
          type="checkbox"
          checked={cfg.enabled}
          onChange={(e) => save({ enabled: e.target.checked })}
        />
        Enable voice commands
      </label>
      <label className="row mt">
        Wake word
        <input
          type="text"
          value={cfg.wakeWord}
          onChange={(e) => save({ wakeWord: e.target.value })}
          placeholder="uvy"
        />
      </label>
      <h4 className="mt">Command table</h4>
      <div className="vc-list">
        {cfg.commands.map((c) => (
          <div className="vc-row row" key={c.id}>
            <input
              className="grow"
              type="text"
              placeholder='Match (substring after wake word), e.g. "set status afk"'
              value={c.match}
              onChange={(e) => updateCmd(c.id, { match: e.target.value })}
            />
            <span className="small muted">
              {(c.actions as { kind: string }[]).map((a) => a.kind).join(', ') || '(no actions)'}
            </span>
            <button className="btn ghost tiny" onClick={() => removeCmd(c.id)}>
              ✕
            </button>
          </div>
        ))}
        {cfg.commands.length === 0 && (
          <em className="muted small">No commands yet. Add one below.</em>
        )}
      </div>
      <div className="row mt">
        <button className="btn ghost" onClick={addCmd}>
          + Add command
        </button>
      </div>
      <p className="small muted mt">
        💡 Edit complex action sequences in <code>settings.json</code> (the actions field accepts
        sendText, setStatus, clearChatbox, runMacro, etc.).
      </p>
    </div>
  );
}

// ---------- Whisper STT (Phase 2b) ----------------------------------------

type ModelChoice = 'tiny' | 'tiny.en' | 'base' | 'base.en' | 'small' | 'small.en' | 'custom';
const MODEL_LABELS: { id: ModelChoice; label: string; size: string }[] = [
  { id: 'tiny.en', label: 'tiny.en — English-only, fastest', size: '~75 MB' },
  { id: 'tiny', label: 'tiny — multilingual', size: '~75 MB' },
  { id: 'base.en', label: 'base.en — English-only', size: '~142 MB' },
  { id: 'base', label: 'base — multilingual', size: '~142 MB' },
  { id: 'small.en', label: 'small.en — English-only, best', size: '~466 MB' },
  { id: 'small', label: 'small — multilingual', size: '~466 MB' },
  { id: 'custom', label: 'Custom path…', size: '' },
];

export function WhisperPanel(props: {
  settings: AppSettings;
  onPersist: Persist;
  flash: (m: string) => void;
}) {
  const { settings, onPersist, flash } = props;
  const engine = settings.sttEngine ?? 'uwp';
  const cfg = settings.whisper ?? {
    binPath: '',
    modelPath: '',
    modelChoice: 'tiny.en' as ModelChoice,
    language: 'auto',
  };
  const [running, setRunning] = useState(false);
  const [dlState, setDlState] = useState<{ model: string; got: number; total: number } | null>(
    null,
  );
  const captureRef = useRef<WhisperCapture | null>(null);
  const [lastPhrase, setLastPhrase] = useState('');
  const [error, setError] = useState('');

  const saveEngine = (e: 'uwp' | 'whisper') => onPersist({ ...settings, sttEngine: e });
  const saveCfg = (patch: Partial<typeof cfg>) =>
    onPersist({ ...settings, whisper: { ...cfg, ...patch } });

  // Subscribe to download progress (multiplexed event).
  useEffect(() => {
    const off = window.chatbox.onWhisperDownload((ev) => {
      if (ev.event === 'start' || ev.event === 'progress') {
        setDlState({ model: ev.model ?? '', got: ev.got ?? 0, total: ev.total ?? 0 });
      } else if (ev.event === 'done') {
        setDlState(null);
        flash(`Model downloaded: ${ev.model}`);
      } else if (ev.event === 'error') {
        setDlState(null);
        setError(ev.message ?? 'Download failed');
      }
    });
    return off;
  }, [flash]);

  // Subscribe to STT events for live feedback while the Whisper engine runs.
  useEffect(() => {
    if (engine !== 'whisper') return;
    const off = window.chatbox.onSpeechEvent((e) => {
      const ev = e as { event?: string; text?: string; message?: string };
      if (ev.event === 'phrase' && ev.text) setLastPhrase(ev.text);
      if (ev.event === 'error') setError(ev.message ?? '');
      if (ev.event === 'stopped') setRunning(false);
    });
    return off;
  }, [engine]);

  const startWhisper = async () => {
    setError('');
    try {
      const cap = new WhisperCapture();
      await cap.start();
      captureRef.current = cap;
      await window.chatbox.startSpeechToText();
      setRunning(true);
    } catch (e) {
      setError((e as Error).message);
      captureRef.current?.stop();
      captureRef.current = null;
    }
  };
  const stopWhisper = async () => {
    captureRef.current?.stop();
    captureRef.current = null;
    await window.chatbox.stopSpeechToText();
    setRunning(false);
  };

  const downloadModel = async () => {
    setError('');
    const r = await window.chatbox.whisperDownload(cfg.modelChoice);
    if (!r.ok) setError(r.error ?? 'Download failed');
  };

  const dlPct =
    dlState && dlState.total > 0
      ? Math.min(100, Math.round((dlState.got / dlState.total) * 100))
      : 0;

  return (
    <div className="feat">
      <h3>
        🎙️ Whisper STT <span className="muted small">(VRCOSC port)</span>
      </h3>
      <p className="small muted">
        Offline speech-to-text using whisper.cpp. Replaces the legacy Windows UWP recognizer when
        selected. Requires a whisper.cpp binary and a GGML model file (downloadable below).
      </p>

      <h4 className="mt">Engine</h4>
      <div className="seg">
        <button
          className={`seg-btn ${engine === 'uwp' ? 'on' : ''}`}
          onClick={() => saveEngine('uwp')}
        >
          UWP (default)
        </button>
        <button
          className={`seg-btn ${engine === 'whisper' ? 'on' : ''}`}
          onClick={() => saveEngine('whisper')}
        >
          Whisper
        </button>
      </div>

      {engine === 'whisper' && (
        <>
          <h4 className="mt">whisper.cpp binary</h4>
          <p className="small muted">
            Drop <code>whisper-cli.exe</code> (or <code>main.exe</code>) into
            <code> %APPDATA%\Roaming\osc-chatbox\whisper\bin\ </code>or set an absolute path here.
            Download whisper.cpp from
            <code> github.com/ggerganov/whisper.cpp</code>.
          </p>
          <input
            type="text"
            className="grow"
            placeholder="Optional: absolute path to whisper-cli.exe"
            value={cfg.binPath}
            onChange={(e) => saveCfg({ binPath: e.target.value })}
          />

          <h4 className="mt">Model</h4>
          <select
            value={cfg.modelChoice}
            onChange={(e) => saveCfg({ modelChoice: e.target.value as ModelChoice })}
          >
            {MODEL_LABELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
                {m.size ? ` · ${m.size}` : ''}
              </option>
            ))}
          </select>
          {cfg.modelChoice === 'custom' ? (
            <input
              type="text"
              className="grow mt"
              placeholder="Absolute path to a ggml-*.bin file"
              value={cfg.modelPath}
              onChange={(e) => saveCfg({ modelPath: e.target.value })}
            />
          ) : (
            <div className="row mt">
              <button className="btn ghost" onClick={downloadModel} disabled={dlState !== null}>
                {dlState ? `Downloading ${dlState.model}… ${dlPct}%` : '⬇ Download selected model'}
              </button>
            </div>
          )}
          {dlState && dlState.total > 0 && (
            <div className="dl-bar">
              <div className="dl-fill" style={{ width: `${dlPct}%` }} />
            </div>
          )}

          <h4 className="mt">Language</h4>
          <select value={cfg.language} onChange={(e) => saveCfg({ language: e.target.value })}>
            <option value="auto">Auto-detect</option>
            <option value="en">English</option>
            <option value="ja">Japanese</option>
            <option value="es">Spanish</option>
            <option value="fr">French</option>
            <option value="de">German</option>
            <option value="ar">Arabic</option>
            <option value="ko">Korean</option>
            <option value="zh">Chinese</option>
            <option value="pt">Portuguese</option>
            <option value="ru">Russian</option>
          </select>

          <h4 className="mt">Control</h4>
          <div className="row">
            <button className="btn" onClick={running ? stopWhisper : startWhisper}>
              {running ? '■ Stop' : '🎙️ Start Whisper'}
            </button>
            {running && <span className="small muted">Capturing mic at 16 kHz mono…</span>}
          </div>
          <div className="row mt">
            <span className="small muted">Last phrase:</span>
            <span className="stt-heard">
              {lastPhrase ? `"${lastPhrase}"` : <em className="muted">(none yet)</em>}
            </span>
          </div>
          {error && (
            <p className="small" style={{ color: 'var(--danger)' }}>
              {error}
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ---------- ChatBox Clip system (Phase 2) ---------------------------------

export function ClipsPanel(props: { settings: AppSettings; onPersist: Persist }) {
  const { settings, onPersist } = props;
  const cfg = settings.chatboxClips ?? { enabled: false, tickSec: 4, clips: [] };
  const save = (next: Partial<NonNullable<AppSettings['chatboxClips']>>) =>
    onPersist({ ...settings, chatboxClips: { ...cfg, ...next } });

  const addClip = () =>
    save({
      clips: [
        ...cfg.clips,
        {
          id: 'cl_' + Math.random().toString(36).slice(2, 8),
          label: `Clip ${cfg.clips.length + 1}`,
          text: '',
          priority: 0,
          enabled: true,
          condition: '',
        },
      ],
    });
  const update = (
    id: string,
    patch: Partial<NonNullable<AppSettings['chatboxClips']>['clips'][number]>,
  ) => save({ clips: cfg.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  const remove = (id: string) => save({ clips: cfg.clips.filter((c) => c.id !== id) });

  return (
    <div className="feat">
      <h3>
        🎬 ChatBox Clips <span className="muted small">(VRCOSC clip system)</span>
      </h3>
      <p className="small muted">
        Each clip is a chatbox line with a priority and an optional condition. Every tick, the
        highest-priority enabled clip whose condition evaluates true is sent to the chatbox.
        Conditions reuse the existing template DSL (e.g. <code>{`musicPlaying`}</code>,{' '}
        <code>{`afk`}</code>,<code>{`cpuLoad > 80`}</code>) and clip text can use any template token
        (e.g. <code>{`{title}`}</code>, <code>{`{tempC}`}</code>).
      </p>
      <label className="chk">
        <input
          type="checkbox"
          checked={cfg.enabled}
          onChange={(e) => save({ enabled: e.target.checked })}
        />
        Enable clip-driven chatbox
      </label>
      <label className="row mt">
        Tick interval (sec)
        <input
          type="number"
          min={1}
          max={60}
          value={cfg.tickSec}
          onChange={(e) => save({ tickSec: Math.max(1, Number(e.target.value) || 4) })}
        />
      </label>
      <h4 className="mt">Clips</h4>
      {cfg.clips.length === 0 && <em className="muted small">No clips yet.</em>}
      <div className="clip-list">
        {cfg.clips.map((c) => (
          <div className="clip-row" key={c.id}>
            <div className="row">
              <input
                className="grow"
                placeholder="Label"
                value={c.label}
                onChange={(e) => update(c.id, { label: e.target.value })}
              />
              <label className="row tiny">
                Priority
                <input
                  type="number"
                  value={c.priority}
                  onChange={(e) => update(c.id, { priority: Number(e.target.value) || 0 })}
                />
              </label>
              <label className="chk small">
                <input
                  type="checkbox"
                  checked={c.enabled}
                  onChange={(e) => update(c.id, { enabled: e.target.checked })}
                />
                On
              </label>
              <button className="btn ghost tiny" onClick={() => remove(c.id)}>
                ✕
              </button>
            </div>
            <input
              className="mt grow"
              placeholder='Text (template tokens allowed, e.g. "🎵 {title} — {artist}")'
              value={c.text}
              onChange={(e) => update(c.id, { text: e.target.value })}
            />
            <input
              className="mt grow"
              placeholder='Condition (optional, e.g. "musicPlaying" or "cpuLoad > 80")'
              value={c.condition ?? ''}
              onChange={(e) => update(c.id, { condition: e.target.value })}
            />
          </div>
        ))}
      </div>
      <div className="row mt">
        <button className="btn ghost" onClick={addClip}>
          + Add clip
        </button>
      </div>
    </div>
  );
}
