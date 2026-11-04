import { useEffect, useState } from 'react';
import type { AppSettings } from '../shared/types';

/** Onboarding tour — a modal walking new users through the basics so they
 *  don't drown in feature pages. Triggered on first run (when
 *  settings.featureToggles.onboarded is falsy) and re-openable via Settings.
 *  Dismissal marks `onboarded: true` so it doesn't keep nagging. */
export function OnboardingTour(props: {
  settings: AppSettings;
  onPersist: (s: AppSettings) => void;
  onClose: () => void;
}) {
  const { settings, onPersist, onClose } = props;
  const [step, setStep] = useState(0);

  const steps = [
    {
      title: "Welcome to Uv's Chat Box",
      body: (
        <>
          <p>
            A controller for the VRChat chatbox over OSC. Type a line, hit
            <b> Send</b>, and it appears above your avatar.
          </p>
          <p>
            This quick tour shows the four things to set up first. Skip anytime — you can reopen it
            from the Settings tab.
          </p>
        </>
      ),
    },
    {
      title: '1. OSC connection',
      body: (
        <>
          <p>
            The defaults usually just work: <b>127.0.0.1 : 9000</b> for sending,
            <b> :9001</b> for listening. VRChat needs OSC enabled in its launch options (it is by
            default).
          </p>
          <p>
            Switch to the <b>Connection</b> tab to change them if you've moved VRChat to another
            machine.
          </p>
        </>
      ),
    },
    {
      title: '2. Pick what shows in the chatbox',
      body: (
        <>
          <p>
            The <b>Features</b> tab lists every chatbox module — Spotify, Clock, PC Components, etc.
            Each one has a toggle at the top of its panel. Enable the ones you want; reorder them
            with ▲▼.
          </p>
          <p>
            Then click <b>▶ Start Live Updates</b> on the left panel to begin broadcasting. The
            chatbox preview shows exactly what'll be sent.
          </p>
        </>
      ),
    },
    {
      title: '3. AI Personality (optional)',
      body: (
        <>
          <p>
            Features → <b>🎭 AI Personality</b> presets (Chill, Streamer, Anime, Cyber, Minimal) —
            each one ships its own phrase pack and status text, so your chatbox has a consistent
            voice without you writing every line.
          </p>
          <p>
            Add your own lines any time from <b>Status → Saved Messages</b>.
          </p>
        </>
      ),
    },
    {
      title: "You're set",
      body: (
        <>
          <p>That's enough to get going. Other features worth exploring later:</p>
          <ul style={{ paddingLeft: 20, lineHeight: 1.7 }}>
            <li>
              📺 <b>Status Relay</b> — HUD-style rotating chatbox
            </li>
            <li>
              🎙️ <b>Speech-to-Text</b> — dictate messages
            </li>
            <li>
              ✨ <b>Reactive UI</b> — chatbox lights up with your voice
            </li>
            <li>
              🪄 <b>Magic-Chatbox preset</b> — Settings → "Chatbox Font" → one click to apply
            </li>
          </ul>
        </>
      ),
    },
  ];

  const finish = () => {
    onPersist({
      ...settings,
      featureToggles: { ...settings.featureToggles, onboarded: true },
    });
    onClose();
  };

  // Allow Esc to skip.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cur = steps[step]!;
  const isLast = step === steps.length - 1;

  return (
    <div className="onb-backdrop" onClick={finish}>
      <div className="onb-card" onClick={(e) => e.stopPropagation()}>
        <div className="onb-progress">
          {steps.map((_, i) => (
            <span
              key={i}
              className={`onb-dot ${i === step ? 'on' : ''} ${i < step ? 'done' : ''}`}
            />
          ))}
        </div>
        <h2 className="onb-title">{cur.title}</h2>
        <div className="onb-body">{cur.body}</div>
        <div className="onb-actions">
          <button className="btn ghost tiny" onClick={finish}>
            Skip tour
          </button>
          <div style={{ flex: 1 }} />
          {step > 0 && (
            <button className="btn ghost" onClick={() => setStep(step - 1)}>
              ← Back
            </button>
          )}
          {!isLast ? (
            <button className="btn primary" onClick={() => setStep(step + 1)}>
              Next →
            </button>
          ) : (
            <button className="btn primary" onClick={finish}>
              Got it
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
