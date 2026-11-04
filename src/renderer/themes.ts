// Theme presets. Each theme maps to the CSS variables consumed in styles.css.
// `--app-bg` is the full layered page background.

export interface Theme {
  id: string;
  name: string;
  blurb: string;
  /** Three swatch colors for the picker preview. */
  preview: [string, string, string];
  /** Whether this is a dark theme (affects a couple of UI affordances). */
  dark: boolean;
  vars: Record<string, string>;
}

export const THEMES: Theme[] = [
  {
    id: 'obsidian', name: 'Obsidian', blurb: 'Calm dark dashboard · violet accent',
    preview: ['#8b7fd4', '#4ade80', '#e8e6f0'],
    dark: true,
    vars: {
      '--bg': '#12101a', '--bg-2': '#15131f', '--panel': '#1c1a26', '--panel-2': '#1e1c2a',
      '--line': '#2a2738', '--text': '#e8e6f0', '--muted': '#8a8598',
      '--accent': '#8b7fd4', '--accent-2': '#9d8fe0', '--accent-3': '#7a6cc8',
      '--ok': '#4ade80', '--danger': '#f47174', '--glow': '0 0 20px rgba(139,127,212,0.25)',
      '--app-bg': 'radial-gradient(900px 480px at 85% -10%, rgba(139,127,212,0.06), transparent 60%), #12101a',
    },
  },
  {
    id: 'synthwave',
    name: 'Synthwave',
    blurb: 'Magenta + cyan neon',
    preview: ['#ff3d8b', '#00e5ff', '#b14bff'],
    dark: true,
    vars: {
      '--bg': '#0d0b14',
      '--bg-2': '#14101f',
      '--panel': '#181327',
      '--panel-2': '#1f1832',
      '--line': '#2d2245',
      '--text': '#e8e2ff',
      '--muted': '#8478a6',
      '--accent': '#ff3d8b',
      '--accent-2': '#00e5ff',
      '--accent-3': '#b14bff',
      '--ok': '#38f9b0',
      '--danger': '#ff5470',
      '--glow': '0 0 18px rgba(255,61,139,0.45)',
      '--app-bg':
        'radial-gradient(1200px 600px at 80% -10%, rgba(177,75,255,0.18), transparent 60%), radial-gradient(900px 500px at -10% 110%, rgba(0,229,255,0.12), transparent 60%), #0d0b14',
    },
  },
  {
    id: 'midnight',
    name: 'Midnight Ink',
    blurb: 'Monochrome noir',
    preview: ['#c9ccd6', '#9aa0ad', '#6f7480'],
    dark: true,
    vars: {
      '--bg': '#0a0a0c',
      '--bg-2': '#101013',
      '--panel': '#131316',
      '--panel-2': '#191920',
      '--line': '#2a2a31',
      '--text': '#e9e9ee',
      '--muted': '#7d7d88',
      '--accent': '#c9ccd6',
      '--accent-2': '#9aa0ad',
      '--accent-3': '#6f7480',
      '--ok': '#8fd6b4',
      '--danger': '#e2728a',
      '--glow': '0 0 16px rgba(201,204,214,0.28)',
      '--app-bg':
        'radial-gradient(1000px 500px at 50% -10%, rgba(255,255,255,0.05), transparent 60%), #0a0a0c',
    },
  },
  {
    id: 'sakura',
    name: 'Sakura',
    blurb: 'Soft pink bloom',
    preview: ['#ff8fb3', '#ffd1dc', '#ff6f9c'],
    dark: true,
    vars: {
      '--bg': '#1a1016',
      '--bg-2': '#23151d',
      '--panel': '#2a1a23',
      '--panel-2': '#33202b',
      '--line': '#48303d',
      '--text': '#ffeef4',
      '--muted': '#c79bac',
      '--accent': '#ff8fb3',
      '--accent-2': '#ffd1dc',
      '--accent-3': '#ff6f9c',
      '--ok': '#b6e3a8',
      '--danger': '#ff6b6b',
      '--glow': '0 0 18px rgba(255,143,179,0.5)',
      '--app-bg':
        'radial-gradient(900px 500px at 85% -5%, rgba(255,143,179,0.18), transparent 60%), radial-gradient(700px 400px at 0% 110%, rgba(255,209,220,0.12), transparent 60%), #1a1016',
    },
  },
  {
    id: 'matrix',
    name: 'Matrix',
    blurb: 'Terminal green',
    preview: ['#00ff7f', '#39ff14', '#00c46a'],
    dark: true,
    vars: {
      '--bg': '#020803',
      '--bg-2': '#04110a',
      '--panel': '#06150c',
      '--panel-2': '#091e11',
      '--line': '#103a20',
      '--text': '#c8ffd6',
      '--muted': '#4f8a64',
      '--accent': '#00ff7f',
      '--accent-2': '#39ff14',
      '--accent-3': '#00c46a',
      '--ok': '#7dff9e',
      '--danger': '#ff5470',
      '--glow': '0 0 18px rgba(0,255,127,0.5)',
      '--app-bg':
        'radial-gradient(1100px 600px at 50% -10%, rgba(0,255,127,0.12), transparent 60%), #020803',
    },
  },
  {
    id: 'oceanic',
    name: 'Oceanic',
    blurb: 'Deep teal & azure',
    preview: ['#2ad4ff', '#46f0c8', '#1f8fd6'],
    dark: true,
    vars: {
      '--bg': '#06121a',
      '--bg-2': '#0a1c28',
      '--panel': '#0d2533',
      '--panel-2': '#123040',
      '--line': '#1c4456',
      '--text': '#dff4ff',
      '--muted': '#6f9bb0',
      '--accent': '#2ad4ff',
      '--accent-2': '#46f0c8',
      '--accent-3': '#1f8fd6',
      '--ok': '#46f0c8',
      '--danger': '#ff6b8a',
      '--glow': '0 0 18px rgba(42,212,255,0.45)',
      '--app-bg':
        'radial-gradient(1100px 600px at 80% -10%, rgba(42,212,255,0.16), transparent 60%), radial-gradient(800px 500px at -10% 110%, rgba(70,240,200,0.1), transparent 60%), #06121a',
    },
  },
  {
    id: 'ember',
    name: 'Ember',
    blurb: 'Molten orange-red',
    preview: ['#ff6a2b', '#ffc14d', '#ff3d3d'],
    dark: true,
    vars: {
      '--bg': '#150a06',
      '--bg-2': '#1f0e08',
      '--panel': '#27130b',
      '--panel-2': '#321810',
      '--line': '#4a261a',
      '--text': '#ffece0',
      '--muted': '#bb8a76',
      '--accent': '#ff6a2b',
      '--accent-2': '#ffc14d',
      '--accent-3': '#ff3d3d',
      '--ok': '#ffd166',
      '--danger': '#ff3d3d',
      '--glow': '0 0 18px rgba(255,106,43,0.5)',
      '--app-bg':
        'radial-gradient(1000px 600px at 80% -10%, rgba(255,106,43,0.2), transparent 60%), radial-gradient(700px 400px at 0% 110%, rgba(255,61,61,0.12), transparent 60%), #150a06',
    },
  },
  {
    id: 'royal',
    name: 'Royal',
    blurb: 'Violet & gold',
    preview: ['#a06bff', '#ffd66b', '#7b4bff'],
    dark: true,
    vars: {
      '--bg': '#0f0a1e',
      '--bg-2': '#16102b',
      '--panel': '#1c1636',
      '--panel-2': '#241c45',
      '--line': '#372a5e',
      '--text': '#efe9ff',
      '--muted': '#9588bd',
      '--accent': '#a06bff',
      '--accent-2': '#ffd66b',
      '--accent-3': '#7b4bff',
      '--ok': '#7df0c8',
      '--danger': '#ff6b8a',
      '--glow': '0 0 18px rgba(160,107,255,0.5)',
      '--app-bg':
        'radial-gradient(1100px 600px at 75% -10%, rgba(160,107,255,0.2), transparent 60%), radial-gradient(700px 400px at 5% 110%, rgba(255,214,107,0.08), transparent 60%), #0f0a1e',
    },
  },
  {
    id: 'paper',
    name: 'Paper',
    blurb: 'Light, minimal',
    preview: ['#e0457b', '#0a84c4', '#7a4bd0'],
    dark: false,
    vars: {
      '--bg': '#f4f3f0',
      '--bg-2': '#eceae5',
      '--panel': '#ffffff',
      '--panel-2': '#f6f5f2',
      '--line': '#d9d6cf',
      '--text': '#1c1b1a',
      '--muted': '#7a766e',
      '--accent': '#e0457b',
      '--accent-2': '#0a84c4',
      '--accent-3': '#7a4bd0',
      '--ok': '#1f9d6b',
      '--danger': '#d6455f',
      '--glow': '0 0 14px rgba(224,69,123,0.25)',
      '--app-bg':
        'radial-gradient(1000px 500px at 80% -10%, rgba(224,69,123,0.06), transparent 60%), #f4f3f0',
    },
  },
  {
    id: 'cyberlime',
    name: 'Cyber Lime',
    blurb: 'Acid yellow-green',
    preview: ['#c6ff00', '#7cff5a', '#aef000'],
    dark: true,
    vars: {
      '--bg': '#0c0f06',
      '--bg-2': '#13180a',
      '--panel': '#181f0d',
      '--panel-2': '#1f2811',
      '--line': '#34421c',
      '--text': '#f2ffd6',
      '--muted': '#9aae6b',
      '--accent': '#c6ff00',
      '--accent-2': '#7cff5a',
      '--accent-3': '#aef000',
      '--ok': '#7cff5a',
      '--danger': '#ff5470',
      '--glow': '0 0 18px rgba(198,255,0,0.45)',
      '--app-bg':
        'radial-gradient(1100px 600px at 80% -10%, rgba(198,255,0,0.14), transparent 60%), #0c0f06',
    },
  },
  {
    id: 'vapor',
    name: 'Vaporwave',
    blurb: 'Pastel pink-blue',
    preview: ['#ff77e1', '#7af0ff', '#a98bff'],
    dark: true,
    vars: {
      '--bg': '#120e1f',
      '--bg-2': '#1a1430',
      '--panel': '#211a3d',
      '--panel-2': '#29214a',
      '--line': '#3e3268',
      '--text': '#f3e9ff',
      '--muted': '#9d8ec7',
      '--accent': '#ff77e1',
      '--accent-2': '#7af0ff',
      '--accent-3': '#a98bff',
      '--ok': '#8affd6',
      '--danger': '#ff7a9c',
      '--glow': '0 0 18px rgba(255,119,225,0.5)',
      '--app-bg': 'linear-gradient(160deg, rgba(255,119,225,0.12), rgba(122,240,255,0.1)), #120e1f',
    },
  },
  // ---- Ported from VRCOSC (2026.501.0) ----
  // Source: VRCOSC.App/UI/Themes/Dark.xaml + Light.xaml.
  {
    id: 'vrcosc-dark',
    name: 'VRCOSC Dark',
    blurb: 'Official VRCOSC dark palette',
    preview: ['#27AE60', '#2980B9', '#F1C40F'],
    dark: true,
    vars: {
      '--bg': '#0F0F0F',
      '--bg-2': '#141414',
      '--panel': '#1F1F1F',
      '--panel-2': '#292929',
      '--line': '#333333',
      '--text': '#FFFFFF',
      '--muted': '#BFBFBF',
      '--accent': '#27AE60',
      '--accent-2': '#2980B9',
      '--accent-3': '#F1C40F',
      '--ok': '#37D279',
      '--danger': '#C0392B',
      '--glow': '0 0 16px rgba(39,174,96,0.35)',
      '--app-bg': '#0F0F0F',
    },
  },
  {
    id: 'vrcosc-light',
    name: 'VRCOSC Light',
    blurb: 'Official VRCOSC light palette',
    preview: ['#27AE60', '#2980B9', '#E67E22'],
    dark: false,
    vars: {
      '--bg': '#F0F0F0',
      '--bg-2': '#EBEBEB',
      '--panel': '#E0E0E0',
      '--panel-2': '#D6D6D6',
      '--line': '#CCCCCC',
      '--text': '#000000',
      '--muted': '#404040',
      '--accent': '#27AE60',
      '--accent-2': '#2980B9',
      '--accent-3': '#E67E22',
      '--ok': '#37D279',
      '--danger': '#C0392B',
      '--glow': '0 0 14px rgba(41,128,185,0.25)',
      '--app-bg': '#F0F0F0',
    },
  },
];

export const DEFAULT_THEME_ID = 'synthwave';

export function themeById(id: string): Theme {
  const found = THEMES.find((t) => t.id === id);
  if (found) return found;
  // THEMES is non-empty (defined as a const literal in this file).
  return THEMES[0] as Theme;
}

/** Apply a theme's CSS variables to :root. */
export function applyTheme(id: string): void {
  const theme = themeById(id);
  const root = document.documentElement;
  for (const [k, v] of Object.entries(theme.vars)) {
    root.style.setProperty(k, v);
  }
}
