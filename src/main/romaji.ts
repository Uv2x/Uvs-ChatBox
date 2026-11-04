// Kana → romaji converter for the live-lyrics feature.
//
// Scope: hiragana + katakana only. Kanji is left as-is (proper kanji→reading
// needs a morphological dictionary like kuromoji, which is ~15 MB and overkill
// for a chatbox). In practice many J-pop lyric lines are kana-heavy or fully
// kana, so this still adds real value. Latin, punctuation, and kanji pass
// through unchanged.
//
// Hepburn-ish romanization with digraphs (きゃ→kya), small-tsu gemination
// (がっこう→gakkou), and the prolonged-sound mark (ー→repeat last vowel).

const BASE: Record<string, string> = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o',
  か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko',
  が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go',
  さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so',
  ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
  た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
  だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do',
  な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no',
  は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
  ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
  ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo',
  や: 'ya', ゆ: 'yu', よ: 'yo',
  ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro',
  わ: 'wa', ゐ: 'wi', ゑ: 'we', を: 'wo', ん: 'n',
  ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o',
  ゃ: 'ya', ゅ: 'yu', ょ: 'yo', ゔ: 'vu',
};

// Digraphs: small-y kana following an -i syllable. Key is base + small.
const DIGRAPH: Record<string, string> = {
  きゃ: 'kya', きゅ: 'kyu', きょ: 'kyo',
  ぎゃ: 'gya', ぎゅ: 'gyu', ぎょ: 'gyo',
  しゃ: 'sha', しゅ: 'shu', しょ: 'sho',
  じゃ: 'ja', じゅ: 'ju', じょ: 'jo',
  ちゃ: 'cha', ちゅ: 'chu', ちょ: 'cho',
  にゃ: 'nya', にゅ: 'nyu', にょ: 'nyo',
  ひゃ: 'hya', ひゅ: 'hyu', ひょ: 'hyo',
  びゃ: 'bya', びゅ: 'byu', びょ: 'byo',
  ぴゃ: 'pya', ぴゅ: 'pyu', ぴょ: 'pyo',
  みゃ: 'mya', みゅ: 'myu', みょ: 'myo',
  りゃ: 'rya', りゅ: 'ryu', りょ: 'ryo',
};

/** Convert a single katakana char to its hiragana equivalent. Returns the
 *  char unchanged if it isn't katakana. */
function kataToHira(ch: string): string {
  const c = ch.codePointAt(0)!;
  // Katakana block U+30A1–U+30F6 maps to hiragana by -0x60.
  if (c >= 0x30a1 && c <= 0x30f6) return String.fromCodePoint(c - 0x60);
  return ch;
}

const SMALL_Y = new Set(['ゃ', 'ゅ', 'ょ']);

/** Romanize a string. Non-kana passes through unchanged. Returns the input
 *  verbatim when it contains no kana at all (caller can skip showing a
 *  redundant romaji line for pure-latin lyrics). */
export function toRomaji(input: string): string {
  if (!input) return input;
  // Normalize katakana → hiragana first so one table covers both.
  const chars = Array.from(input).map(kataToHira);
  let out = '';
  let lastVowel = '';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    const next = chars[i + 1] ?? '';

    // Prolonged sound mark — repeat the previous vowel.
    if (ch === 'ー') {
      out += lastVowel;
      continue;
    }
    // Small tsu — geminate the next syllable's leading consonant.
    if (ch === 'っ') {
      const peek = DIGRAPH[ch + next] ? DIGRAPH[ch + next] : BASE[next];
      if (peek) out += peek[0];
      continue;
    }
    // Digraph (i-row + small ya/yu/yo).
    if (SMALL_Y.has(next) && DIGRAPH[ch + next]) {
      const r = DIGRAPH[ch + next]!;
      out += r;
      lastVowel = r[r.length - 1]!;
      i++; // consumed the small-y too
      continue;
    }
    const r = BASE[ch];
    if (r) {
      out += r;
      lastVowel = r[r.length - 1]!;
    } else {
      out += ch; // kanji / latin / punctuation — unchanged
      lastVowel = '';
    }
  }
  return out;
}

/** True if the string contains any hiragana or katakana. */
export function hasKana(input: string): boolean {
  for (const ch of input) {
    const c = ch.codePointAt(0)!;
    if ((c >= 0x3041 && c <= 0x3096) || (c >= 0x30a1 && c <= 0x30fa)) return true;
  }
  return false;
}
