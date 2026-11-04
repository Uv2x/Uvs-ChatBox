import { useEffect, useState } from 'react';
import type { AppSettings, UiModes, PillMethod, UpdateStatus } from '../shared/types';
import { orderedFeatures } from './featureList';

/** Pill Lab variants. Letters match the "PILL TEST A…F" message in-game. */
const PILL_LAB: { id: PillMethod | 'richtext'; letter: string; desc: string }[] = [
  { id: 'legacy', letter: 'A', desc: 'Classic trick (worked before Unity 6)' },
  { id: 'vrcosc', letter: 'B', desc: 'VRCOSC-style: vertical-tab line breaks + classic suffix' },
  { id: 'etx', letter: 'C', desc: 'End-of-text character only' },
  { id: 'us', letter: 'D', desc: 'Unit-separator character only' },
  { id: 'lsep', letter: 'E', desc: 'Unicode line-separator breaks + classic suffix' },
  { id: 'richtext', letter: 'F', desc: 'Check: does the chatbox now render <b>/<size> tags?' },
];

/** Reorder the Features sidebar list with up/down controls. Writes the id
 *  order to settings.featureOrder; App reads it via orderedFeatures(). */
function FeatureOrderEditor(props: { settings: AppSettings; onPersist: (s: AppSettings) => void }) {
  const list = orderedFeatures(props.settings.featureOrder);
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const ids = list.map((m) => m.id);
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    props.onPersist({ ...props.settings, featureOrder: ids });
  };
  return (
    <div className="feat-order">
      {list.map((m, i) => (
        <div className="feat-order-row" key={m.id}>
          <span className="feat-order-icon">{m.icon}</span>
          <span className="feat-order-label">{m.label}</span>
          <button
            className="btn ghost tiny"
            disabled={i === 0}
            onClick={() => move(i, -1)}
            title="Move up"
          >
            ▲
          </button>
          <button
            className="btn ghost tiny"
            disabled={i === list.length - 1}
            onClick={() => move(i, 1)}
            title="Move down"
          >
            ▼
          </button>
        </div>
      ))}
      <button
        className="btn ghost tiny mt"
        onClick={() => props.onPersist({ ...props.settings, featureOrder: undefined })}
      >
        Reset to default order
      </button>
    </div>
  );
}

/** A labeled toggle switch. */
function Toggle(props: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="set-toggle">
      <span className="set-toggle-text">
        {props.label}
        {props.hint && <span className="set-hint">{props.hint}</span>}
      </span>
      <span className="switch">
        <input
          type="checkbox"
          checked={props.checked}
          onChange={(e) => props.onChange(e.target.checked)}
        />
        <span className="slider" />
      </span>
    </label>
  );
}

/** One-line state for the Settings → Updates row. */
function updateLabel(u: UpdateStatus | null): string {
  if (!u) return '—';
  if (u.downloaded) return `v${u.latestVersion} is ready — restart to install`;
  if (u.downloading) return `Downloading v${u.latestVersion}… ${u.percent ?? 0}%`;
  if (u.checking) return 'Checking…';
  if (u.available) return `v${u.latestVersion} available`;
  if (u.error) return u.error;
  return 'Up to date';
}

export function SettingsPanel(props: {
  settings: AppSettings;
  onPersist: (s: AppSettings) => void;
  flash: (m: string) => void;
  /** Optional — parent passes this to let Settings re-open the onboarding
   *  tour. Falls back to a no-op when not provided. */
  onShowTour?: () => void;
}) {
  const { settings, onPersist, flash, onShowTour } = props;
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  // Whether app.setLoginItemSettings says the app is registered to launch
  // at Windows login. We read this once on mount so the toggle reflects
  // reality (the setting isn't stored in settings.json — it's a system
  // registry entry under HKCU\Software\Microsoft\Windows\...\Run).
  const [loginItem, setLoginItem] = useState(false);

  useEffect(() => {
    void window.chatbox.checkUpdate().then(setUpdate);
    // Background checks and download progress arrive here too.
    return window.chatbox.onUpdateStatus(setUpdate);
  }, []);
  useEffect(() => {
    void window.chatbox.getLoginItem().then(setLoginItem);
  }, []);

  const exportNow = async () => {
    const res = await window.chatbox.exportSettings();
    if (res.ok) flash(`Exported to ${res.path}`);
    else if (res.reason !== 'cancelled') flash(`Export failed: ${res.reason}`);
  };
  const importNow = async () => {
    const res = await window.chatbox.importSettings();
    if (res.ok) flash(`Imported ${res.path} — restart recommended`);
    else if (res.reason !== 'cancelled') flash(`Import failed: ${res.reason}`);
  };
  const resetAll = async () => {
    const ok = window.confirm(
      'Reset ALL settings to factory defaults?\n\n' +
        'This wipes every toggle, status, pin, saved message, theme, and feature ' +
        'setting. Your current configuration is backed up first (see the Backups ' +
        'list above), so it stays recoverable. The app will reload.',
    );
    if (!ok) return;
    await window.chatbox.resetSettings();
    // Main has already wiped settings.json + reset the engine. Reload so the
    // renderer re-reads the fresh defaults and drops all in-memory state.
    window.location.reload();
  };

  const setUi = (patch: Partial<UiModes>) =>
    onPersist({ ...settings, ui: { ...settings.ui, ...patch } });
  const setSafety = (patch: Partial<AppSettings['safety']>) =>
    onPersist({ ...settings, safety: { ...settings.safety, ...patch } });
  const setRefresh = (patch: Partial<AppSettings['refreshLoop']>) =>
    onPersist({ ...settings, refreshLoop: { ...settings.refreshLoop, ...patch } });
  const setAuto = (patch: Partial<AppSettings['autoResponder']>) =>
    onPersist({ ...settings, autoResponder: { ...settings.autoResponder, ...patch } });
  const setToggle = (key: string, v: boolean) =>
    onPersist({ ...settings, featureToggles: { ...settings.featureToggles, [key]: v } });

  return (
    <div className="settings-panel">
      {/* Launch mode */}
      <h3 className="ctl-h">Launch Mode</h3>
      <div className="seg">
        {(['desktop', 'vr'] as const).map((m) => (
          <button
            key={m}
            className={`seg-btn ${settings.ui.launchMode === m ? 'on' : ''}`}
            onClick={() => setUi({ launchMode: m })}
          >
            {m.toUpperCase()}
          </button>
        ))}
      </div>
      <p className="set-hint mt">
        VR mode uses an overlay-friendly layout (large targets, always-on-top).
      </p>

      {/* Visual modes */}
      <h3 className="ctl-h">Display Modes</h3>
      <Toggle
        label="Compact"
        hint="Dense layout for in-game multitasking"
        checked={settings.ui.compact}
        onChange={(v) => setUi({ compact: v })}
      />
      <Toggle
        label="Streamer"
        hint="Large high-contrast targets"
        checked={settings.ui.streamer}
        onChange={(v) => setUi({ streamer: v })}
      />
      <Toggle
        label="OLED"
        hint="Pure black, no glow"
        checked={settings.ui.oled}
        onChange={(v) => setUi({ oled: v })}
      />
      <Toggle
        label="Acrylic blur"
        hint="Frosted translucent panels"
        checked={settings.ui.acrylic}
        onChange={(v) => setUi({ acrylic: v })}
      />
      <Toggle
        label="Minimal UI"
        hint="Hide non-essential chrome"
        checked={settings.ui.minimalUi}
        onChange={(v) => setUi({ minimalUi: v })}
      />

      {/* Auto-translate outgoing chatbox text. */}
      <h3 className="ctl-h">Auto-translate</h3>
      <p className="set-hint">
        Translate every outgoing chatbox message to the target language before sending. Uses Google
        Translate's free gateway (no API key required). Original language is auto-detected.
      </p>
      <Toggle
        label="Enable auto-translate"
        checked={!!settings.translate?.enabled}
        onChange={(v) =>
          onPersist({
            ...settings,
            translate: {
              ...(settings.translate ?? { targetLang: 'en', mode: 'replace' as const }),
              enabled: v,
            },
          })
        }
      />
      {settings.translate?.enabled && (
        <div className="row mt">
          <label className="interval">
            Target language
            <select
              className="mini-input mono"
              value={settings.translate?.targetLang ?? 'en'}
              onChange={(e) =>
                onPersist({
                  ...settings,
                  translate: { ...settings.translate!, targetLang: e.target.value },
                })
              }
              style={{ width: 130 }}
            >
              <option value="en">English</option>
              <option value="ja">Japanese</option>
              <option value="ko">Korean</option>
              <option value="zh">Chinese</option>
              <option value="es">Spanish</option>
              <option value="fr">French</option>
              <option value="de">German</option>
              <option value="it">Italian</option>
              <option value="pt">Portuguese</option>
              <option value="ru">Russian</option>
              <option value="ar">Arabic</option>
              <option value="hi">Hindi</option>
              <option value="tr">Turkish</option>
              <option value="vi">Vietnamese</option>
              <option value="th">Thai</option>
              <option value="id">Indonesian</option>
              <option value="nl">Dutch</option>
              <option value="pl">Polish</option>
            </select>
          </label>
          <label className="interval">
            Mode
            <select
              className="mini-input"
              value={settings.translate?.mode ?? 'replace'}
              onChange={(e) =>
                onPersist({
                  ...settings,
                  translate: {
                    ...settings.translate!,
                    mode: e.target.value as 'replace' | 'bilingual',
                  },
                })
              }
              style={{ width: 130 }}
            >
              <option value="replace">Replace (only translated)</option>
              <option value="bilingual">Bilingual (original + translation)</option>
            </select>
          </label>
        </div>
      )}

      {/* Simple Mode — hides advanced UI. */}
      <h3 className="ctl-h">Simple Mode</h3>
      <Toggle
        label="Simple Mode"
        hint="Hides advanced tabs and features. Show only the essentials."
        checked={!!settings.simpleMode}
        onChange={(v) => onPersist({ ...settings, simpleMode: v })}
      />

      {/* Feature order — reorder the Features sidebar list. */}
      <h3 className="ctl-h">Feature Order</h3>
      <p className="set-hint">Reorder how features appear under the Features sidebar item.</p>
      <FeatureOrderEditor settings={settings} onPersist={onPersist} />

      {/* Background operation — tray + auto-launch. */}
      <h3 className="ctl-h">Background Operation</h3>
      <Toggle
        label="Close to tray"
        hint="Closing the window hides it; right-click the tray icon to quit"
        checked={settings.ui.closeToTray !== false}
        onChange={(v) => setUi({ closeToTray: v })}
      />
      <Toggle
        label="Launch on Windows startup"
        hint="Adds an entry to the Windows Run key — only works on the installed exe, not dev"
        checked={loginItem}
        onChange={async (v) => {
          await window.chatbox.setLoginItem(v);
          setLoginItem(v);
          flash(v ? 'Will launch at login' : 'Removed from startup');
        }}
      />
      <Toggle
        label="Auto-start with VRChat"
        hint="Starts live updates when VRChat launches and stops them when it exits — no more forgetting to press Start"
        checked={settings.autoStartWithVrchat === true}
        onChange={(v) => onPersist({ ...settings, autoStartWithVrchat: v })}
      />

      {/* Settings backup. Lets the user dump the entire AppSettings to JSON
          and reload it later — useful for sharing setups or recovering
          from a bad edit. */}
      <h3 className="ctl-h">Onboarding</h3>
      <div className="row">
        <button className="btn ghost" onClick={() => onShowTour?.()}>
          Show welcome tour
        </button>
      </div>

      {/* External chatbox mode — lets another OSC tool (Magic Chatbox,
          etc.) own the in-VRChat chatbox text while this app keeps doing
          everything else (status, AI, monitoring). */}
      <h3 className="ctl-h">External Chatbox Mode</h3>
      <p className="set-hint">
        Turn this ON to let <b>Magic Chatbox</b> (or any other OSC chatbox tool) own the in-VRChat
        chatbox text display. This app will <b>stop sending</b> <code>/chatbox/input</code> entirely
        — no more racing/overwriting between the two apps. Everything else here keeps working:
        status tracking, AI, monitoring, hotkeys, etc.
      </p>
      <Toggle
        label="Let another app own the chatbox"
        hint="This app will stop writing /chatbox/input; Magic Chatbox can run alongside"
        checked={!!settings.externalChatbox}
        onChange={(v) => onPersist({ ...settings, externalChatbox: v })}
      />
      {settings.externalChatbox && (
        <p className="small muted mt">
          ✓ Chatbox sends suppressed. Open Magic Chatbox and configure it as you normally would.
          Both apps can run at the same time.
        </p>
      )}

      {/* Pill / minimal-background chatbox. Every method is an unofficial
          text trick. The classic one (VRCOSC's U+0003 U+001F suffix) broke when
          VRChat moved players to Unity 6 (2026.3.3, Oct 2 2026). Tested in-game
          Oct 31 2026: Pill Lab variants A–E all render the standard bubble, F
          shows tags as literal text, and /chatbox/input has no style argument.
          Kept so the user can re-check after future VRChat updates. */}
      <h3 className="ctl-h">Pill Chatbox (minimal background)</h3>
      <p className="set-hint" style={{ color: 'var(--danger)' }}>
        ⚠ <b>Not working in VRChat right now.</b> Since VRChat moved to <b>Unity 6</b> (Oct 2,
        2026), its chatbox ignores every known pill trick and shows formatting tags as plain text
        (all tested Oct 31, 2026). Keep this <b>off</b> — it only uses up characters. If VRChat
        brings minimal backgrounds back, re-check with the Pill Lab below.
      </p>
      <Toggle
        label="Use pill / minimal background (not working in current VRChat)"
        hint="Off recommended — VRChat currently ignores it; costs 1–2 characters per message"
        checked={!!settings.chatboxPill}
        onChange={(v) => onPersist({ ...settings, chatboxPill: v })}
      />
      <label className="row small mt">
        <span style={{ minWidth: 90 }}>Pill method</span>
        <select
          className="mini-input"
          value={settings.pillMethod ?? 'vrcosc'}
          onChange={(e) => onPersist({ ...settings, pillMethod: e.target.value as PillMethod })}
        >
          {PILL_LAB.filter((v) => v.id !== 'richtext').map((v) => (
            <option key={v.id} value={v.id}>
              {v.letter} — {v.desc}
            </option>
          ))}
        </select>
      </label>

      <h4 className="mini-h mt">🧪 Pill Lab — re-check after VRChat updates</h4>
      <p className="set-hint">
        With VRChat open, click a letter: your chatbox shows a two-line <b>PILL TEST</b> message for
        12 seconds (live updates pause so nothing covers it). If one ever looks slim again, turn the
        pill on and choose that letter as the Pill method above.
      </p>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        {PILL_LAB.map((v) => (
          <button
            key={v.id}
            className="btn ghost"
            title={v.desc}
            onClick={async () => {
              const r = await window.chatbox.pillTest(v.id);
              flash(
                r.ok
                  ? `Sent test ${v.letter} — look at your chatbox (${r.holdSec ?? 12}s)`
                  : `Test failed: ${r.error ?? 'unknown'}`,
              );
            }}
          >
            {v.letter}
          </button>
        ))}
      </div>

      {/* Chatbox font — minimal Unicode style picker. ASCII letters get
          mapped to small-caps or fullwidth codepoints before send. */}
      <h3 className="ctl-h">Chatbox Font</h3>
      <p className="set-hint">
        Optional Unicode style applied to every outgoing chatbox line. Pick <b>Plain</b> to disable.
        ASCII-only — emoji and punctuation pass through unchanged.
      </p>
      <div className="row mt">
        <label className="interval" style={{ flex: 1 }}>
          Style
          <select
            className="mini-input mono"
            value={settings.chatboxFont ?? 'plain'}
            onChange={(e) => onPersist({ ...settings, chatboxFont: e.target.value })}
            style={{ width: 220 }}
          >
            <option value="plain">Plain (no transform)</option>
            <option value="small-caps">sᴍᴀʟʟ ᴄᴀᴘs</option>
            <option value="fullwidth">Fullwidth (ｗｉｄｅ)</option>
          </select>
        </label>
      </div>
      <Toggle
        label="Text effects (*bold* _italic_ ~strike~)"
        hint="Markdown-style markers become bold/italic/struck Unicode glyphs in the chatbox"
        checked={!!settings.chatboxMarkdown}
        onChange={(v) => onPersist({ ...settings, chatboxMarkdown: v })}
      />

      <h3 className="ctl-h">Settings Backup</h3>
      <p className="set-hint">
        Export saves your current configuration as a JSON file. Import replaces all settings with
        the contents of a JSON file — make sure to back up first.
      </p>
      <div className="row">
        <button className="btn ghost" onClick={exportNow}>
          ⬇ Export settings
        </button>
        <button className="btn ghost" onClick={importNow}>
          ⬆ Import settings
        </button>
      </div>

      {/* Auto-snapshots. Every save writes a timestamped JSON to
          %APPDATA%\osc-chatbox\backups\. Latest 20 are kept; older ones
          are pruned. Pick one and click Restore to roll back without
          having to re-import a manual export. */}
      <BackupsList settings={settings} flash={flash} />

      {/* Danger zone — factory reset. Wipes settings.json to defaults and
          hard-resets the engine's runtime pins/status. A pre-reset backup is
          written first (appears in the Backups list), so it's recoverable. */}
      <h3 className="ctl-h">Danger Zone</h3>
      <p className="set-hint">
        Reset everything to factory defaults — every toggle, status, pin, saved message, theme, and
        feature setting. Your current config is backed up first (see the Backups list above), so
        this is recoverable.
      </p>
      <div className="row">
        <button className="btn danger" onClick={resetAll}>
          ⟲ Reset all settings
        </button>
      </div>

      {/* Multi-line chatbox — secondary row cycler. The OSC chatbox honors
          \n as a line break in VRChat. When enabled, the live loop
          composes a second line picking from `moduleIds` round-robin every
          `intervalSec`. */}
      <h3 className="ctl-h">Multi-line Chatbox</h3>
      <p className="set-hint">
        Add a second row to the chatbox that cycles through chosen modules at its own faster
        interval — useful for showing e.g. clock or mute state alongside the slower main row.
      </p>
      <Toggle
        label="Enable secondary row cycler"
        hint="Adds a second \\n-separated line to /chatbox/input"
        checked={!!settings.secondaryCycle?.enabled}
        onChange={(v) =>
          onPersist({
            ...settings,
            secondaryCycle: {
              ...(settings.secondaryCycle ?? {
                enabled: false,
                intervalSec: 4,
                moduleIds: ['clock'],
              }),
              enabled: v,
            },
          })
        }
      />
      {settings.secondaryCycle?.enabled && (
        <>
          <div className="row mt">
            <label className="interval">
              Cycle every
              <input
                type="number"
                min={2}
                max={60}
                className="mini-input tiny-num"
                value={settings.secondaryCycle?.intervalSec ?? 4}
                onChange={(e) =>
                  onPersist({
                    ...settings,
                    secondaryCycle: {
                      ...settings.secondaryCycle!,
                      intervalSec: Math.max(2, Number(e.target.value) || 4),
                    },
                  })
                }
              />
              s
            </label>
          </div>
          <p className="set-hint">Modules to cycle through (check to include):</p>
          <div className="row">
            {(
              [
                'audiostatus',
                'afk',
                'media',
                'clock',
                'timezone',
                'pcComponents',
                'network',
                'custom',
                'vrchat',
              ] as const
            ).map((mid) => {
              const enabled = settings.secondaryCycle?.moduleIds?.includes(mid) ?? false;
              return (
                <label key={mid} className="chk" style={{ marginRight: 12 }}>
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => {
                      const cur = settings.secondaryCycle?.moduleIds ?? [];
                      const next = e.target.checked ? [...cur, mid] : cur.filter((m) => m !== mid);
                      onPersist({
                        ...settings,
                        secondaryCycle: {
                          ...settings.secondaryCycle!,
                          moduleIds: next,
                        },
                      });
                    }}
                  />
                  {mid}
                </label>
              );
            })}
          </div>
        </>
      )}

      {/* VRChat log integration — toggles the output_log tailer. */}
      <h3 className="ctl-h">VRChat Output Log</h3>
      <p className="set-hint">
        Reads VRChat's local output log to expose <code>{'{world}'}</code>,
        <code>{' {instanceType}'}</code>, <code>{' {playerCount}'}</code>,
        <code>{' {lastJoin}'}</code>, <code>{' {lastLeave}'}</code>,<code>{' {avatar}'}</code>{' '}
        tokens you can use in any module template (and a dedicated <em>VRChat</em> module in your
        module list). No API access — purely reads files VRChat already writes.
      </p>
      <Toggle
        label="Enable VRChat log tailer"
        hint="Watches %LOCALAPPDATA%Low\\VRChat\\VRChat\\output_log_*.txt"
        checked={!!settings.vrchatLog?.enabled}
        onChange={(v) =>
          onPersist({
            ...settings,
            vrchatLog: { enabled: v },
          })
        }
      />
      {settings.vrchatLog?.enabled && <VrchatLogPreview />}

      {/* ============================================================
          AI (Anthropic / Claude) integration. OFF by default — the
          user pastes an API key and picks a model, then per-feature
          toggles control which AI features are active.
          ============================================================ */}
      <h3 className="ctl-h">AI Assistant (Anthropic / Claude)</h3>
      <p className="set-hint">
        Powered by the Anthropic API. You pay per call — Haiku 4.5 is the cheap option (~$0.001 per
        chatbox-line generation); Opus 4.7 is the smartest (~$0.005 per call). Get an API key from{' '}
        <code>console.anthropic.com</code>. Your key is stored locally in settings.json and never
        sent anywhere except Anthropic.
      </p>
      <Toggle
        label="Enable AI integration"
        hint="Required before any AI feature works"
        checked={!!settings.ai?.enabled}
        onChange={(v) =>
          onPersist({
            ...settings,
            ai: { ...(settings.ai ?? aiFallback()), enabled: v },
          })
        }
      />
      {settings.ai?.enabled && (
        <>
          <div className="row mt">
            <label className="interval" style={{ flex: 1 }}>
              API key
              <input
                type="password"
                className="mini-input"
                placeholder="sk-ant-…"
                value={settings.ai?.apiKey ?? ''}
                onChange={(e) =>
                  onPersist({
                    ...settings,
                    ai: { ...settings.ai!, apiKey: e.target.value.trim() },
                  })
                }
                style={{ width: '100%' }}
              />
            </label>
          </div>
          <div className="row mt">
            <label className="interval">
              Model
              <select
                className="mini-input mono"
                value={settings.ai?.model ?? 'claude-opus-4-7'}
                onChange={(e) =>
                  onPersist({
                    ...settings,
                    ai: { ...settings.ai!, model: e.target.value },
                  })
                }
                style={{ width: 200 }}
              >
                <option value="claude-opus-4-7">Opus 4.7 — best, $$$</option>
                <option value="claude-sonnet-4-6">Sonnet 4.6 — fast + smart, $$</option>
                <option value="claude-haiku-4-5">Haiku 4.5 — cheapest, $</option>
              </select>
            </label>
            <label className="interval">
              Wake word
              <input
                className="mini-input mono"
                value={settings.ai?.wakeWord ?? 'uvy'}
                onChange={(e) =>
                  onPersist({
                    ...settings,
                    ai: { ...settings.ai!, wakeWord: e.target.value.toLowerCase().trim() || 'uvy' },
                  })
                }
                style={{ width: 90 }}
              />
            </label>
            <AiTestButton flash={flash} />
          </div>
          <div className="mt">
            <p className="set-hint" style={{ marginBottom: 4 }}>
              Persona / voice (sent to Claude on every call):
            </p>
            <textarea
              className="mini-input"
              rows={2}
              value={settings.ai?.persona ?? ''}
              onChange={(e) =>
                onPersist({
                  ...settings,
                  ai: { ...settings.ai!, persona: e.target.value },
                })
              }
              placeholder="Casual, friendly, lots of emoji…"
              style={{ width: '100%', fontFamily: 'inherit' }}
            />
          </div>
          <p className="set-hint mt">Per-feature toggles:</p>
          {(['generateLine', 'personaReply', 'cleanupStt'] as const).map((f) => {
            const labels: Record<string, string> = {
              generateLine: '✨ Generate chatbox lines on demand',
              personaReply: '🤖 AI auto-reply (replaces dumb AFK responder)',
              cleanupStt: '🎙️ Clean up dictation transcripts (punctuation + casing)',
            };
            return (
              <label key={f} className="chk" style={{ display: 'block', margin: '4px 0' }}>
                <input
                  type="checkbox"
                  checked={settings.ai?.features?.[f] ?? true}
                  onChange={(e) =>
                    onPersist({
                      ...settings,
                      ai: {
                        ...settings.ai!,
                        features: {
                          ...(settings.ai!.features ?? ({} as any)),
                          [f]: e.target.checked,
                        },
                      },
                    })
                  }
                />
                {labels[f]}
              </label>
            );
          })}
        </>
      )}

      {/* Anti-spam / safety */}
      <h3 className="ctl-h">Safety &amp; Anti-Spam</h3>
      <Toggle
        label="Spam prevention"
        checked={settings.safety.enabled}
        onChange={(v) => setSafety({ enabled: v })}
      />
      <div className="set-num-row">
        <label>
          Global rate (msg/s)
          <input
            type="number"
            min={1}
            max={10}
            value={settings.safety.globalRatePerSec}
            onChange={(e) => setSafety({ globalRatePerSec: Number(e.target.value) })}
          />
        </label>
        <label>
          Cooldown (ms)
          <input
            type="number"
            min={0}
            step={100}
            value={settings.safety.defaultCooldownMs}
            onChange={(e) => setSafety({ defaultCooldownMs: Number(e.target.value) })}
          />
        </label>
        <label>
          Dedupe window (ms)
          <input
            type="number"
            min={0}
            step={100}
            value={settings.safety.dedupeWindowMs}
            onChange={(e) => setSafety({ dedupeWindowMs: Number(e.target.value) })}
          />
        </label>
      </div>

      {/* Refresh loop */}
      <h3 className="ctl-h">Refresh Loop</h3>
      <Toggle
        label="Re-send current state periodically"
        hint="Keeps chatbox alive through VRChat resets"
        checked={settings.refreshLoop.enabled}
        onChange={(v) => setRefresh({ enabled: v })}
      />
      <label className="set-num-row">
        <span>Interval (s)</span>
        <input
          type="number"
          min={8}
          max={30}
          value={settings.refreshLoop.intervalSec}
          onChange={(e) => setRefresh({ intervalSec: Number(e.target.value) })}
        />
      </label>

      {/* Auto-responder */}
      <h3 className="ctl-h">Auto AFK Responder</h3>
      <Toggle
        label="Enable auto-AFK"
        checked={settings.autoResponder.enabled}
        onChange={(v) => setAuto({ enabled: v })}
      />
      <Toggle
        label="Also trigger on mute"
        checked={settings.autoResponder.onMute}
        onChange={(v) => setAuto({ onMute: v })}
      />
      <div className="set-num-row">
        <label>
          After (min)
          <input
            type="number"
            min={1}
            value={settings.autoResponder.afterMin}
            onChange={(e) => setAuto({ afterMin: Number(e.target.value) })}
          />
        </label>
        <label className="grow">
          Message
          <input
            value={settings.autoResponder.message}
            onChange={(e) => setAuto({ message: e.target.value })}
          />
        </label>
      </div>

      {/* Feature master toggles */}
      <h3 className="ctl-h">Features</h3>
      {Object.entries(settings.featureToggles).map(([k, v]) => (
        <Toggle
          key={k}
          label={k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())}
          checked={v}
          onChange={(nv) => setToggle(k, nv)}
        />
      ))}

      {/* Updater */}
      <h3 className="ctl-h">Updates</h3>
      <div className="updater">
        <span className="set-hint">
          Version {update?.currentVersion || '—'} · {updateLabel(update)}
        </span>
        {update?.downloading ? (
          <div className="update-progress grow">
            <div style={{ width: `${update.percent ?? 0}%` }} />
          </div>
        ) : update?.downloaded ? (
          <button className="btn primary tiny" onClick={() => void window.chatbox.installUpdate()}>
            Restart to update
          </button>
        ) : (
          <>
            <button
              className="btn ghost tiny"
              disabled={update?.checking}
              onClick={async () => {
                const u = await window.chatbox.checkUpdate();
                setUpdate(u);
                flash(
                  u.available ? `Update v${u.latestVersion} available` : (u.error ?? 'Up to date'),
                );
              }}
            >
              Check now
            </button>
            {update?.available && (
              <button
                className="btn primary tiny"
                onClick={async () => {
                  const ok = await window.chatbox.applyUpdate();
                  if (!ok) flash('Download failed — try again');
                }}
              >
                Download v{update.latestVersion}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Auto-backup snapshot list. Polls main once on mount; user picks a row
 *  and clicks Restore to roll back. We do NOT trigger an automatic UI
 *  refresh after restore — the user should restart-or-reload to be sure
 *  every subsystem reads the new values (some run on long timers). */
function BackupsList(props: { settings: AppSettings; flash: (m: string) => void }) {
  const { flash } = props;
  const [items, setItems] = useState<{ name: string; mtime: number; size: number }[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    void window.chatbox.listBackups().then(setItems);
  };
  useEffect(refresh, []);

  const restore = async (name: string) => {
    if (!window.confirm(`Restore "${name}"? Your current settings will be overwritten.`)) return;
    setBusy(true);
    try {
      const ok = await window.chatbox.restoreBackup(name);
      flash(ok ? '✓ Settings restored — reload the app to apply everywhere.' : 'Restore failed');
    } finally {
      setBusy(false);
      refresh();
    }
  };

  return (
    <div className="bk-list mt">
      <div className="row between">
        <p className="set-hint" style={{ margin: 0 }}>
          Auto-snapshots taken on every save. Latest {items.length} kept.
        </p>
        <button className="btn ghost tiny" onClick={refresh}>
          ↻ Refresh
        </button>
      </div>
      {items.length === 0 && (
        <p className="small muted">No snapshots yet — save the settings once to create one.</p>
      )}
      <ul className="bk-rows">
        {items.slice(0, 12).map((it) => (
          <li key={it.name} className="bk-row">
            <span className="bk-when">{new Date(it.mtime).toLocaleString()}</span>
            <span className="bk-size small muted">{(it.size / 1024).toFixed(1)} KB</span>
            <button className="btn ghost tiny" disabled={busy} onClick={() => restore(it.name)}>
              Restore
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Live preview of the VRChat output-log tailer. Polls main every 3s so
 *  the user can confirm the tailer is actually picking events up — handy
 *  for diagnosing "is it working?" without digging through logs. */
function VrchatLogPreview() {
  const [snap, setSnap] = useState<{
    inWorld: boolean;
    world: string;
    instanceType: string;
    playerCount: number;
    lastJoin: string;
    lastLeave: string;
    avatar: string;
    lastUpdate: number;
  } | null>(null);
  useEffect(() => {
    const tick = () => {
      void window.chatbox.getVrchatLog().then(setSnap);
    };
    tick();
    const id = window.setInterval(tick, 3000);
    return () => window.clearInterval(id);
  }, []);
  if (!snap) return null;
  if (!snap.lastUpdate) {
    return <p className="small muted">Waiting for VRChat to write to its log…</p>;
  }
  return (
    <div className="vrlog-preview">
      <div>
        <b>In world:</b> {snap.inWorld ? 'yes' : 'no'}
      </div>
      <div>
        <b>World:</b> {snap.world || '—'}
      </div>
      <div>
        <b>Instance:</b> {snap.instanceType || '—'}
      </div>
      <div>
        <b>Players:</b> {snap.playerCount}
      </div>
      <div>
        <b>Last join:</b> {snap.lastJoin || '—'}
      </div>
      <div>
        <b>Last leave:</b> {snap.lastLeave || '—'}
      </div>
      <div>
        <b>Avatar:</b> {snap.avatar || '—'}
      </div>
    </div>
  );
}

/** Defaults stand-in used when the user toggles AI on for the first time. */
function aiFallback() {
  return {
    enabled: false,
    apiKey: '',
    model: 'claude-opus-4-7',
    features: {
      generateLine: true,
      personaReply: true,
      cleanupStt: true,
      suggestPhrase: true,
      voiceCommand: true,
    },
    wakeWord: 'uvy',
    persona: 'Casual, friendly, a bit playful.',
  };
}

/** "Test connection" button — fires a 16-token probe call and flashes
 *  ✓ or the typed error. Useful for confirming the API key works without
 *  triggering any of the actual features. */
function AiTestButton(props: { flash: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn ghost tiny"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        props.flash('Testing…');
        try {
          const r = await window.chatbox.aiTest();
          if (r.ok && r.data) {
            props.flash(
              `✓ AI ok — ${r.data.model} (${r.data.usage.input}+${r.data.usage.output} tokens)`,
            );
          } else {
            props.flash(`AI test failed: ${r.error}`);
          }
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? '…' : 'Test connection'}
    </button>
  );
}
