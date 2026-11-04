// Unicode progress bars for the Now-Playing chatbox line.
//
// Lives in shared/ because both sides consume it: the main-process formatter
// renders the real bar into the chatbox ({bar} token), and the renderer's
// Spotify panel renders a live preview of each style.
//
// Width is in "segments" (not chars): styles with a knob/arrow head add one
// extra glyph, brackets add two. All glyphs are single code points, and the
// OSC layer counts code points for the 144 cap, so budget stays predictable.

export type BarStyle = 'knob' | 'blocks' | 'dots' | 'arrow' | 'brackets' | 'moons';

export const BAR_STYLES: { id: BarStyle; label: string }[] = [
  { id: 'knob', label: 'Knob  ▬▬▬🔘▬▬' },
  { id: 'blocks', label: 'Blocks  ████░░░' },
  { id: 'dots', label: 'Dots  ●●●●○○○' },
  { id: 'arrow', label: 'Arrow  ━━━➤╌╌╌' },
  { id: 'brackets', label: 'Brackets  [▰▰▰▱▱]' },
  { id: 'moons', label: 'Moons  🌕🌕🌗🌑🌑' },
];

/** Seconds → "m:ss". */
export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** Render a progress bar at `fraction` (0..1) in the given style. */
export function renderBar(fraction: number, style: BarStyle, width: number): string {
  const w = Math.max(3, Math.min(20, Math.floor(width) || 8));
  const f = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  const i = Math.round(f * w);
  switch (style) {
    case 'blocks':
      return '█'.repeat(i) + '░'.repeat(w - i);
    case 'dots':
      return '●'.repeat(i) + '○'.repeat(w - i);
    case 'arrow':
      return '━'.repeat(i) + '➤' + '╌'.repeat(w - i);
    case 'brackets':
      return '[' + '▰'.repeat(i) + '▱'.repeat(w - i) + ']';
    case 'moons': {
      // Fractional cell gets a phase glyph, so the bar "waxes" smoothly.
      const exact = f * w;
      const full = Math.floor(exact);
      const rem = exact - full;
      let out = '🌕'.repeat(full);
      if (full < w) {
        out += rem >= 0.75 ? '🌖' : rem >= 0.5 ? '🌗' : rem >= 0.25 ? '🌘' : '🌑';
        out += '🌑'.repeat(w - full - 1);
      }
      return out;
    }
    case 'knob':
    default:
      return '▬'.repeat(i) + '🔘' + '▬'.repeat(w - i);
  }
}
