// Minimal Unicode font transform applied to every outgoing chatbox line.
// VRChat's chatbox font can't be changed via OSC, but we can swap ASCII
// letters for visually-different Unicode codepoints — VRChat then
// renders them with whatever glyph the chatbox font has for that
// codepoint.
//
// Three styles only:
//   - plain      : pass-through, ASCII unchanged
//   - small-caps : lowercase becomes small capitals (ʜᴇʟʟᴏ)
//   - fullwidth  : ASCII becomes the wide CJK-style range (ｈｅｌｌｏ)

export type FontStyle = 'plain' | 'small-caps' | 'fullwidth';

/** Lowercase → small-cap glyph mapping. Letters without a clean small-cap
 *  glyph (q, s, x) fall back to the original character so the text stays
 *  readable instead of producing weird Unicode substitutes. */
const SMALL_CAPS: Record<string, string> = {
  a: 'ᴀ',
  b: 'ʙ',
  c: 'ᴄ',
  d: 'ᴅ',
  e: 'ᴇ',
  f: 'ꜰ',
  g: 'ɢ',
  h: 'ʜ',
  i: 'ɪ',
  j: 'ᴊ',
  k: 'ᴋ',
  l: 'ʟ',
  m: 'ᴍ',
  n: 'ɴ',
  o: 'ᴏ',
  p: 'ᴘ',
  q: 'ǫ',
  r: 'ʀ',
  s: 's',
  t: 'ᴛ',
  u: 'ᴜ',
  v: 'ᴠ',
  w: 'ᴡ',
  x: 'x',
  y: 'ʏ',
  z: 'ᴢ',
};

/** Apply a font style transform. Pass-through for plain.
 *  Spaces, punctuation, emoji, and any non-ASCII pass through unchanged. */
export function transformFont(input: string, style: FontStyle): string {
  if (!input || style === 'plain') return input;

  if (style === 'small-caps') {
    return Array.from(input)
      .map((ch) => {
        const lower = ch.toLowerCase();
        return SMALL_CAPS[lower] ?? ch;
      })
      .join('');
  }

  // fullwidth: ASCII printable range → fullwidth block (U+FF01–U+FF5E).
  // Space is the ideographic space (U+3000) so spacing stays visually
  // consistent with the wide letters.
  return Array.from(input)
    .map((ch) => {
      const c = ch.codePointAt(0)!;
      if (c >= 0x21 && c <= 0x7e) return String.fromCodePoint(c + 0xfee0);
      if (c === 0x20) return '　';
      return ch;
    })
    .join('');
}
