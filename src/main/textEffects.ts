// Markdown-ish Unicode text effects for the chatbox.
//
// VRChat's chatbox font can't be styled, but we can substitute ASCII letters
// for the Unicode Mathematical Alphanumeric Symbols block, which renders as
// bold / italic glyphs in most fonts. So `*hi*` becomes 𝗵𝗶, `_hi_` becomes
// 𝘩𝘪, `~hi~` gets a combining strikethrough.
//
// Applied at the OSC send chokepoint (opt-in via settings.chatboxMarkdown) so
// every path — manual, phrase, status, AI, lyrics — picks it up uniformly.

/** Map a single ASCII letter/digit to an offset Unicode math-alphanumeric
 *  block. Returns the original char when there's no mapping. */
function mapChar(ch: string, upperBase: number, lowerBase: number, digitBase?: number): string {
  const c = ch.codePointAt(0)!;
  if (c >= 0x41 && c <= 0x5a) return String.fromCodePoint(upperBase + (c - 0x41)); // A-Z
  if (c >= 0x61 && c <= 0x7a) return String.fromCodePoint(lowerBase + (c - 0x61)); // a-z
  if (digitBase != null && c >= 0x30 && c <= 0x39) return String.fromCodePoint(digitBase + (c - 0x30));
  return ch;
}

function toBold(s: string): string {
  // Mathematical Sans-Serif Bold: A=U+1D5D4, a=U+1D5EE, 0=U+1D7EC.
  return Array.from(s).map((ch) => mapChar(ch, 0x1d5d4, 0x1d5ee, 0x1d7ec)).join('');
}

function toItalic(s: string): string {
  // Mathematical Sans-Serif Italic: A=U+1D608, a=U+1D622 (no digit variants).
  return Array.from(s).map((ch) => mapChar(ch, 0x1d608, 0x1d622)).join('');
}

function toStrike(s: string): string {
  // Combine each char with U+0336 (long stroke overlay).
  return Array.from(s).map((ch) => ch + '̶').join('');
}

/** Apply *bold*, _italic_, ~strike~ markers. Markers must wrap a run of
 *  non-marker, non-space-bounded text. Unmatched markers are left as-is. */
export function applyTextEffects(input: string): string {
  if (!input) return input;
  let out = input;
  // Order matters: bold/italic substitute into non-ASCII (so later passes
  // won't re-match them), strike adds combiners.
  out = out.replace(/\*([^*\n]+)\*/g, (_, t: string) => toBold(t));
  out = out.replace(/_([^_\n]+)_/g, (_, t: string) => toItalic(t));
  out = out.replace(/~([^~\n]+)~/g, (_, t: string) => toStrike(t));
  return out;
}
