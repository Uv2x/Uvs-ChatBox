import { useState } from 'react';
import type { AppSettings } from '../shared/types';
import { PERSONAS, getPersona, type PersonaPreset } from '../shared/personas';

// Rough gender hint from a voice's name — used as a tiebreaker so different
// personas don't all collapse to the same system default. Heuristic only;
// we never advertise the result as authoritative.
const FEMALE_HINTS = [
  'zira',
  'eva',
  'hazel',
  'aria',
  'jenny',
  'nanami',
  'ayumi',
  'haruka',
  'sayaka',
  'helena',
  'female',
  'samantha',
  'karen',
  'moira',
  'tessa',
];
const MALE_HINTS = [
  'david',
  'mark',
  'james',
  'guy',
  'ryan',
  'george',
  'kenji',
  'ichiro',
  'male',
  'fred',
  'daniel',
  'oliver',
  'tom',
];
function guessGender(name: string): 'male' | 'female' | null {
  const n = name.toLowerCase();
  if (FEMALE_HINTS.some((h) => n.includes(h))) return 'female';
  if (MALE_HINTS.some((h) => n.includes(h))) return 'male';
  return null;
}

/** Pick the best installed voice for a persona. Priority:
 *    1. Exact substring match on persona.voice.preferVoiceNames
 *    2. Lang match + persona.voice.preferGender match
 *    3. Lang match only
 *    4. Whatever's available */
function pickVoiceForPersona(persona: PersonaPreset): SpeechSynthesisVoice | null {
  if (typeof window.speechSynthesis === 'undefined') return null;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null;
  const wantLang = persona.voice.preferLang;
  const langMatches = wantLang
    ? voices.filter(
        (v) => v.lang === wantLang || v.lang.startsWith(wantLang.split('-')[0] ?? wantLang),
      )
    : voices;

  // 1) Substring match on a preferred voice name (case-insensitive).
  const hints = persona.voice.preferVoiceNames ?? [];
  for (const hint of hints) {
    const h = hint.toLowerCase();
    const match = voices.find((v) => v.name.toLowerCase().includes(h));
    if (match) return match;
  }

  // 2) Lang + gender match.
  const wantGender = persona.voice.preferGender;
  if (wantGender) {
    const g = langMatches.find((v) => guessGender(v.name) === wantGender);
    if (g) return g;
  }

  // 3) Any lang match.
  if (langMatches.length > 0) return langMatches[0] ?? null;

  // 4) Fallback.
  return voices[0] ?? null;
}

/** Speak `text` once using the browser SpeechSynthesis API with the persona's
 *  voice config applied. Best-effort: silently does nothing if speech synth
 *  isn't available. Each persona gets a different installed voice + pitch +
 *  rate, so the five presets sound distinguishable rather than all-the-same
 *  with different pitches. */
function speakWithPersona(text: string, persona: PersonaPreset): void {
  if (typeof window.speechSynthesis === 'undefined') return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.pitch = persona.voice.pitch;
    u.rate = persona.voice.rate;
    u.volume = persona.voice.volume;
    const voice = pickVoiceForPersona(persona);
    if (voice) u.voice = voice;
    window.speechSynthesis.speak(u);
  } catch (e) {
    console.warn('[persona] speak failed:', e);
  }
}

export function PersonaPanel(props: {
  settings: AppSettings;
  onPersist: (s: AppSettings) => void;
  flash: (msg: string) => void;
}) {
  const { settings, onPersist, flash } = props;
  const activeId = settings.activePersonaId ?? 'chill';
  const active = getPersona(activeId);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const setActive = (id: string) => onPersist({ ...settings, activePersonaId: id });

  /** Add the persona's phrase pack to Saved Messages (Control tab) — the
   *  Quick Phrases library was removed, so the pack lands somewhere the user
   *  can actually see and click it. De-dupes by text. */
  const applyPhrasePack = (p: PersonaPreset) => {
    setBusyAction('phrases');
    const existing = settings.savedMessages ?? [];
    const haveTexts = new Set(existing.map((m) => m.text));
    const additions = p.phrasePack
      .map((ph) => ph.text)
      .filter((t) => t && !haveTexts.has(t))
      .map((text) => ({ id: 'sm_' + Math.random().toString(36).slice(2, 8), text }));
    if (additions.length === 0) {
      flash('Those phrases are already in Saved Messages');
      setBusyAction(null);
      return;
    }
    onPersist({
      ...settings,
      savedMessages: [...additions, ...existing].slice(0, 50),
    });
    flash(`Added ${additions.length} ${p.name} phrases to Saved Messages (Control tab)`);
    setBusyAction(null);
  };

  /** Replace the auto-responder template with the persona's. We don't toggle
   *  the auto-responder on; that's the user's call. */
  const applyAutoResponder = (p: PersonaPreset) => {
    setBusyAction('autoResp');
    onPersist({
      ...settings,
      autoResponder: { ...settings.autoResponder, message: p.autoResponderText },
    });
    flash(`Auto-responder set to "${p.autoResponderText}"`);
    setBusyAction(null);
  };

  const testVoice = (p: PersonaPreset) => {
    const sample = p.phrasePack[0]?.text ?? 'hello';
    speakWithPersona(sample, p);
  };

  return (
    <div className="feat">
      <h3>🎭 AI Personality Mode</h3>
      <p className="small muted">
        Pick a persona — each one ships a custom voice (TTS), a pack of ready-made lines, an
        auto-responder message, and per-status text overrides (e.g. "afk" becomes "afk-desu~" under
        Anime). Everything is opt-in per persona via the buttons below. "Add phrases" drops the
        pack into <b>Saved Messages</b> on the Control tab, where you can click to send them.
      </p>

      <div className="persona-grid">
        {PERSONAS.map((p) => (
          <button
            key={p.id}
            className={`persona-card ${activeId === p.id ? 'on' : ''}`}
            onClick={() => setActive(p.id)}
          >
            <span className="persona-icon">{p.icon}</span>
            <span className="persona-name">{p.name}</span>
            <span className="persona-desc">{p.description}</span>
          </button>
        ))}
      </div>

      {active && (
        <div className="persona-actions">
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            <button
              className="btn ghost tiny"
              onClick={() => testVoice(active)}
              disabled={busyAction !== null}
            >
              🔊 Test voice
            </button>
            <button
              className="btn ghost tiny"
              onClick={() => applyPhrasePack(active)}
              disabled={busyAction !== null}
              title="Adds these to Saved Messages on the Control tab"
            >
              ➕ Add {active.name} phrases → Saved ({active.phrasePack.length})
            </button>
            <button
              className="btn ghost tiny"
              onClick={() => applyAutoResponder(active)}
              disabled={busyAction !== null}
            >
              🗒️ Set auto-responder message
            </button>
          </div>

          <h4 className="mini-h mt">Phrase pack preview</h4>
          <div className="phrase-preview">
            {active.phrasePack.map((ph, i) => (
              <span key={i} className="phrase-chip" title={ph.text}>
                <b>{ph.label}</b> · {ph.text}
              </span>
            ))}
          </div>

          <h4 className="mini-h mt">Status text under this persona</h4>
          <div className="phrase-preview">
            {Object.entries(active.statusVariants).map(([statusId, variant]) => (
              <span key={statusId} className="phrase-chip">
                <b>{statusId}</b> · {variant}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
