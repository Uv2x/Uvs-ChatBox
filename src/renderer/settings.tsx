import { useEffect, useState } from 'react';
import type { AppSettings, UiModes, UpdateStatus } from '../shared/types';
import { orderedFeatures } from './featureList';

/** Settings is split into these groups, one shown at a time. */
const SETTINGS_GROUPS = [
  { id: 'general', label: 'General' },
  { id: 'chatbox', label: 'Chatbox' },
  { id: 'background', label: 'Background' },
  { id: 'ai', label: 'AI' },
  { id: 'backup', label: 'Backup & Updates' },
] as const;
type SettingsGroup = (typeof SETTINGS_GROUPS)[number]['id'];

/** One "window layout" choice instead of separate Launch Mode + Compact
 *  switches: VR = launchMode 'vr'; Compact = desktop + compact. */
const WINDOW_LAYOUTS = [
  { id: 'standard', label: 'Standard', hint: 'The normal desktop window.' },
  {
    id: 'compact',
    label: 'Compact',
    hint: 'A small, dense window that stays on top — handy beside VRChat on desktop.',
  },
  {
    id: 'vr',
    label: 'VR',
    hint: 'Bigger buttons for clicking from a VR desktop overlay. Stays on top.',
  },
] as const;
type WindowLayout = (typeof WINDOW_LAYOUTS)[number]['id'];

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
  const [group, setGroup] = useState<SettingsGroup>('general');
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
  const setToggle = (key: string, v: boolean) =>
    onPersist({ ...settings, featureToggles: { ...settings.featureToggles, [key]: v } });

  const windowLayout: WindowLayout =
    settings.ui.launchMode === 'vr' ? 'vr' : settings.ui.compact ? 'compact' : 'standard';
  const setWindowLayout = (l: WindowLayout) =>
    setUi({ launchMode: l === 'vr' ? 'vr' : 'desktop', compact: l === 'compact' });

  return (
    <div className="settings-panel">
      {/* One group of settings at a time — it used to be one 9-screen page. */}
      <div className="seg settings-groups">
        {SETTINGS_GROUPS.map((g) => (
          <button
            key={g.id}
            className={`seg-btn ${group === g.id ? 'on' : ''}`}
            onClick={() => setGroup(g.id)}
          >
            {g.label}
          </button>
        ))}
      </div>

      {group === 'general' && (
        <>
          {/* Window layout — one choice instead of separate Launch Mode and
          Compact switches (both made the window stay on top). */}
          <h3 className="ctl-h">Window Layout</h3>
          <div className="seg">
            {WINDOW_LAYOUTS.map((l) => (
              <button
                key={l.id}
                className={`seg-btn ${windowLayout === l.id ? 'on' : ''}`}
                onClick={() => setWindowLayout(l.id)}
              >
                {l.label}
              </button>
            ))}
          </div>
          <p className="set-hint mt">{WINDOW_LAYOUTS.find((l) => l.id === windowLayout)?.hint}</p>
          <Toggle
            label="Simple mode"
            hint="Hides advanced features and extra panels — shows only the essentials"
            checked={!!settings.simpleMode}
            onChange={(v) =>
              onPersist({ ...settings, simpleMode: v, ui: { ...settings.ui, minimalUi: v } })
            }
          />

          <h3 className="ctl-h">Look</h3>
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

          {/* Feature order — reorder the Features sidebar list. */}
          <h3 className="ctl-h">Feature Order</h3>
          <details className="set-details">
            <summary className="set-hint">
              Change the order of the Features list in the sidebar
            </summary>
            <FeatureOrderEditor settings={settings} onPersist={onPersist} />
          </details>

          {/* Optional panels on the Control tab */}
          <h3 className="ctl-h">Control Tab</h3>
          <Toggle
            label="Show the connection monitor"
            hint="Live list of OSC messages coming from VRChat"
            checked={settings.featureToggles.connectionMonitor !== false}
            onChange={(v) => setToggle('connectionMonitor', v)}
          />
          <Toggle
            label="Show action history"
            hint="Recent sends, with Undo"
            checked={settings.featureToggles.history !== false}
            onChange={(v) => setToggle('history', v)}
          />

          <h3 className="ctl-h">Welcome Tour</h3>
          <div className="row">
            <button className="btn ghost" onClick={() => onShowTour?.()}>
              Show the welcome tour again
            </button>
          </div>
        </>
      )}

      {group === 'chatbox' && (
        <>
          {/* How often the live chatbox line refreshes (was under Connection). */}
          <h3 className="ctl-h">Update Speed</h3>
          <label className="set-num-row">
            <span>Update the chatbox every</span>
            <input
              type="number"
              min={1}
              value={settings.updateIntervalSec}
              onChange={(e) =>
                onPersist({ ...settings, updateIntervalSec: Number(e.target.value) })
              }
            />
            <span>seconds</span>
          </label>

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
                          const next = e.target.checked
                            ? [...cur, mid]
                            : cur.filter((m) => m !== mid);
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

          {/* Chatbox font — minimal Unicode style picker. ASCII letters get
          mapped to small-caps or fullwidth codepoints before send. */}
          <h3 className="ctl-h">Chatbox Font</h3>
          <p className="set-hint">
            Optional Unicode style applied to every outgoing chatbox line. Pick <b>Plain</b> to
            disable. ASCII-only — emoji and punctuation pass through unchanged.
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

          {/* Auto-translate outgoing chatbox text. */}
          <h3 className="ctl-h">Auto-translate</h3>
          <p className="set-hint">
            Translate every outgoing chatbox message to the target language before sending. Uses
            Google Translate's free gateway (no API key required). Original language is
            auto-detected.
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

          {/* External chatbox mode — lets another OSC tool (Magic Chatbox,
          etc.) own the in-VRChat chatbox text while this app keeps doing
          everything else (status, AI, monitoring). */}
          <h3 className="ctl-h">External Chatbox Mode</h3>
          <p className="set-hint">
            Turn this ON to let <b>Magic Chatbox</b> (or any other OSC chatbox tool) own the
            in-VRChat chatbox text display. This app will <b>stop sending</b>{' '}
            <code>/chatbox/input</code> entirely — no more racing/overwriting between the two apps.
            Everything else here keeps working: status tracking, AI, monitoring, hotkeys, etc.
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
        </>
      )}

      {group === 'background' && (
        <>
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

          {/* VRChat log integration — toggles the output_log tailer. */}
          <h3 className="ctl-h">VRChat Output Log</h3>
          <p className="set-hint">
            Reads VRChat's local output log to expose <code>{'{world}'}</code>,
            <code>{' {instanceType}'}</code>, <code>{' {playerCount}'}</code>,
            <code>{' {lastJoin}'}</code>, <code>{' {lastLeave}'}</code>,<code>{' {avatar}'}</code>{' '}
            tokens you can use in any module template (and a dedicated <em>VRChat</em> module in
            your module list). No API access — purely reads files VRChat already writes.
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
        </>
      )}

      {group === 'ai' && (
        <>
          {/* ============================================================
          AI (Anthropic / Claude) integration. OFF by default — the
          user pastes an API key and picks a model, then per-feature
          toggles control which AI features are active.
          ============================================================ */}
          <h3 className="ctl-h">AI Assistant (Anthropic / Claude)</h3>
          <p className="set-hint">
            Powered by the Anthropic API. You pay per call — Haiku 4.5 is the cheap option (~$0.001
            per chatbox-line generation); Opus 4.7 is the smartest (~$0.005 per call). Get an API
            key from <code>console.anthropic.com</code>. Your key is stored locally in settings.json
            and never sent anywhere except Anthropic.
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
                    value={settings.ai?.model ?? 'claude-opus-5-5'}
                    onChange={(e) =>
                      onPersist({
                        ...settings,
                        ai: { ...settings.ai!, model: e.target.value },
                      })
                    }
                    style={{ width: 200 }}
                  >
                    <option value="claude-opus-5-5">Opus 5.5 — best (default)</option>
                    <option value="claude-sonnet-5-5">Sonnet 5.5 — fast + smart, costs less</option>
                    <option value="claude-haiku-5-5">Haiku 5.5 — cheapest, plenty for one line</option>
                  </select>
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
            </>
          )}
        </>
      )}

      {group === 'backup' && (
        <>
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
              <button
                className="btn primary tiny"
                onClick={() => void window.chatbox.installUpdate()}
              >
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
                      u.available
                        ? `Update v${u.latestVersion} available`
                        : (u.error ?? 'Up to date'),
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
          <h3 className="ctl-h">Settings Backup</h3>
          <p className="set-hint">
            Export saves your current configuration as a JSON file. Import replaces all settings
            with the contents of a JSON file — make sure to back up first.
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
            Reset everything to factory defaults — every toggle, status, pin, saved message, theme,
            and feature setting. Your current config is backed up first (see the Backups list
            above), so this is recoverable.
          </p>
          <div className="row">
            <button className="btn danger" onClick={resetAll}>
              ⟲ Reset all settings
            </button>
          </div>
        </>
      )}
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
    model: 'claude-opus-5-5',
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
