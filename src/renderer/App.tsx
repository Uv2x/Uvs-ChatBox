import { useEffect, useState, useCallback, useRef } from 'react';
import type {
  AppSettings,
  ModuleId,
  SendTarget,
  AudioStatus,
  AfkState,
  InstanceEvent,
  OscTelemetry,
} from '../shared/types';
import type { LiveUpdatePayload } from './global';
import { OscManagerMax } from './constants';
import { LobbyHud, TelemetryPanel, AudioIndicator, StatusStrip } from './widgets';
import { useAppearance, useUiModes, ThemePicker, BackgroundPicker } from './appearance';
import { ControlPanel } from './control';
import { SettingsPanel } from './settings';
import { PersonaPanel } from './personaPanel';
import { AfkPanel } from './afkPanel';
import { SpotifyPanel } from './spotifyPanel';
import { OnboardingTour } from './onboarding';
import { ThemeEditor } from './themeEditor';
import logoUrl from './assets/logo.png';
import { EmojiPicker } from './emojiPicker';
import { orderedFeatures as computeOrderedFeatures } from './featureList';
import { TokenToggles, tokensFromHint } from './tokenToggles';
import { WeatherPanel, VoiceCommandsPanel, ClipsPanel, WhisperPanel } from './vrcoscPanels';
import { StatusTab } from './statusTab';
import { HealthPanel } from './healthPanel';
import { UpdateBanner } from './updateBanner';
import { BatteryPanel, VrNotifyPanel, VrOverlayPanel, DiscordPanel } from './vrcoscPanels2';

/** Sub-modules inside the Features tab. Adding a new feature later means
 *  one row here + one gated section in the JSX below. The icons match each
 *  feature's section heading so the rail and the content read consistently. */
// FEATURE_MODULES + orderedFeatures now live in ./featureList (imported at
// the top) so App and Settings share one source of truth for the feature list.

/** Maps a feature-rail id to its corresponding chatbox-module id in
 *  settings.modules. Only feature rows that actually drive a chatbox line
 *  appear here; pure-UI features (STT, Persona, Relay) are absent — they
 *  don't have a module toggle. */
const FEATURE_TO_MODULE: Record<string, ModuleId> = {
  audio: 'audiostatus',
  afk: 'afk',
  media: 'media',
  clock: 'clock',
  timezones: 'timezone',
  custom: 'custom',
  pc: 'pcComponents',
  network: 'network',
  weather: 'weather',
  session: 'session',
};

// MODULE_LABELS was used by the now-removed standalone Modules tab. The
// per-feature panels use their own h3 headings, so the lookup is gone.

const MODULE_HINTS: Record<ModuleId, string> = {
  custom: '{custom}',
  media: '{title} {artist} {album} {status} {bar} {time} {elapsed} {total}',
  clock: '{time}',
  pcComponents:
    '{cpuName} {cpuLoad} {cpuTemp} {gpuName} {gpuLoad} {gpuTemp} {ramUsed} {ramTotal} {vramTotal}',
  network: '{netDown} {netUp}',
  audiostatus: '{status}',
  afk: '{status} {idle}',
  timezone: '{label} {time} {icon}',
  vrchat: '{world} {instanceType} {playerCount} {lastJoin} {lastLeave} {avatar}',
  // VRCOSC-ported modules.
  weather: '{city} {temp} {tempC} {tempF} {desc} {code} {windKph}',
  battery: '{devices} {percent} {charging} {status}',
  session: '{session}',
};

/** Curated list of the most-used IANA timezone identifiers, grouped roughly
 *  by region. Covers nearly every VRChat user's home zone without exposing
 *  the full 500+ tz database list — a usability tradeoff. The user can
 *  still type a custom IANA name into the freeform input if their zone
 *  isn't here. */
const COMMON_TIMEZONES: ReadonlyArray<{ group: string; zones: { zone: string; label: string }[] }> =
  [
    {
      group: 'Americas',
      zones: [
        { zone: 'America/Los_Angeles', label: 'US Pacific (LA)' },
        { zone: 'America/Denver', label: 'US Mountain (Denver)' },
        { zone: 'America/Phoenix', label: 'US Arizona (no DST)' },
        { zone: 'America/Chicago', label: 'US Central (Chicago)' },
        { zone: 'America/New_York', label: 'US Eastern (NY)' },
        { zone: 'America/Toronto', label: 'Canada Eastern (Toronto)' },
        { zone: 'America/Vancouver', label: 'Canada Pacific (Vancouver)' },
        { zone: 'America/Mexico_City', label: 'Mexico City' },
        { zone: 'America/Bogota', label: 'Bogotá / Lima' },
        { zone: 'America/Sao_Paulo', label: 'São Paulo (BRT)' },
        { zone: 'America/Argentina/Buenos_Aires', label: 'Buenos Aires' },
        { zone: 'America/Anchorage', label: 'Alaska' },
        { zone: 'Pacific/Honolulu', label: 'Hawaii' },
      ],
    },
    {
      group: 'Europe / Africa',
      zones: [
        { zone: 'Europe/London', label: 'UK (London)' },
        { zone: 'Europe/Dublin', label: 'Ireland (Dublin)' },
        { zone: 'Europe/Lisbon', label: 'Portugal (Lisbon)' },
        { zone: 'Europe/Paris', label: 'France (Paris)' },
        { zone: 'Europe/Berlin', label: 'Germany (Berlin)' },
        { zone: 'Europe/Amsterdam', label: 'Netherlands (Amsterdam)' },
        { zone: 'Europe/Madrid', label: 'Spain (Madrid)' },
        { zone: 'Europe/Rome', label: 'Italy (Rome)' },
        { zone: 'Europe/Warsaw', label: 'Poland (Warsaw)' },
        { zone: 'Europe/Stockholm', label: 'Sweden (Stockholm)' },
        { zone: 'Europe/Helsinki', label: 'Finland (Helsinki)' },
        { zone: 'Europe/Athens', label: 'Greece (Athens)' },
        { zone: 'Europe/Istanbul', label: 'Turkey (Istanbul)' },
        { zone: 'Europe/Moscow', label: 'Russia (Moscow)' },
        { zone: 'Africa/Lagos', label: 'Nigeria (Lagos)' },
        { zone: 'Africa/Johannesburg', label: 'South Africa (JNB)' },
        { zone: 'Africa/Cairo', label: 'Egypt (Cairo)' },
      ],
    },
    {
      group: 'Asia / Middle East',
      zones: [
        { zone: 'Asia/Dubai', label: 'UAE (Dubai)' },
        { zone: 'Asia/Riyadh', label: 'Saudi Arabia (Riyadh)' },
        { zone: 'Asia/Tehran', label: 'Iran (Tehran)' },
        { zone: 'Asia/Jerusalem', label: 'Israel (Jerusalem)' },
        { zone: 'Asia/Karachi', label: 'Pakistan (Karachi)' },
        { zone: 'Asia/Kolkata', label: 'India (IST)' },
        { zone: 'Asia/Bangkok', label: 'Thailand (Bangkok)' },
        { zone: 'Asia/Jakarta', label: 'Indonesia (Jakarta)' },
        { zone: 'Asia/Singapore', label: 'Singapore' },
        { zone: 'Asia/Manila', label: 'Philippines (Manila)' },
        { zone: 'Asia/Hong_Kong', label: 'Hong Kong' },
        { zone: 'Asia/Shanghai', label: 'China (Shanghai)' },
        { zone: 'Asia/Taipei', label: 'Taiwan (Taipei)' },
        { zone: 'Asia/Seoul', label: 'South Korea (Seoul)' },
        { zone: 'Asia/Tokyo', label: 'Japan (Tokyo)' },
      ],
    },
    {
      group: 'Oceania',
      zones: [
        { zone: 'Australia/Perth', label: 'Australia Perth (AWST)' },
        { zone: 'Australia/Adelaide', label: 'Australia Adelaide (ACST)' },
        { zone: 'Australia/Sydney', label: 'Australia Sydney (AEST)' },
        { zone: 'Pacific/Auckland', label: 'New Zealand (Auckland)' },
        { zone: 'Pacific/Fiji', label: 'Fiji' },
      ],
    },
    {
      group: 'Universal',
      zones: [
        { zone: 'UTC', label: 'UTC' },
        { zone: 'GMT', label: 'GMT' },
      ],
    },
  ];

/** True when the OSC target IP is a remote host (a standalone Quest on the
 *  LAN) rather than this PC. Mirrors isRemoteHost() in main. */
function isRemoteHostRenderer(ip: string): boolean {
  const h = (ip || '').trim().toLowerCase();
  return !(h === '' || h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '0.0.0.0');
}

/** Pings the OSC target IP to isolate a network problem from an OSC problem.
 *  Reachable → the LAN path is open (so the issue is OSC/firewall in VRChat).
 *  Unreachable → same-Wi-Fi / router-isolation / wrong-IP problem. */
function ReachabilityTest(props: { ip: string }) {
  const [state, setState] = useState<
    | { phase: 'idle' }
    | { phase: 'testing' }
    | { phase: 'done'; reachable: boolean; ms: number | null; error?: string }
  >({ phase: 'idle' });

  const run = async () => {
    setState({ phase: 'testing' });
    const r = await window.chatbox.pingHost(props.ip);
    setState({ phase: 'done', reachable: r.reachable, ms: r.ms, error: r.error });
  };

  const isLocal = !isRemoteHostRenderer(props.ip);

  return (
    <div className="reach-test">
      <button className="btn ghost" onClick={run} disabled={state.phase === 'testing'}>
        {state.phase === 'testing' ? 'Pinging…' : '📡 Test reachability'}
      </button>
      {state.phase === 'done' &&
        (state.error ? (
          <span className="reach-result bad">✗ {state.error}</span>
        ) : state.reachable ? (
          <span className="reach-result ok">
            ✓ Reachable{state.ms != null ? ` (${state.ms} ms)` : ''} — the network path is open.
            {!isLocal &&
              ' If the chatbox still doesn’t update, OSC isn’t enabled in VRChat on the headset.'}
          </span>
        ) : (
          <span className="reach-result bad">
            ✗ Not reachable — the PC can&apos;t see <code>{props.ip}</code>. Same Wi-Fi? Router
            AP/client isolation off? Correct Quest IP?
          </span>
        ))}
    </div>
  );
}

export function App() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [manualText, setManualText] = useState('');
  const [live, setLive] = useState(false);
  const [preview, setPreview] = useState('');
  const [status, setStatus] = useState('Ready');
  const [audio, setAudio] = useState<AudioStatus | null>(null);
  const [afk, setAfk] = useState<AfkState | null>(null);
  const [instance, setInstance] = useState<InstanceEvent | null>(null);
  const [telemetry, setTelemetry] = useState<OscTelemetry | null>(null);
  const [tab, setTab] = useState<
    'control' | 'status' | 'features' | 'connection' | 'health' | 'theme' | 'settings'
  >('control');
  /** Which feature module is showing inside the Features tab's sub-nav.
   *  Each module is one of the items in FEATURE_MODULES below. */
  const [featureModule, setFeatureModule] = useState<string>('audio');
  /** Whether the Features sub-nav is expanded in the sidebar. Independent
   *  of `tab` so the user can collapse the list while still viewing a
   *  feature's content on the right. */
  const [featuresOpen, setFeaturesOpen] = useState(false);

  /** Feature list in the user's chosen order (settings.featureOrder). */
  const orderedFeatures = computeOrderedFeatures(settings?.featureOrder);
  const typingTimer = useRef<number | null>(null);
  const flashTimer = useRef<number | null>(null);
  /** Whether the onboarding tour is currently visible. Shown automatically
   *  on first launch (when settings.featureToggles.onboarded is falsy) and
   *  re-openable via a button in Settings. */
  const [onboardingOpen, setOnboardingOpen] = useState(false);

  /** Dictation UI state: 'idle' | 'starting' | 'listening' | 'error'.
   *  'starting' covers the window between clicking the mic and the recognizer
   *  emitting 'ready' (CompileConstraintsAsync takes ~1s on first run). */
  const [sttState, setSttState] = useState<'idle' | 'starting' | 'listening' | 'error'>('idle');
  const [sttError, setSttError] = useState<string>('');
  /** When true, the error bar offers a one-click "Open Windows Speech
   *  Settings" button (covers the UWP privacy-policy-not-accepted case). */
  const [sttNeedsPrivacy, setSttNeedsPrivacy] = useState(false);
  // Most recent recognized phrase, surfaced in the STT panel so the user
  // can SEE what the mic heard even when they're on a different tab. Set
  // by the onSpeechEvent handler below.
  const [lastDictated, setLastDictated] = useState<string>('');
  /** Last text we sent via the Send button. Persists for 7s so the user can
   *  see what just went out even after the textarea is cleared. */
  const [lastSent, setLastSent] = useState<string>('');
  const lastSentTimer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.chatbox.getSettings().then((s) => {
      if (cancelled) return;
      setSettings(s);
      // Show the onboarding tour the very first time the app boots — we
      // detect this via the `onboarded` flag in featureToggles. Once the
      // user dismisses it (Got it / Skip / Esc), the flag flips true and
      // we won't pop up again unless they reopen it from Settings.
      if (!s.featureToggles?.onboarded) setOnboardingOpen(true);
    });
    const off = window.chatbox.onLiveUpdate((p: LiveUpdatePayload) => {
      if (p.preview) setPreview(p.preview);
      if (p.audio) setAudio(p.audio);
      if (p.afk) setAfk(p.afk);
      if (p.instance) setInstance(p.instance);
      if (p.telemetry) setTelemetry(p.telemetry);
    });
    return () => {
      cancelled = true;
      off();
      if (typingTimer.current !== null) window.clearTimeout(typingTimer.current);
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
      if (lastSentTimer.current !== null) window.clearTimeout(lastSentTimer.current);
    };
  }, []);

  const persist = useCallback(async (next: AppSettings) => {
    setSettings(next);
    await window.chatbox.saveSettings(next);
  }, []);

  /** Explicit "Save settings" action. Settings already auto-save on every
   *  change, but the button gives an obvious confirmation + a way to force
   *  a write (e.g. after editing a textarea that only commits on blur). */
  const [saving, setSaving] = useState(false);
  const saveNow = useCallback(async () => {
    if (!settings) return;
    setSaving(true);
    try {
      await window.chatbox.saveSettings(settings);
      setStatus('✓ Settings saved');
    } finally {
      setSaving(false);
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
      flashTimer.current = window.setTimeout(() => setStatus('Ready'), 2500);
    }
  }, [settings]);

  // Stable identity so child components that depend on `flash` (e.g.
  // ControlPanel's effect) don't re-subscribe on every parent render.
  const flash = useCallback((msg: string) => {
    setStatus(msg);
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => {
      setStatus('Ready');
      flashTimer.current = null;
    }, 2500);
  }, []);

  // Speech-to-text event subscription. Each recognized phrase is appended to
  // the manual textarea. If the user has enabled the `autoSendDictation`
  // feature toggle, the phrase is sent immediately instead of pooling in the
  // textarea — useful in VR when you can't review the desktop UI.
  // Declared AFTER flash so the closure captures a defined `flash` ref.
  useEffect(() => {
    // UWP SpeechRecognitionResultStatus enum -> human-readable. Lets us
    // surface "your mic didn't catch anything" cases instead of silently
    // dropping non-success phrases.
    const statusMessages: Record<number, string> = {
      1: 'Language not supported',
      2: 'Grammar language mismatch',
      3: 'Grammar compilation failure',
      4: 'Audio quality too low',
      5: 'Cancelled',
      6: 'Unknown error',
      7: 'No speech detected (timed out)',
      8: 'Pause limit exceeded',
      9: 'Network failure',
      10: 'Microphone unavailable',
    };
    let consecutiveTimeouts = 0;

    const off = window.chatbox.onSpeechEvent((e) => {
      switch (e.event) {
        case 'ready':
          setSttState('listening');
          setSttError('');
          setSttNeedsPrivacy(false);
          consecutiveTimeouts = 0;
          break;
        case 'needs-privacy-accept':
          // The "speech privacy policy not accepted" case. Flip the button
          // back to idle and tell the user exactly how to fix it.
          setSttState('error');
          setSttNeedsPrivacy(true);
          setSttError(
            'Windows needs you to accept the speech privacy policy once before dictation works.',
          );
          break;
        case 'phrase': {
          // Always log so we can see what the recognizer returned.
          console.info('[stt] phrase', {
            status: e.status,
            text: e.text,
            confidence: e.confidence,
          });

          if (e.status === 0 && e.text.trim()) {
            consecutiveTimeouts = 0;
            const text = e.text.trim();
            setSttError('');
            setLastDictated(text);

            if (settings?.featureToggles?.autoSendDictation) {
              void window.chatbox.sendMessage(text);
              flash(`🎙️ sent "${text}"`);
            } else {
              setManualText((prev) => (prev ? `${prev} ${text}` : text));
              flash(`🎙️ heard: "${text}" — added to message`);
            }
          } else {
            // Status != 0 means recognition ran but didn't produce text.
            // After two in a row, surface a hint so the user knows the
            // mic isn't getting through even though the button is "live".
            const hint = statusMessages[e.status] ?? `Status ${e.status}`;
            console.warn(`[stt] non-success phrase: ${hint}`);
            if (e.status === 7) {
              consecutiveTimeouts++;
              if (consecutiveTimeouts >= 2) {
                setSttError(
                  "Microphone isn't picking up speech. Check the Windows input device and try again.",
                );
              }
            } else {
              consecutiveTimeouts = 0;
              setSttError(hint);
            }
          }
          break;
        }
        case 'error':
          console.warn('[stt] error:', e.message);
          setSttError(e.message);
          break;
        case 'fatal':
          setSttState('error');
          setSttError(e.message);
          break;
        case 'stopped':
          setSttState('idle');
          break;
      }
    });
    return off;
    // Dependencies: re-subscribe when the autoSendDictation toggle flips so
    // the latest value is captured. `flash` is stable via useCallback([]).
  }, [settings?.featureToggles?.autoSendDictation, flash]);

  const toggleDictation = useCallback(async () => {
    if (sttState === 'idle' || sttState === 'error') {
      setSttState('starting');
      setSttError('');
      await window.chatbox.startSpeechToText();
    } else {
      await window.chatbox.stopSpeechToText();
      setSttState('idle');
    }
  }, [sttState]);

  // Apply theme + background whenever appearance changes (hook must be
  // unconditional; falls back to defaults until settings load).
  useAppearance(
    settings?.appearance ?? {
      theme: 'midnight',
      backgroundData: '',
      backgroundOpacity: 0.35,
      backgroundBlur: 3,
    },
  );
  useUiModes(
    settings?.ui ?? {
      launchMode: 'desktop',
      compact: false,
      streamer: false,
      oled: false,
      acrylic: false,
      minimalUi: false,
      closeToTray: true,
    },
  );

  if (!settings) return <div className="boot">Initializing OSC core…</div>;

  const updateOsc = (patch: Partial<AppSettings['osc']>) =>
    persist({ ...settings, osc: { ...settings.osc, ...patch } });

  const updateAppearance = (patch: Partial<AppSettings['appearance']>) =>
    persist({ ...settings, appearance: { ...settings.appearance, ...patch } });

  const toggleModule = (id: ModuleId) =>
    persist({
      ...settings,
      modules: settings.modules.map((m) => (m.id === id ? { ...m, enabled: !m.enabled } : m)),
    });

  const updateTemplate = (id: ModuleId, template: string) =>
    persist({
      ...settings,
      modules: settings.modules.map((m) => (m.id === id ? { ...m, template } : m)),
    });

  const moveModule = (id: ModuleId, dir: -1 | 1) => {
    const sorted = [...settings.modules].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((m) => m.id === id);
    const swap = idx + dir;
    if (swap < 0 || swap >= sorted.length) return;
    const a = sorted[idx];
    const b = sorted[swap];
    if (!a || !b) return;
    const tmp = a.order;
    a.order = b.order;
    b.order = tmp;
    persist({ ...settings, modules: sorted });
  };

  const sendManual = async () => {
    const text = manualText.trim();
    if (!text) return;
    // Auto-translate: pre-translate the text before sending if enabled.
    let finalText = text;
    if (settings?.translate?.enabled) {
      try {
        const r = await window.chatbox.translateText(text, settings.translate.targetLang);
        if (r.ok && r.data) {
          const translated = r.data.trim();
          // Skip the bilingual append when the translation is the same as
          // (or just casing-different from) the original — otherwise a
          // single letter / English word in English-target mode produces
          // "H\nH" which reads as "H H" in the chatbox.
          const sameAsOriginal =
            translated.toLowerCase() === text.toLowerCase() || translated === text;
          if (settings.translate.mode === 'bilingual' && !sameAsOriginal) {
            finalText = `${text}\n${translated}`;
          } else {
            finalText = translated;
          }
        }
      } catch {
        /* fall through with original */
      }
    }
    await window.chatbox.sendMessage(finalText);
    flash('Message sent');
    // Move the sent text into the "Just sent" panel so the user can see
    // what just went out, even after the textarea is cleared for the next
    // message. Auto-clears after 7s.
    setLastSent(text);
    setManualText('');
    if (lastSentTimer.current !== null) window.clearTimeout(lastSentTimer.current);
    lastSentTimer.current = window.setTimeout(() => {
      setLastSent('');
      lastSentTimer.current = null;
    }, 7000);
  };

  /** "Clear" should mean both: blank the in-game chatbox AND wipe the local
   *  textarea so the user can start fresh. Previously only the game
   *  chatbox was cleared, which made the button look broken in the UI. */
  const clearAll = () => {
    setManualText('');
    void window.chatbox.clearChatbox();
    flash('Cleared');
  };

  const onManualChange = (val: string) => {
    setManualText(val);
    window.chatbox.setTyping(true);
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => window.chatbox.setTyping(false), 1200);
  };

  /** Persist the current composer text to settings.savedMessages so it
   *  survives a restart. De-duplicates by text and caps the list at 50. */
  const saveManualMessage = () => {
    if (!settings) return;
    const text = manualText.trim();
    if (!text) {
      flash('Nothing to save — type a message first');
      return;
    }
    const existing = settings.savedMessages ?? [];
    if (existing.some((m) => m.text === text)) {
      flash('Already saved');
      return;
    }
    const next = [{ id: 'sm_' + Math.random().toString(36).slice(2, 8), text }, ...existing].slice(
      0,
      50,
    );
    void persist({ ...settings, savedMessages: next });
    flash('💾 Saved message');
  };

  const toggleLive = async () => {
    if (live) {
      await window.chatbox.stopLive();
      setLive(false);
      flash('Live updates stopped');
    } else {
      await window.chatbox.startLive();
      setLive(true);
      flash('Live updates running');
    }
  };

  const charCount = Array.from(manualText).length;

  /** Render the chatbox-module bar at the top of a feature panel. Combines
   *  the on/off switch, reorder arrows, and template editor that used to
   *  live on the dedicated Modules tab. Returns null for features that
   *  don't correspond to a chatbox module (Persona, Relay, etc.). */
  const renderModuleHeader = (featureId: string) => {
    const moduleId = FEATURE_TO_MODULE[featureId];
    if (!moduleId) return null;
    const m = settings.modules.find((x) => x.id === moduleId);
    if (!m) return null;
    return (
      <div className={`module-inline ${m.enabled ? 'on' : ''}`}>
        <label className="switch">
          <input type="checkbox" checked={m.enabled} onChange={() => toggleModule(m.id)} />
          <span className="slider" />
        </label>
        <span className="module-inline-label">{m.enabled ? 'Enabled in chatbox' : 'Disabled'}</span>
        <div className="order-btns">
          <button onClick={() => moveModule(m.id, -1)} title="Move up in chatbox order">
            ▲
          </button>
          <button onClick={() => moveModule(m.id, 1)} title="Move down in chatbox order">
            ▼
          </button>
        </div>
        {m.enabled && (
          <>
            <input
              className="mini-input mono module-inline-template"
              value={m.template || ''}
              onChange={(e) => updateTemplate(m.id, e.target.value)}
              placeholder="template — add emoji / text; toggle tokens below"
            />
            <TokenToggles
              template={m.template || ''}
              tokens={tokensFromHint(MODULE_HINTS[m.id])}
              onChange={(t) => updateTemplate(m.id, t)}
            />
          </>
        )}
      </div>
    );
  };

  return (
    <div className="app shell">
      {/* Persistent left sidebar: brand on top, nav in the middle, utility
          actions pinned to the bottom. Pure re-organization of the former
          top-tab row — every tab is still here, nothing removed. */}
      <aside className="sidebar">
        <div className="sb-brand">
          <img className="logo-img" src={logoUrl} alt="Uv's Chat Box" />
          <div>
            <h1>Uv's Chat Box</h1>
            <p className="sub">VRChat OSC</p>
          </div>
        </div>
        <nav className="sb-nav">
          <button
            className={`sb-item ${tab === 'control' ? 'on' : ''}`}
            onClick={() => setTab('control')}
          >
            <span className="sb-icon">🎛️</span>
            <span className="sb-label">Control</span>
          </button>
          <button
            className={`sb-item ${tab === 'status' ? 'on' : ''}`}
            onClick={() => setTab('status')}
          >
            <span className="sb-icon">📌</span>
            <span className="sb-label">Status</span>
          </button>
          {!settings.simpleMode && (
            <>
              <button
                className={`sb-item ${tab === 'features' ? 'on' : ''}`}
                onClick={() => setFeaturesOpen((o) => !o)}
                title="Show / hide the feature list"
              >
                <span className="sb-icon">✨</span>
                <span className="sb-label">Features</span>
                <span className="sb-caret">{featuresOpen ? '▾' : '▸'}</span>
              </button>
              {/* Feature sub-nav: slides open under the Features item.
                  Picking one shows its panel on the right; the parent
                  button toggles this list open/closed. */}
              {featuresOpen && (
                <div className="sb-sub">
                  {orderedFeatures.map((m) => (
                    <button
                      key={m.id}
                      className={`sb-sub-item ${tab === 'features' && featureModule === m.id ? 'on' : ''}`}
                      onClick={() => {
                        setFeatureModule(m.id);
                        setTab('features');
                      }}
                    >
                      <span className="sb-icon">{m.icon}</span>
                      <span className="sb-label">{m.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          <button
            className={`sb-item ${tab === 'connection' ? 'on' : ''}`}
            onClick={() => setTab('connection')}
          >
            <span className="sb-icon">🔌</span>
            <span className="sb-label">Connection</span>
          </button>
          <button
            className={`sb-item ${tab === 'health' ? 'on' : ''}`}
            onClick={() => setTab('health')}
          >
            <span className="sb-icon">🩺</span>
            <span className="sb-label">System Check</span>
          </button>
          {!settings.simpleMode && (
            <button
              className={`sb-item ${tab === 'theme' ? 'on' : ''}`}
              onClick={() => setTab('theme')}
            >
              <span className="sb-icon">🎨</span>
              <span className="sb-label">Theme</span>
            </button>
          )}
        </nav>
        <div className="sb-bottom">
          <button
            className={`sb-item ${tab === 'settings' ? 'on' : ''}`}
            onClick={() => setTab('settings')}
          >
            <span className="sb-icon">⚙️</span>
            <span className="sb-label">Settings</span>
          </button>
          <button
            className="sb-item"
            onClick={saveNow}
            disabled={saving}
            title="Save all settings now"
          >
            <span className="sb-icon">💾</span>
            <span className="sb-label">{saving ? 'Saving…' : 'Save'}</span>
          </button>
        </div>
      </aside>

      <div className="main-col">
        <header className="topbar">
          <h2 className="page-title">
            {tab === 'control'
              ? 'Control'
              : tab === 'status'
                ? 'Status'
                : tab === 'features'
                  ? 'Features'
                  : tab === 'connection'
                    ? 'Connection'
                    : tab === 'health'
                      ? 'System Check'
                      : tab === 'theme'
                        ? 'Theme'
                        : tab === 'settings'
                          ? 'Settings'
                          : ''}
          </h2>
          <div className="top-right">
            {settings.externalChatbox && (
              <div
                className="ext-badge"
                title="External chatbox mode is ON — this app is NOT sending /chatbox/input. Magic Chatbox or another OSC tool owns the chatbox."
              >
                🔇 EXT CHATBOX
              </div>
            )}
            <AudioIndicator a={audio} />
            <div className={`live-badge ${live ? 'on' : ''}`}>
              <span className="dot" />
              {live ? 'LIVE' : 'IDLE'}
            </div>
          </div>
        </header>

        <UpdateBanner />

        {/* Lobby Avatar HUD */}
        <LobbyHud
          live={live}
          ip={settings.osc.ip}
          port={settings.osc.port}
          target={settings.osc.target}
        />

        <StatusStrip afk={afk} instance={instance} />

        <main className={`grid ${tab === 'control' ? '' : 'single'}`}>
          {/* LEFT: manual + preview + telemetry — ONLY on the Control tab. */}
          {tab === 'control' && (
            <section className="panel">
              <h2 className="panel-title">Manual Message</h2>
              <textarea
                className="msg-input"
                value={manualText}
                maxLength={OscManagerMax}
                placeholder="Type a message to send to your VRChat chatbox…"
                onChange={(e) => onManualChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendManual();
                  }
                }}
              />
              <div className="row between">
                <span className={`counter ${charCount > 144 ? 'over' : ''}`}>
                  {charCount}/{OscManagerMax}
                </span>
                <div className="btn-row">
                  <EmojiPicker onPick={(s) => onManualChange(manualText + s)} />
                  <button
                    className={`btn mic ${sttState === 'listening' ? 'on' : ''} ${sttState === 'starting' ? 'pending' : ''} ${sttState === 'error' ? 'err' : ''}`}
                    onClick={toggleDictation}
                    title={
                      sttState === 'listening'
                        ? 'Stop dictation'
                        : sttState === 'starting'
                          ? 'Starting microphone…'
                          : sttState === 'error'
                            ? `STT error: ${sttError}`
                            : 'Start dictation (Windows speech recognition)'
                    }
                  >
                    {sttState === 'listening' ? '● REC' : sttState === 'starting' ? '…' : '🎙️'}
                  </button>
                  <button
                    className="btn ghost"
                    onClick={saveManualMessage}
                    title="Save this message for reuse (persists across restarts)"
                  >
                    ★ Save
                  </button>
                  <button className="btn ghost" onClick={clearAll}>
                    Clear
                  </button>
                  <button className="btn primary" onClick={sendManual}>
                    Send ⏎
                  </button>
                </div>
              </div>
              {sttError && (
                <p
                  className="small"
                  style={{
                    color: sttState === 'error' ? '#ff8b8b' : '#ffc266',
                    marginTop: 4,
                  }}
                >
                  🎙️ {sttError}
                  {sttNeedsPrivacy && (
                    <>
                      {' '}
                      <button
                        className="btn ghost tiny"
                        style={{ marginLeft: 6 }}
                        onClick={() => void window.chatbox.openWindowsSetting('privacy-speech')}
                      >
                        Open Windows Speech Settings
                      </button>
                    </>
                  )}
                </p>
              )}

              {/* "Just sent" panel — persists ~7s after a Send so the user can
              confirm what went out, then clears itself. Distinct from the
              live chatbox preview below (which only updates while live mode
              is broadcasting). */}
              {lastSent && (
                <div className="just-sent">
                  <span className="js-label">✓ JUST SENT</span>
                  <span className="js-text">{lastSent}</span>
                </div>
              )}

              {/* Live preview of exactly what will be sent (spec §11) */}
              {manualText.trim() && (
                <div className="send-preview">
                  <span className="sp-label">WILL SEND →</span>
                  <span className="sp-text">{manualText}</span>
                  {charCount > 144 && (
                    <span className="sp-warn">⚠ over 144 — will be truncated</span>
                  )}
                </div>
              )}

              {/* Saved Messages moved to the Status tab. The ★ Save button above
              still adds to them; they're viewed + sent from there. */}

              <h2 className="panel-title mt">Chatbox Preview</h2>
              <div className="preview">
                {preview ? (
                  preview.split('\n').map((l, i) => <div key={i}>{l}</div>)
                ) : (
                  <span className="muted">
                    Enable modules and start live updates to see output.
                  </span>
                )}
              </div>

              <button className={`btn wide ${live ? 'danger' : 'accent'}`} onClick={toggleLive}>
                {live ? '■ Stop Live Updates' : '▶ Start Live Updates'}
              </button>

              <div className="mt">
                <TelemetryPanel t={telemetry} />
              </div>
            </section>
          )}

          {/* RIGHT: tabbed config */}
          <section className="panel">
            {/* Tab buttons moved to the left sidebar (sb-nav). */}
            {tab === 'control' && (
              <ControlPanel settings={settings} onPersist={persist} flash={flash} />
            )}

            {tab === 'status' && (
              <StatusTab settings={settings} onPersist={persist} flash={flash} />
            )}

            {tab === 'features' && (
              <div className="features-shell">
                {/* Feature sub-nav lives in the sidebar now; the chosen
                  feature's panel renders here on the right. */}
                <div className="feat-content">
                  {/* Mute/Deaf */}
                  {featureModule === 'audio' && (
                    <div className="feat">
                      <h3>🔇 Mute / Deaf Alert</h3>
                      {renderModuleHeader('audio')}
                      <p className="small muted">
                        Listens to /avatar/parameters/MuteSelf &amp; Earmuffs on listen port.
                      </p>
                      <label className="chk">
                        <input
                          type="checkbox"
                          checked={settings.audioStatus.notify}
                          onChange={(e) =>
                            persist({
                              ...settings,
                              audioStatus: { ...settings.audioStatus, notify: e.target.checked },
                            })
                          }
                        />
                        Announce unmute transitions
                      </label>
                      <div className="trip">
                        <input
                          className="mini-input"
                          value={settings.audioStatus.mutedLabel}
                          onChange={(e) =>
                            persist({
                              ...settings,
                              audioStatus: { ...settings.audioStatus, mutedLabel: e.target.value },
                            })
                          }
                        />
                        <input
                          className="mini-input"
                          value={settings.audioStatus.deafLabel}
                          onChange={(e) =>
                            persist({
                              ...settings,
                              audioStatus: { ...settings.audioStatus, deafLabel: e.target.value },
                            })
                          }
                        />
                        <input
                          className="mini-input"
                          value={settings.audioStatus.unmutedLabel}
                          onChange={(e) =>
                            persist({
                              ...settings,
                              audioStatus: {
                                ...settings.audioStatus,
                                unmutedLabel: e.target.value,
                              },
                            })
                          }
                        />
                      </div>
                    </div>
                  )}

                  {/* AFK */}
                  {/* Spotify (and any other Windows Media Session source).
                  The module header at the top controls the chatbox "now
                  playing" line. The lyrics toggle below controls whether
                  the StatusRelay's lyrics slot is enabled, so it's all
                  music-related controls in one place. */}
                  {featureModule === 'media' && (
                    <SpotifyPanel
                      settings={settings}
                      onPersist={persist}
                      renderModuleHeader={renderModuleHeader}
                    />
                  )}

                  {/* Clock — single 24h toggle lives in the Connection tab; here
                  we expose the module enable + template. */}
                  {featureModule === 'clock' && (
                    <div className="feat">
                      <h3>🕐 Clock</h3>
                      {renderModuleHeader('clock')}
                      <label className="chk mt">
                        <input
                          type="checkbox"
                          checked={settings.clock24h}
                          onChange={(e) => persist({ ...settings, clock24h: e.target.checked })}
                        />
                        24-hour clock format
                      </label>
                    </div>
                  )}

                  {/* Session Timer — time since VRChat.exe launched. */}
                  {featureModule === 'session' && (
                    <div className="feat">
                      <h3>⏱️ Session Timer</h3>
                      {renderModuleHeader('session')}
                      <p className="small muted mt">
                        Shows how long you&apos;ve been in VR — e.g. <code>⏱️ in VR 2h 14m</code> —
                        counted from when VRChat launched on this PC. The line hides itself while
                        VRChat isn&apos;t running (a standalone Quest can&apos;t be detected from
                        the PC).
                      </p>
                    </div>
                  )}

                  {/* Custom Text — module + pinned text field. */}
                  {featureModule === 'custom' && (
                    <div className="feat">
                      <h3>💭 Custom Text</h3>
                      {renderModuleHeader('custom')}
                      <p className="small muted mt">A free-form line you can pin in the chatbox.</p>
                      <input
                        className="mini-input mt"
                        placeholder="Your custom text"
                        value={settings.customText}
                        onChange={(e) => persist({ ...settings, customText: e.target.value })}
                      />
                    </div>
                  )}

                  {featureModule === 'afk' && (
                    <AfkPanel
                      settings={settings}
                      onPersist={persist}
                      renderModuleHeader={renderModuleHeader}
                    />
                  )}

                  {/* Timezones */}
                  {featureModule === 'timezones' && (
                    <div className="feat">
                      <h3>🌍 Timezone Converter</h3>
                      {renderModuleHeader('timezones')}
                      <p className="small muted">
                        Cycles regions every {settings.timezoneCycleSec}s.
                      </p>
                      {settings.timezones.map((z, i) => {
                        // Pre-built option for the popular-zone dropdown. When the
                        // saved zone matches one of the curated options, the
                        // <select> shows that group→region; otherwise we fall
                        // through to "Custom…" and the freeform input below is
                        // shown so power users can paste any IANA name (e.g.
                        // "America/Indiana/Indianapolis") that isn't in the list.
                        const knownZones = COMMON_TIMEZONES.flatMap((g) =>
                          g.zones.map((zz) => zz.zone),
                        );
                        const isKnown = knownZones.includes(z.zone);
                        return (
                          <div className="trip" key={i}>
                            <input
                              className="mini-input"
                              placeholder="Label (e.g. EU)"
                              value={z.label}
                              onChange={(e) => {
                                const tz = [...settings.timezones];
                                const cur = tz[i];
                                if (!cur) return;
                                tz[i] = { ...cur, label: e.target.value };
                                persist({ ...settings, timezones: tz });
                              }}
                            />
                            <select
                              className="mini-input mono"
                              value={isKnown ? z.zone : '__custom'}
                              onChange={(e) => {
                                const tz = [...settings.timezones];
                                const cur = tz[i];
                                if (!cur) return;
                                const newZone = e.target.value;
                                if (newZone === '__custom') {
                                  // Leave the existing zone string in place; the
                                  // user will edit the freeform input below.
                                  tz[i] = { ...cur, zone: cur.zone || 'UTC' };
                                } else {
                                  // Auto-fill the label from the picked option if
                                  // the user hasn't already customized it.
                                  const opt = COMMON_TIMEZONES.flatMap((g) => g.zones).find(
                                    (zz) => zz.zone === newZone,
                                  );
                                  const label =
                                    !cur.label || cur.label === cur.zone
                                      ? (opt?.label ?? newZone)
                                      : cur.label;
                                  tz[i] = { ...cur, zone: newZone, label };
                                }
                                persist({ ...settings, timezones: tz });
                              }}
                              style={{ minWidth: 200 }}
                            >
                              {COMMON_TIMEZONES.map((group) => (
                                <optgroup key={group.group} label={group.group}>
                                  {group.zones.map((zz) => (
                                    <option key={zz.zone} value={zz.zone}>
                                      {zz.label}
                                    </option>
                                  ))}
                                </optgroup>
                              ))}
                              <option value="__custom">— Custom IANA name —</option>
                            </select>
                            {!isKnown && (
                              <input
                                className="mini-input mono"
                                placeholder="Asia/Tashkent"
                                value={z.zone}
                                style={{ width: 160 }}
                                onChange={(e) => {
                                  const tz = [...settings.timezones];
                                  const cur = tz[i];
                                  if (!cur) return;
                                  tz[i] = { ...cur, zone: e.target.value };
                                  persist({ ...settings, timezones: tz });
                                }}
                              />
                            )}
                            <button
                              className="btn ghost tiny"
                              onClick={() =>
                                persist({
                                  ...settings,
                                  timezones: settings.timezones.filter((_, j) => j !== i),
                                })
                              }
                            >
                              ✕
                            </button>
                          </div>
                        );
                      })}
                      <button
                        className="btn ghost tiny"
                        onClick={() =>
                          persist({
                            ...settings,
                            timezones: [
                              ...settings.timezones,
                              { zone: 'America/New_York', label: 'US East' },
                            ],
                          })
                        }
                      >
                        + Add zone
                      </button>
                      <label className="interval mt">
                        Cycle every
                        <input
                          type="number"
                          min={2}
                          value={settings.timezoneCycleSec}
                          onChange={(e) =>
                            persist({ ...settings, timezoneCycleSec: Number(e.target.value) })
                          }
                        />
                        s
                      </label>
                    </div>
                  )}

                  {/* Speech-to-Text */}
                  {featureModule === 'stt' && (
                    <div className="feat">
                      <h3>🎙️ Speech-to-Text</h3>
                      <p className="small muted">
                        Uses Windows's built-in speech recognition. Click the 🎙️ next to "Send" to
                        start dictation. First use may prompt for microphone permission.
                      </p>
                      <label className="chk">
                        <input
                          type="checkbox"
                          checked={!!settings.featureToggles?.autoSendDictation}
                          onChange={(e) =>
                            persist({
                              ...settings,
                              featureToggles: {
                                ...settings.featureToggles,
                                autoSendDictation: e.target.checked,
                              },
                            })
                          }
                        />
                        Auto-send each recognized phrase (skip the textarea)
                      </label>

                      {/* Diagnostic strip — shows the state of the recognizer and
                    the LAST phrase the recognizer surfaced. Without this it
                    was impossible to tell whether the mic was working or
                    not unless you happened to be on the Control tab when
                    the recognized text was inserted. */}
                      <div className="stt-diag mt">
                        <div className="row">
                          <span className="small muted">Recognizer state:</span>
                          <span className={`stt-pill ${sttState}`}>{sttState}</span>
                          {sttError && <span className="stt-err small">{sttError}</span>}
                        </div>
                        <div className="row mt">
                          <span className="small muted">Last heard:</span>
                          <span className="stt-heard">
                            {lastDictated ? (
                              `"${lastDictated}"`
                            ) : (
                              <em className="muted">
                                (nothing yet — speak after starting dictation)
                              </em>
                            )}
                          </span>
                        </div>
                        {!settings.featureToggles?.autoSendDictation && (
                          <p className="small muted mt">
                            💡 With auto-send off, recognized phrases land in the
                            <b> manual message textarea</b> on the Control tab. Click 🎙️ next to
                            Send there to start/stop dictation and watch the textarea fill up live.
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* PC Components (combined CPU/GPU/RAM/VRAM) */}
                  {featureModule === 'pc' && (
                    <div className="feat">
                      <h3>🖥️ PC Components</h3>
                      {renderModuleHeader('pc')}
                      <p className="small muted">
                        Enable the PC&nbsp;Components module on the Modules tab to surface this line
                        in the chatbox. Toggle the individual parts below to show only what you
                        want.
                      </p>
                      <label className="chk">
                        <input
                          type="checkbox"
                          checked={settings.pcComponents.showNames}
                          onChange={(e) =>
                            persist({
                              ...settings,
                              pcComponents: {
                                ...settings.pcComponents,
                                showNames: e.target.checked,
                              },
                            })
                          }
                        />
                        Show hardware model names (e.g. "RTX 5060 Ti")
                      </label>
                      <label className="chk">
                        <input
                          type="checkbox"
                          checked={settings.pcComponents.showCpu}
                          onChange={(e) =>
                            persist({
                              ...settings,
                              pcComponents: { ...settings.pcComponents, showCpu: e.target.checked },
                            })
                          }
                        />
                        Show CPU
                      </label>
                      <label className="chk">
                        <input
                          type="checkbox"
                          checked={settings.pcComponents.showGpu}
                          onChange={(e) =>
                            persist({
                              ...settings,
                              pcComponents: { ...settings.pcComponents, showGpu: e.target.checked },
                            })
                          }
                        />
                        Show GPU
                      </label>
                      <label className="chk">
                        <input
                          type="checkbox"
                          checked={settings.pcComponents.showRam}
                          onChange={(e) =>
                            persist({
                              ...settings,
                              pcComponents: { ...settings.pcComponents, showRam: e.target.checked },
                            })
                          }
                        />
                        Show RAM
                      </label>
                      <label className="chk">
                        <input
                          type="checkbox"
                          checked={settings.pcComponents.showVram}
                          onChange={(e) =>
                            persist({
                              ...settings,
                              pcComponents: {
                                ...settings.pcComponents,
                                showVram: e.target.checked,
                              },
                            })
                          }
                        />
                        Show VRAM
                      </label>
                    </div>
                  )}

                  {/* Network — purely a chatbox-line module. */}
                  {featureModule === 'network' && (
                    <div className="feat">
                      <h3>🌐 Network</h3>
                      {renderModuleHeader('network')}
                      <p className="small muted">
                        Streams your current download / upload rate to the chatbox using the OS
                        network counters.
                      </p>
                    </div>
                  )}

                  {/* AI Personality Mode — preset identity packs */}
                  {featureModule === 'persona' && (
                    <PersonaPanel settings={settings} onPersist={persist} flash={flash} />
                  )}

                  {/* ---- VRCOSC-ported features ---- */}
                  {featureModule === 'weather' && (
                    <WeatherPanel settings={settings} onPersist={persist} flash={flash} />
                  )}
                  {featureModule === 'voice' && (
                    <VoiceCommandsPanel settings={settings} onPersist={persist} />
                  )}
                  {featureModule === 'clips' && (
                    <ClipsPanel settings={settings} onPersist={persist} />
                  )}
                  {featureModule === 'whisper' && (
                    <WhisperPanel settings={settings} onPersist={persist} flash={flash} />
                  )}
                  {featureModule === 'battery' && (
                    <BatteryPanel settings={settings} onPersist={persist} />
                  )}

                  {featureModule === 'vrnotify' && (
                    <VrNotifyPanel settings={settings} onPersist={persist} />
                  )}

                  {featureModule === 'vroverlay' && (
                    <VrOverlayPanel settings={settings} onPersist={persist} />
                  )}

                  {featureModule === 'discord' && (
                    <DiscordPanel settings={settings} onPersist={persist} />
                  )}
                </div>
              </div>
            )}

            {tab === 'connection' && (
              <div className="conn-tab">
                <div className="conn">
                  <label>
                    IP Address
                    <input
                      value={settings.osc.ip}
                      onChange={(e) => updateOsc({ ip: e.target.value })}
                    />
                  </label>
                  <label>
                    Send Port
                    <input
                      type="number"
                      value={settings.osc.port}
                      onChange={(e) => updateOsc({ port: Number(e.target.value) })}
                    />
                  </label>
                  <label>
                    Listen Port
                    <input
                      type="number"
                      value={settings.osc.listenPort}
                      onChange={(e) => updateOsc({ listenPort: Number(e.target.value) })}
                    />
                  </label>
                </div>

                {/* Quest standalone helper. Shows when the target is a remote
                  LAN IP (i.e. a Quest), or a hint to set it when it's still
                  localhost. */}
                {isRemoteHostRenderer(settings.osc.ip) ? (
                  <div className="quest-note ok">
                    🥽 <b>Quest mode</b> — sending to{' '}
                    <code>
                      {settings.osc.ip}:{settings.osc.port}
                    </code>
                    . Make sure your Quest is on the <b>same Wi-Fi</b>, VRChat OSC is <b>enabled</b>{' '}
                    on the headset, and your router isn&apos;t blocking device-to-device traffic
                    (AP/client isolation off). Chatbox output works over LAN. Note: mute/deaf, the
                    VRChat AFK signal, and the instance radar can&apos;t reach the PC from a
                    standalone Quest — those stay PC-only.
                  </div>
                ) : (
                  <div className="quest-note">
                    💻 <b>Local mode (PCVR / Desktop)</b> — sending to this PC. Using a{' '}
                    <b>standalone Quest</b>? Set the IP above to your Quest&apos;s Wi-Fi IP (Quest →
                    Settings → Wi-Fi → your network → IP address), keep port <code>9000</code>, and
                    enable OSC in VRChat on the headset.
                  </div>
                )}

                <ReachabilityTest ip={settings.osc.ip} />

                <h3 className="mini-h">Send Target</h3>
                <div className="seg">
                  {(['desktop', 'vr', 'both'] as SendTarget[]).map((t) => (
                    <button
                      key={t}
                      className={`seg-btn ${settings.osc.target === t ? 'on' : ''}`}
                      onClick={() => updateOsc({ target: t })}
                    >
                      {t.toUpperCase()}
                    </button>
                  ))}
                </div>

                <div className="opts">
                  <label className="chk">
                    <input
                      type="checkbox"
                      checked={settings.osc.sendImmediately}
                      onChange={(e) => updateOsc({ sendImmediately: e.target.checked })}
                    />
                    Send immediately (skip keyboard)
                  </label>
                  <label className="chk">
                    <input
                      type="checkbox"
                      checked={settings.osc.playSound}
                      onChange={(e) => updateOsc({ playSound: e.target.checked })}
                    />
                    Play notification sound
                  </label>
                  <label className="chk">
                    <input
                      type="checkbox"
                      checked={settings.clock24h}
                      onChange={(e) => persist({ ...settings, clock24h: e.target.checked })}
                    />
                    24-hour clock
                  </label>
                </div>
                <div className="row between">
                  <label className="interval">
                    Update every
                    <input
                      type="number"
                      min={1}
                      value={settings.updateIntervalSec}
                      onChange={(e) =>
                        persist({ ...settings, updateIntervalSec: Number(e.target.value) })
                      }
                    />
                    s
                  </label>
                  <button
                    className="btn ghost"
                    onClick={async () => {
                      await window.chatbox.testConnection();
                      flash('Test message sent');
                    }}
                  >
                    Test
                  </button>
                </div>
              </div>
            )}

            {tab === 'theme' && (
              <div className="theme-tab">
                <h3 className="mini-h">Choose a theme</h3>
                <ThemePicker
                  current={settings.appearance.theme}
                  onPick={(id) => updateAppearance({ theme: id })}
                />
                <h3 className="mini-h">Custom background</h3>
                <p className="small muted">
                  Upload a photo or GIF to sit behind the interface. Tune opacity and blur so the UI
                  stays readable.
                </p>
                <BackgroundPicker appearance={settings.appearance} onChange={updateAppearance} />

                <h3 className="mini-h">Theme editor</h3>
                <p className="small muted">
                  Override individual colors on top of the active preset. Changes apply live
                  everywhere.
                </p>
                <ThemeEditor settings={settings} onPersist={persist} />

                <h3 className="mini-h">Custom CSS</h3>
                <p className="small muted">
                  Free-form CSS injected after the bundled styles. Lets you override anything in the
                  app. <b>This can break the UI</b> — use the Reset button if things go sideways.
                </p>
                <textarea
                  className="msg-input mono"
                  style={{ height: 160, fontSize: 12 }}
                  placeholder=".phrase-btn { border-radius: 0; }"
                  value={settings.appearance.customCss ?? ''}
                  onChange={(e) => updateAppearance({ customCss: e.target.value })}
                />
                <div className="row mt">
                  <button
                    className="btn ghost"
                    disabled={!settings.appearance.customCss}
                    onClick={() => updateAppearance({ customCss: '' })}
                  >
                    Reset CSS
                  </button>
                  <span className="small muted">
                    {(settings.appearance.customCss ?? '').length} chars
                  </span>
                </div>
              </div>
            )}

            {tab === 'health' && <HealthPanel flash={flash} />}

            {tab === 'settings' && (
              <SettingsPanel
                settings={settings}
                onPersist={persist}
                flash={flash}
                onShowTour={() => setOnboardingOpen(true)}
              />
            )}
          </section>
        </main>

        <footer className="statusbar">
          <span className="status-text">{status}</span>
          <span className="endpoint">
            → {settings.osc.ip}:{settings.osc.port} · ⇐ :{settings.osc.listenPort} ·{' '}
            {settings.osc.target}
          </span>
        </footer>
      </div>
      {/* /main-col */}

      {/* First-launch onboarding tour. Rendered at root so it overlays
          everything; dismissal persists via the onboarded feature toggle. */}
      {onboardingOpen && (
        <OnboardingTour
          settings={settings}
          onPersist={persist}
          onClose={() => setOnboardingOpen(false)}
        />
      )}
    </div>
  );
}
