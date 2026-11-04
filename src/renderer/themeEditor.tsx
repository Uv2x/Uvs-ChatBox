import { useMemo } from 'react';
import type { AppSettings } from '../shared/types';
import { themeById } from './themes';

/** The CSS variables the editor exposes. Listed in a sensible visual
 *  order; not every CSS var (e.g. --app-bg gradient) is editable because
 *  the gradient form is too fiddly for a simple color picker. */
const EDITABLE_VARS: { key: string; label: string; group: 'base' | 'accent' | 'state' }[] = [
  { key: '--bg', label: 'Background', group: 'base' },
  { key: '--bg-2', label: 'Background (alt)', group: 'base' },
  { key: '--panel', label: 'Panel', group: 'base' },
  { key: '--panel-2', label: 'Panel (alt)', group: 'base' },
  { key: '--line', label: 'Borders', group: 'base' },
  { key: '--text', label: 'Text', group: 'base' },
  { key: '--muted', label: 'Muted text', group: 'base' },
  { key: '--accent', label: 'Accent (primary)', group: 'accent' },
  { key: '--accent-2', label: 'Accent (secondary)', group: 'accent' },
  { key: '--accent-3', label: 'Accent (tertiary)', group: 'accent' },
  { key: '--ok', label: 'OK / Success', group: 'state' },
  { key: '--danger', label: 'Danger / Error', group: 'state' },
];

/** Convert any CSS color string into a #rrggbb hex usable by <input type="color">.
 *  Works by drawing a 1×1 canvas pixel of that color and reading it back —
 *  the canvas does the parsing for us, including names like "rebeccapurple"
 *  and rgb(...) / rgba(...) forms. Returns '#000000' on failure. */
function toHex(color: string): string {
  if (!color) return '#000000';
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(color)) {
    const r = color[1],
      g = color[2],
      b = color[3];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const ctx = c.getContext('2d');
    if (!ctx) return '#000000';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    const hex = (n: number) => n.toString(16).padStart(2, '0');
    return `#${hex(d[0]!)}${hex(d[1]!)}${hex(d[2]!)}`;
  } catch {
    return '#000000';
  }
}

export function ThemeEditor(props: { settings: AppSettings; onPersist: (s: AppSettings) => void }) {
  const { settings, onPersist } = props;
  const baseTheme = useMemo(
    () => themeById(settings.appearance.theme),
    [settings.appearance.theme],
  );
  const custom = settings.appearance.customColors ?? {};

  // Effective value to display: custom override if present, else the base
  // theme's value. Conversion to hex happens lazily via toHex().
  const valueFor = (key: string) => custom[key] ?? baseTheme.vars[key] ?? '#000000';

  const setColor = (key: string, hex: string) => {
    onPersist({
      ...settings,
      appearance: {
        ...settings.appearance,
        customColors: { ...custom, [key]: hex },
      },
    });
  };

  const clearOverride = (key: string) => {
    const next = { ...custom };
    delete next[key];
    onPersist({
      ...settings,
      appearance: {
        ...settings.appearance,
        customColors: Object.keys(next).length > 0 ? next : undefined,
      },
    });
  };

  const resetAll = () => {
    onPersist({
      ...settings,
      appearance: { ...settings.appearance, customColors: undefined },
    });
  };

  const groups: Array<{ id: (typeof EDITABLE_VARS)[number]['group']; label: string }> = [
    { id: 'base', label: 'Surfaces & text' },
    { id: 'accent', label: 'Accent colors' },
    { id: 'state', label: 'Status colors' },
  ];

  return (
    <div className="theme-editor">
      <p className="small muted">
        Tweak any color. Changes apply live across the app. Overrides are layered on top of the
        current preset — so picking a new preset will keep your overrides until you clear them.
      </p>

      {groups.map((g) => (
        <div className="theme-group" key={g.id}>
          <h4 className="mini-h">{g.label}</h4>
          <div className="theme-rows">
            {EDITABLE_VARS.filter((v) => v.group === g.id).map((v) => {
              const overridden = v.key in custom;
              return (
                <div className="theme-row" key={v.key}>
                  <input
                    type="color"
                    value={toHex(valueFor(v.key))}
                    onChange={(e) => setColor(v.key, e.target.value)}
                    title={v.key}
                  />
                  <span className="theme-row-label">{v.label}</span>
                  <span className="theme-row-key mono">{v.key}</span>
                  <button
                    className="btn ghost tiny"
                    disabled={!overridden}
                    onClick={() => clearOverride(v.key)}
                    title={overridden ? 'Revert to preset value' : 'No override'}
                  >
                    ↺
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div className="row mt">
        <button
          className="btn ghost tiny"
          onClick={resetAll}
          disabled={Object.keys(custom).length === 0}
        >
          Clear all overrides
        </button>
        <span className="small muted">
          {Object.keys(custom).length === 0
            ? 'Using preset colors only.'
            : `${Object.keys(custom).length} override${Object.keys(custom).length === 1 ? '' : 's'} active`}
        </span>
      </div>
    </div>
  );
}
