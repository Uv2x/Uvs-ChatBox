import { useState } from 'react';
import type {
  AppSettings,
  QuickPhrase,
  Macro,
  Timeline,
  Action,
  PhraseFolder,
} from '../shared/types';
import { validateLength, OscManagerMax } from './constants';

let idCounter = Date.now();
const newId = (prefix: string) => `${prefix}_${(idCounter++).toString(36)}`;

/** Captures a keyboard accelerator like "Ctrl+Alt+A" into an Electron string. */
function HotkeyCapture(props: { value?: string; onChange: (v: string | undefined) => void }) {
  const [capturing, setCapturing] = useState(false);

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.preventDefault();
    const parts: string[] = [];
    if (e.ctrlKey) parts.push('CommandOrControl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    const key = e.key.toUpperCase();
    // Ignore lone modifier presses.
    if (!['CONTROL', 'ALT', 'SHIFT', 'META'].includes(key)) {
      parts.push(key.length === 1 ? key : e.key);
      props.onChange(parts.join('+'));
      setCapturing(false);
    }
  };

  return (
    <span className="hk-capture">
      <button
        className={`btn ghost tiny ${capturing ? 'capturing' : ''}`}
        onKeyDown={onKeyDown}
        onClick={() => setCapturing(true)}
        onBlur={() => setCapturing(false)}
      >
        {capturing ? 'Press keys…' : props.value || 'Set hotkey'}
      </button>
      {props.value && (
        <button className="btn ghost tiny" onClick={() => props.onChange(undefined)}>
          ✕
        </button>
      )}
    </span>
  );
}

const ACTION_KINDS: Action['kind'][] = [
  'sendText',
  'setStatus',
  'setParameter',
  'clearChatbox',
  'setVariable',
  'switchProfile',
  'runMacro',
  'runTimeline',
  'delay',
];

/** Edits a single Action (used by phrase + macro editors). */
function ActionEditor(props: {
  action: Action;
  settings: AppSettings;
  onChange: (a: Action) => void;
}) {
  const { action, settings, onChange } = props;

  const changeKind = (kind: Action['kind']) => {
    switch (kind) {
      case 'sendText':
        onChange({ kind, text: '' });
        break;
      case 'setStatus':
        onChange({ kind, statusId: settings.statuses[0]?.id ?? '' });
        break;
      case 'setParameter':
        onChange({ kind, address: '/avatar/parameters/', value: 0, valueType: 'float' });
        break;
      case 'clearChatbox':
        onChange({ kind });
        break;
      case 'setVariable':
        onChange({ kind, name: 'name', value: '' });
        break;
      case 'switchProfile':
        onChange({ kind, profileId: settings.profiles[0]?.id ?? '' });
        break;
      case 'runMacro':
        onChange({ kind, macroId: settings.macros[0]?.id ?? '' });
        break;
      case 'runTimeline':
        onChange({ kind, timelineId: settings.timelines[0]?.id ?? '' });
        break;
      case 'delay':
        onChange({ kind, ms: 500 });
        break;
    }
  };

  return (
    <div className="action-edit">
      <select
        className="mini-input"
        value={action.kind}
        onChange={(e) => changeKind(e.target.value as Action['kind'])}
      >
        {ACTION_KINDS.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </select>

      {action.kind === 'sendText' &&
        (() => {
          const v = validateLength(action.text);
          return (
            <span className="text-with-count">
              <input
                className="mini-input grow"
                placeholder="Text (supports {vars})"
                value={action.text}
                onChange={(e) => onChange({ ...action, text: e.target.value })}
              />
              <span
                className={`len-badge ${v.over ? 'over' : ''}`}
                title={v.over ? 'Exceeds VRChat 144-char limit' : 'Characters'}
              >
                {v.len}/{OscManagerMax}
              </span>
            </span>
          );
        })()}
      {action.kind === 'setStatus' && (
        <select
          className="mini-input"
          value={action.statusId}
          onChange={(e) => onChange({ ...action, statusId: e.target.value })}
        >
          {settings.statuses.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      )}
      {action.kind === 'setParameter' && (
        <>
          <input
            className="mini-input grow"
            placeholder="/avatar/parameters/X"
            value={action.address}
            onChange={(e) => onChange({ ...action, address: e.target.value })}
          />
          <input
            className="mini-input tiny-num"
            value={String(action.value)}
            onChange={(e) =>
              onChange({
                ...action,
                value:
                  action.valueType === 'bool' ? e.target.value === 'true' : Number(e.target.value),
              })
            }
          />
          <select
            className="mini-input"
            value={action.valueType}
            onChange={(e) => onChange({ ...action, valueType: e.target.value as any })}
          >
            <option value="float">float</option>
            <option value="int">int</option>
            <option value="bool">bool</option>
          </select>
        </>
      )}
      {action.kind === 'setVariable' && (
        <>
          <input
            className="mini-input"
            placeholder="name"
            value={action.name}
            onChange={(e) => onChange({ ...action, name: e.target.value })}
          />
          <input
            className="mini-input grow"
            placeholder="value"
            value={action.value}
            onChange={(e) => onChange({ ...action, value: e.target.value })}
          />
        </>
      )}
      {action.kind === 'switchProfile' && (
        <select
          className="mini-input"
          value={action.profileId}
          onChange={(e) => onChange({ ...action, profileId: e.target.value })}
        >
          {settings.profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      {action.kind === 'runMacro' && (
        <select
          className="mini-input"
          value={action.macroId}
          onChange={(e) => onChange({ ...action, macroId: e.target.value })}
        >
          {settings.macros.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      )}
      {action.kind === 'runTimeline' && (
        <select
          className="mini-input"
          value={action.timelineId}
          onChange={(e) => onChange({ ...action, timelineId: e.target.value })}
        >
          {settings.timelines.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      )}
      {action.kind === 'delay' && (
        <input
          className="mini-input tiny-num"
          type="number"
          min={0}
          step={100}
          value={action.ms}
          onChange={(e) => onChange({ ...action, ms: Number(e.target.value) })}
        />
      )}
    </div>
  );
}

/** ===== Phrase library editor (spec §3) ===== */
export function PhraseEditor(props: {
  settings: AppSettings;
  onPersist: (s: AppSettings) => void;
}) {
  const { settings, onPersist } = props;

  const update = (phrases: QuickPhrase[]) => onPersist({ ...settings, phrases });
  const updateFolders = (folders: PhraseFolder[]) => onPersist({ ...settings, folders });

  const addPhrase = () =>
    update([
      ...settings.phrases,
      {
        id: newId('p'),
        label: 'New',
        actions: [{ kind: 'sendText', text: '' }],
        folderId: null,
        favorite: false,
        useCount: 0,
        lastUsed: 0,
      },
    ]);
  const editPhrase = (id: string, patch: Partial<QuickPhrase>) =>
    update(settings.phrases.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const delPhrase = (id: string) => update(settings.phrases.filter((p) => p.id !== id));

  const addFolder = () =>
    updateFolders([...settings.folders, { id: newId('f'), name: 'Folder', color: '#9aa0ad' }]);

  return (
    <div className="editor">
      <div className="row between">
        <h3 className="ctl-h">Quick Phrases</h3>
        <div className="btn-row">
          <button className="btn ghost tiny" onClick={addFolder}>
            + Folder
          </button>
          <button className="btn primary tiny" onClick={addPhrase}>
            + Phrase
          </button>
        </div>
      </div>

      {settings.phrases.map((p) => (
        <div className="edit-card" key={p.id}>
          <div className="edit-row">
            <button
              className={`star-btn ${p.favorite ? 'on' : ''}`}
              onClick={() => editPhrase(p.id, { favorite: !p.favorite })}
              title="Favorite"
            >
              ★
            </button>
            <input
              className="mini-input"
              style={{ maxWidth: 120 }}
              value={p.label}
              onChange={(e) => editPhrase(p.id, { label: e.target.value })}
            />
            <select
              className="mini-input"
              value={p.folderId ?? ''}
              onChange={(e) => editPhrase(p.id, { folderId: e.target.value || null })}
            >
              <option value="">No folder</option>
              {settings.folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <HotkeyCapture value={p.hotkey} onChange={(hk) => editPhrase(p.id, { hotkey: hk })} />
            <button className="btn ghost tiny danger-btn" onClick={() => delPhrase(p.id)}>
              Delete
            </button>
          </div>
          {/* Tags + color editors. Tags are space- or comma-separated;
              we split on either when saving back. Color drives the chip
              tint on the Control tab's phrase grid. */}
          <div className="edit-row" style={{ marginTop: 4 }}>
            <input
              className="mini-input"
              style={{ flex: 1 }}
              placeholder="tags (space or comma separated)"
              defaultValue={(Array.isArray(p.tags) ? p.tags : []).join(' ')}
              onBlur={(e) => {
                const tags = e.target.value
                  .split(/[\s,]+/)
                  .map((t) => t.trim())
                  .filter(Boolean);
                editPhrase(p.id, { tags: tags.length > 0 ? tags : undefined });
              }}
            />
            <input
              type="color"
              value={p.color || '#888888'}
              onChange={(e) => editPhrase(p.id, { color: e.target.value })}
              title="Phrase tint color"
              style={{
                width: 32,
                height: 28,
                padding: 0,
                border: '1px solid var(--line)',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            />
            {p.color && (
              <button
                className="btn ghost tiny"
                onClick={() => editPhrase(p.id, { color: undefined })}
                title="Clear color"
              >
                ↺
              </button>
            )}
          </div>
          <div className="action-list">
            {/* Defensive: a phrase from an older settings.json may have
                `actions` missing or non-array. Coerce to [] so we never
                crash the whole editor — the user can still add one. */}
            {(Array.isArray(p.actions) ? p.actions : []).map((a, i) => {
              const acts = Array.isArray(p.actions) ? p.actions : [];
              return (
                <div className="action-line" key={i}>
                  <ActionEditor
                    action={a}
                    settings={settings}
                    onChange={(na) =>
                      editPhrase(p.id, { actions: acts.map((x, j) => (j === i ? na : x)) })
                    }
                  />
                  {acts.length > 1 && (
                    <button
                      className="btn ghost tiny"
                      onClick={() => editPhrase(p.id, { actions: acts.filter((_, j) => j !== i) })}
                    >
                      −
                    </button>
                  )}
                </div>
              );
            })}
            <button
              className="btn ghost tiny"
              onClick={() =>
                editPhrase(p.id, {
                  actions: [
                    ...(Array.isArray(p.actions) ? p.actions : []),
                    { kind: 'sendText', text: '' },
                  ],
                })
              }
            >
              + Action
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** ===== Macro builder (spec §7) ===== */
export function MacroEditor(props: { settings: AppSettings; onPersist: (s: AppSettings) => void }) {
  const { settings, onPersist } = props;
  const update = (macros: Macro[]) => onPersist({ ...settings, macros });

  const addMacro = () =>
    update([
      ...settings.macros,
      { id: newId('m'), name: 'New Macro', steps: [{ kind: 'sendText', text: '' }] },
    ]);
  const editMacro = (id: string, patch: Partial<Macro>) =>
    update(settings.macros.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  const delMacro = (id: string) => update(settings.macros.filter((m) => m.id !== id));

  const moveStep = (m: Macro, i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= m.steps.length) return;
    const steps = [...m.steps];
    const a = steps[i];
    const b = steps[j];
    if (!a || !b) return;
    steps[i] = b;
    steps[j] = a;
    editMacro(m.id, { steps });
  };

  return (
    <div className="editor">
      <div className="row between">
        <h3 className="ctl-h">Macros</h3>
        <button className="btn primary tiny" onClick={addMacro}>
          + Macro
        </button>
      </div>
      {settings.macros.map((m) => (
        <div className="edit-card" key={m.id}>
          <div className="edit-row">
            <input
              className="mini-input grow"
              value={m.name}
              onChange={(e) => editMacro(m.id, { name: e.target.value })}
            />
            <HotkeyCapture value={m.hotkey} onChange={(hk) => editMacro(m.id, { hotkey: hk })} />
            <button className="btn ghost tiny danger-btn" onClick={() => delMacro(m.id)}>
              Delete
            </button>
          </div>
          <div className="action-list">
            {m.steps.map((a, i) => (
              <div className="action-line" key={i}>
                <span className="step-num">{i + 1}</span>
                <ActionEditor
                  action={a}
                  settings={settings}
                  onChange={(na) =>
                    editMacro(m.id, { steps: m.steps.map((x, j) => (j === i ? na : x)) })
                  }
                />
                <div className="order-btns">
                  <button onClick={() => moveStep(m, i, -1)}>▲</button>
                  <button onClick={() => moveStep(m, i, 1)}>▼</button>
                </div>
                <button
                  className="btn ghost tiny"
                  onClick={() => editMacro(m.id, { steps: m.steps.filter((_, j) => j !== i) })}
                >
                  −
                </button>
              </div>
            ))}
            <button
              className="btn ghost tiny"
              onClick={() => editMacro(m.id, { steps: [...m.steps, { kind: 'delay', ms: 500 }] })}
            >
              + Step
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** ===== Timeline editor (spec §8) ===== */
export function TimelineEditor(props: {
  settings: AppSettings;
  onPersist: (s: AppSettings) => void;
}) {
  const { settings, onPersist } = props;
  const update = (timelines: Timeline[]) => onPersist({ ...settings, timelines });

  const addTl = () =>
    update([
      ...settings.timelines,
      {
        id: newId('t'),
        name: 'New Timeline',
        loop: false,
        frames: [{ text: 'Frame 1', holdMs: 600 }],
      },
    ]);
  const editTl = (id: string, patch: Partial<Timeline>) =>
    update(settings.timelines.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const delTl = (id: string) => update(settings.timelines.filter((t) => t.id !== id));

  return (
    <div className="editor">
      <div className="row between">
        <h3 className="ctl-h">Timelines</h3>
        <button className="btn primary tiny" onClick={addTl}>
          + Timeline
        </button>
      </div>
      {settings.timelines.map((t) => (
        <div className="edit-card" key={t.id}>
          <div className="edit-row">
            <input
              className="mini-input grow"
              value={t.name}
              onChange={(e) => editTl(t.id, { name: e.target.value })}
            />
            <label className="chk">
              <input
                type="checkbox"
                checked={t.loop}
                onChange={(e) => editTl(t.id, { loop: e.target.checked })}
              />
              Loop
            </label>
            <button className="btn ghost tiny danger-btn" onClick={() => delTl(t.id)}>
              Delete
            </button>
          </div>
          <div className="action-list">
            {t.frames.map((f, i) => (
              <div className="action-line" key={i}>
                <span className="step-num">{i + 1}</span>
                <span className="text-with-count grow">
                  <input
                    className="mini-input grow"
                    value={f.text}
                    placeholder="Frame text"
                    onChange={(e) =>
                      editTl(t.id, {
                        frames: t.frames.map((x, j) =>
                          j === i ? { ...x, text: e.target.value } : x,
                        ),
                      })
                    }
                  />
                  <span className={`len-badge ${validateLength(f.text).over ? 'over' : ''}`}>
                    {validateLength(f.text).len}/{OscManagerMax}
                  </span>
                </span>
                <input
                  className="mini-input tiny-num"
                  type="number"
                  min={200}
                  step={100}
                  value={f.holdMs}
                  onChange={(e) =>
                    editTl(t.id, {
                      frames: t.frames.map((x, j) =>
                        j === i ? { ...x, holdMs: Number(e.target.value) } : x,
                      ),
                    })
                  }
                />
                <button
                  className="btn ghost tiny"
                  onClick={() => editTl(t.id, { frames: t.frames.filter((_, j) => j !== i) })}
                >
                  −
                </button>
              </div>
            ))}
            <button
              className="btn ghost tiny"
              onClick={() => editTl(t.id, { frames: [...t.frames, { text: '', holdMs: 600 }] })}
            >
              + Frame
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** ===== Profile + status editor (spec §2/§5) ===== */
export function ProfileEditor(props: {
  settings: AppSettings;
  onPersist: (s: AppSettings) => void;
}) {
  const { settings, onPersist } = props;

  const editProfile = (id: string, patch: any) =>
    onPersist({
      ...settings,
      profiles: settings.profiles.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    });
  const editOsc = (id: string, patch: any) =>
    onPersist({
      ...settings,
      profiles: settings.profiles.map((p) =>
        p.id === id ? { ...p, osc: { ...p.osc, ...patch } } : p,
      ),
    });
  const addProfile = () =>
    onPersist({
      ...settings,
      profiles: [
        ...settings.profiles,
        {
          id: newId('prof'),
          name: 'Custom',
          osc: { ip: '127.0.0.1', port: 9000, listenPort: 9001 },
          defaultStatusId: settings.statuses[0]?.id ?? 'available',
        },
      ],
    });
  const delProfile = (id: string) =>
    onPersist({ ...settings, profiles: settings.profiles.filter((p) => p.id !== id) });

  return (
    <div className="editor">
      <div className="row between">
        <h3 className="ctl-h">Device Profiles</h3>
        <button className="btn primary tiny" onClick={addProfile}>
          + Profile
        </button>
      </div>
      {settings.profiles.map((p) => (
        <div className="edit-card" key={p.id}>
          <div className="edit-row">
            {/* Emoji icon — single-character paste field. Most users will
                drop in an emoji like 🥽 / 🖥️ / 🎮. Treated as decoration;
                the profile name remains the canonical identifier. */}
            <input
              className="mini-input"
              style={{ width: 42, textAlign: 'center', fontSize: 18 }}
              maxLength={4}
              value={p.icon ?? ''}
              placeholder="🎮"
              onChange={(e) => editProfile(p.id, { icon: e.target.value || undefined })}
              title="Icon (emoji)"
            />
            <input
              type="color"
              value={p.color || '#888888'}
              onChange={(e) => editProfile(p.id, { color: e.target.value })}
              title="Profile accent color"
              style={{
                width: 32,
                height: 28,
                padding: 0,
                border: '1px solid var(--line)',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            />
            <input
              className="mini-input"
              style={{ maxWidth: 120 }}
              value={p.name}
              onChange={(e) => editProfile(p.id, { name: e.target.value })}
            />
            <input
              className="mini-input"
              style={{ maxWidth: 110 }}
              value={p.osc.ip}
              onChange={(e) => editOsc(p.id, { ip: e.target.value })}
            />
            <input
              className="mini-input tiny-num"
              type="number"
              value={p.osc.port}
              onChange={(e) => editOsc(p.id, { port: Number(e.target.value) })}
            />
            <input
              className="mini-input tiny-num"
              type="number"
              value={p.osc.listenPort}
              onChange={(e) => editOsc(p.id, { listenPort: Number(e.target.value) })}
            />
            <select
              className="mini-input"
              value={p.defaultStatusId}
              onChange={(e) => editProfile(p.id, { defaultStatusId: e.target.value })}
            >
              {settings.statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            {settings.profiles.length > 1 && (
              <button className="btn ghost tiny danger-btn" onClick={() => delProfile(p.id)}>
                Delete
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
