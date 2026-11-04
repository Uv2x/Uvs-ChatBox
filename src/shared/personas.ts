// AI Personality Modes — preset "identity packs" the user can switch between.
//
// Each preset bundles together:
//   - phrasePack:       canned quick phrases written in that persona's voice
//   - voice:            TTS pitch/rate hints for browser SpeechSynthesis
//   - autoResponderText: replacement template for the existing AFK auto-responder
//   - statusVariants:   per-status-id text override (e.g. how AFK reads when this persona is active)
//   - systemPrompt:     reserved for future AI Companion integration; unused in
//                       the no-AI v1 but defined now so we don't need a data
//                       migration when the AI layer ships.
//
// Personas are pure data. Activating one is a single setting (activePersonaId)
// in AppSettings — the actual changes (quick phrases / auto-responder text) are
// applied opt-in via buttons in the UI so the user never has things rewritten
// behind their back.

import type { StatusId } from './core';

export interface PersonaVoice {
  /** -1..1 for SpeechSynthesisUtterance.pitch shifted from 1.0. */
  pitch: number;
  /** 0.1..10 for SpeechSynthesisUtterance.rate. ~1.0 is normal. */
  rate: number;
  /** 0..1 utterance volume. */
  volume: number;
  /** Optional preferred lang hint, e.g. "en-US". The renderer will pick the
   *  best matching installed Windows voice; if none match it falls back to
   *  the system default. */
  preferLang?: string;
  /** Ordered list of substrings to look for in the SpeechSynthesisVoice's
   *  `name`. The first hit wins. This is how we get a *different* voice per
   *  persona instead of one TTS voice with different pitches. Windows ships
   *  with at least Microsoft Zira/Eva/Hazel (female) and David/Mark (male);
   *  modern systems also have neural voices like Aria, Jenny, Guy, Ryan. */
  preferVoiceNames?: string[];
  /** Optional bias: 'male' | 'female' | undefined. Used as a tiebreaker when
   *  preferVoiceNames doesn't match any installed voice. The renderer infers
   *  gender from the voice name where possible. */
  preferGender?: 'male' | 'female';
}

export interface PersonaPhrase {
  label: string;
  text: string;
}

export interface PersonaPreset {
  id: string;
  name: string;
  icon: string;
  description: string;
  phrasePack: PersonaPhrase[];
  voice: PersonaVoice;
  autoResponderText: string;
  statusVariants: Partial<Record<StatusId, string>>;
  /** System prompt for the (future) AI Companion. Not used in v1. */
  systemPrompt: string;
}

const CHILL: PersonaPreset = {
  id: 'chill',
  name: 'Chill Assistant',
  icon: '🌙',
  description: 'Laid-back, warm, conversational. Soft TTS voice.',
  phrasePack: [
    { label: 'BRB', text: 'bbl, taking a break ☕' },
    { label: 'Hey', text: 'yo 👋' },
    { label: 'Vibes', text: 'just vibing 🌙' },
    { label: 'Sleep', text: 'off to bed 🌙' },
    { label: 'All good', text: 'all good fam' },
    { label: 'Zone', text: '🎧 in my zone' },
    { label: 'Quiet', text: 'low key, just hanging' },
    { label: 'Back', text: 'back from the void' },
  ],
  voice: {
    pitch: 0.95,
    rate: 0.95,
    volume: 1.0,
    preferLang: 'en-US',
    // Warm, calm, slightly low — try female neural / classic.
    preferVoiceNames: ['Aria', 'Jenny', 'Zira', 'Eva', 'Hazel'],
    preferGender: 'female',
  },
  autoResponderText: '💤 bbl, currently chilling',
  statusVariants: {
    afk: 'bbl, brain off',
    gaming: '🎮 chilling in game',
    music: '🎧 lo-fi hours',
    busy: 'deep focus, ping me later',
    available: 'around, slide in',
    talking: '🎙️ chatting',
    streaming: '🔴 chill stream',
  },
  systemPrompt:
    'You are a chill, laid-back companion. Reply in ≤140 characters. Casual tone, lowercase, light emoji okay. Never use exclamation marks aggressively.',
};

const STREAMER: PersonaPreset = {
  id: 'streamer',
  name: 'Streamer Assistant',
  icon: '🎙️',
  description: 'Hype, energetic, all-caps moments. Faster TTS voice.',
  phrasePack: [
    { label: 'LFG', text: "LET'S GOOO 🚀" },
    { label: 'GG', text: 'GG WP 🔥' },
    { label: 'POG', text: 'POGGERS 👀' },
    { label: 'Raid', text: 'RAID INCOMING!' },
    { label: 'Sub', text: 'thx for the sub <3' },
    { label: 'F', text: 'press F to pay respects' },
    { label: 'Hype', text: 'HYYYPE TRAIN 🚂' },
    { label: 'BRB', text: 'RAID BREAK — brb 5' },
  ],
  voice: {
    pitch: 1.05,
    rate: 1.1,
    volume: 1.0,
    preferLang: 'en-US',
    // Energetic, slightly higher — try male neural / classic.
    preferVoiceNames: ['Guy', 'Ryan', 'Mark', 'David'],
    preferGender: 'male',
  },
  autoResponderText: '🔴 RAID BREAK — back in 5!',
  statusVariants: {
    afk: '🔴 BRB stream break',
    gaming: "🎮 GAME ON. LET'S COOK",
    music: '🎶 stream playlist running',
    busy: "DON'T @ me right now",
    available: 'LIVE & READY',
    talking: '🎙️ ON AIR',
    streaming: '🔴 LIVE NOW',
  },
  systemPrompt:
    'You are an energetic streamer hype-man. Reply in ≤140 characters. Liberal caps for emphasis, gamer slang welcome (GG, POG, LFG, raid, sub). 1-2 emoji per line.',
};

const ANIME: PersonaPreset = {
  id: 'anime',
  name: 'Anime Companion',
  icon: '🌸',
  description: 'Kawaii, kaomoji, soft and bubbly. Higher-pitched TTS.',
  phrasePack: [
    { label: 'Hi', text: 'hewwo~ (◕ᴗ◕✿)' },
    { label: 'AFK', text: 'brb nya~ (=^･ω･^=)' },
    { label: 'OK', text: 'okie~ ٩(◕‿◕)۶' },
    { label: 'Sleepy', text: 'sleepy time~ (｡-ω-)zzz' },
    { label: 'Yay', text: 'sugoi~!! (☆▽☆)' },
    { label: 'Sad', text: 'huhu... (｡•́︿•̀｡)' },
    { label: 'Bye', text: 'bai bai~ (｡>‿‿<｡ )' },
    { label: 'Love', text: 'daisuki~ ♡(˃͈ દ ˂͈ ༝ )' },
    { label: 'Shy', text: 'baka... (>///<)' },
    { label: 'Pout', text: 'hmph! (｀ε´)' },
  ],
  voice: {
    pitch: 1.4,
    rate: 1.0,
    volume: 1.0,
    preferLang: 'en-US',
    // High-pitched bubbly — prefer Japanese voices if installed (Sayaka/Haruka/Ayumi),
    // fall back to bright female English voices.
    preferVoiceNames: ['Sayaka', 'Haruka', 'Ayumi', 'Nanami', 'Jenny', 'Zira'],
    preferGender: 'female',
  },
  autoResponderText: 'afk-desu~ ( ◜‿◝ )♡',
  statusVariants: {
    afk: 'afk-desu~ (｡•́︿•̀｡)',
    gaming: '🎮 game-chuu~ (ง •̀_•́)ง',
    music: '🎵 ongaku time~ ♪',
    busy: 'isogashii desu~ (＞﹏＜)',
    available: 'genki desu~ ♡',
    talking: '🎙️ ohanashi-chuu~',
    streaming: '🔴 haishin-chuu desu~',
  },
  systemPrompt:
    'You are a kawaii anime-style companion. Reply in ≤140 characters. Use kaomoji like (◕‿◕) or (≧▽≦), occasional Japanese loanwords (~desu, ne~, yatta). Friendly and bubbly. Never explicit.',
};

const CYBER: PersonaPreset = {
  id: 'cyber',
  name: 'Cyber AI',
  icon: '🤖',
  description: 'Synthetic, log-style, bracketed system messages. Robotic TTS.',
  phrasePack: [
    { label: 'Online', text: '[NODE] online' },
    { label: 'Offline', text: '[NODE] offline' },
    { label: 'Boot', text: '[INIT] boot sequence start' },
    { label: 'Scan', text: '[SCAN] perimeter clear' },
    { label: 'Error', text: '[ERR] retry' },
    { label: 'Sync', text: '[SYNC] queued' },
    { label: 'OK', text: '[ACK]' },
    { label: 'Wait', text: '[QUEUE] standby' },
  ],
  voice: {
    pitch: 0.7,
    rate: 1.05,
    volume: 1.0,
    preferLang: 'en-US',
    // Robotic monotone — prefer the deepest male voice available.
    preferVoiceNames: ['David', 'Mark', 'James'],
    preferGender: 'male',
  },
  autoResponderText: '[STATUS] offline · t+300s',
  statusVariants: {
    afk: '[STATUS] offline · idle',
    gaming: '[NODE] session active',
    music: '[AUDIO] stream running',
    busy: '[BUSY] do not interrupt',
    available: '[READY] await input',
    talking: '[VOX] active',
    streaming: '[BROADCAST] live',
  },
  systemPrompt:
    'You are a synthetic AI from a cyberpunk system. Reply in ≤140 characters. Use bracketed tags like [INIT], [STATUS], [ERR]. Terse, technical, no contractions. Lowercase outside brackets.',
};

const MINIMAL: PersonaPreset = {
  id: 'minimal',
  name: 'Minimal Mode',
  icon: '⚡',
  description: 'Terse, dry, no emoji. Default TTS voice.',
  phrasePack: [
    { label: 'K', text: 'k' },
    { label: 'AFK', text: 'afk' },
    { label: 'Back', text: 'back' },
    { label: 'Yes', text: 'y' },
    { label: 'No', text: 'n' },
    { label: 'Wait', text: '1s' },
    { label: 'Thanks', text: 'ty' },
    { label: 'Bye', text: 'bye' },
  ],
  voice: {
    pitch: 1.0,
    rate: 1.0,
    volume: 1.0,
    // No preference — uses the system default voice.
  },
  autoResponderText: 'afk',
  statusVariants: {
    afk: 'afk',
    gaming: 'in game',
    music: 'music',
    busy: 'busy',
    available: 'around',
    talking: 'talking',
    streaming: 'live',
  },
  systemPrompt:
    'You are minimal. Reply in ≤40 characters, lowercase, no emoji, no exclamations. Single sentence or fragment.',
};

const GOTH: PersonaPreset = {
  id: 'goth',
  name: 'Goth / Dark',
  icon: '🖤',
  description: 'Moody, melancholic, edgy. Low slow TTS voice.',
  phrasePack: [
    { label: 'Hi', text: "🖤 oh. it's you." },
    { label: 'AFK', text: '🥀 wandering the void' },
    { label: 'Tired', text: 'so tired of everything' },
    { label: 'Whatever', text: 'whatever. 🖤' },
    { label: 'Night', text: '🌑 embracing the dark' },
    { label: 'Mood', text: "feeling things i won't explain" },
    { label: 'Leave', text: 'fading away... 🥀' },
    { label: 'Cold', text: 'cold inside & out 🕸️' },
  ],
  voice: {
    pitch: 0.85,
    rate: 0.9,
    volume: 1.0,
    preferLang: 'en-US',
    preferVoiceNames: ['Hazel', 'Zira', 'Eva', 'Aria'],
    preferGender: 'female',
  },
  autoResponderText: '🥀 away, lost in thought',
  statusVariants: {
    afk: '🥀 drifting',
    gaming: '🎮 numbing the void',
    music: '🎧 sad songs only',
    busy: 'do not disturb the dark',
    available: 'here, reluctantly',
    talking: '🖤 speaking softly',
    streaming: '🔴 broadcasting the gloom',
  },
  systemPrompt:
    'You are a moody goth companion. Reply in ≤140 characters. Melancholic, poetic, lowercase, dark imagery (void, shadows, roses, rain). Occasional 🖤 🥀 🌑. Never genuinely cruel.',
};

const COZY: PersonaPreset = {
  id: 'cozy',
  name: 'Cozy / Soft',
  icon: '🧸',
  description: 'Warm, wholesome, comforting. Gentle TTS voice.',
  phrasePack: [
    { label: 'Hi', text: 'hi friend 🧸' },
    { label: 'AFK', text: '☕ making tea, brb' },
    { label: 'Warm', text: 'wrapped in blankets 🛋️' },
    { label: 'Care', text: "hope you're okay 💛" },
    { label: 'Sleep', text: 'goodnight, sleep well 🌙' },
    { label: 'Cuddle', text: 'sending warm hugs 🤗' },
    { label: 'Calm', text: 'take it slow today 🍂' },
    { label: 'Back', text: 'back & cozy 🕯️' },
  ],
  voice: {
    pitch: 1.05,
    rate: 0.92,
    volume: 1.0,
    preferLang: 'en-US',
    preferVoiceNames: ['Jenny', 'Aria', 'Zira', 'Eva'],
    preferGender: 'female',
  },
  autoResponderText: '☕ away making something warm',
  statusVariants: {
    afk: '☕ tea break',
    gaming: '🎮 comfy gaming',
    music: '🎵 soft tunes',
    busy: 'focusing gently, ping later 💛',
    available: 'here & cozy 🧸',
    talking: '🕯️ chatting softly',
    streaming: '🔴 cozy stream',
  },
  systemPrompt:
    'You are a warm, wholesome, comforting companion. Reply in ≤140 characters. Gentle, supportive, soft emoji (🧸 ☕ 💛 🌙). Make people feel safe and cared for.',
};

const GAMER: PersonaPreset = {
  id: 'gamer',
  name: 'Gamer / Tryhard',
  icon: '🎮',
  description: 'Competitive, sweaty, focused. Punchy TTS voice.',
  phrasePack: [
    { label: 'Queue', text: '🎮 in queue, lock in' },
    { label: 'Clutch', text: 'CLUTCH OR KICK 🔥' },
    { label: 'AFK', text: 'brb reloading irl' },
    { label: 'GG', text: 'gg ez 😎' },
    { label: 'Focus', text: '🎯 locked in, no talk' },
    { label: 'Ranked', text: 'grinding ranked, dont @' },
    { label: 'Win', text: 'VICTORY 🏆' },
    { label: 'Tilt', text: 'on tilt, one more game' },
  ],
  voice: {
    pitch: 1.0,
    rate: 1.1,
    volume: 1.0,
    preferLang: 'en-US',
    preferVoiceNames: ['Guy', 'Ryan', 'Mark', 'David'],
    preferGender: 'male',
  },
  autoResponderText: '🎮 mid-game, brb after this round',
  statusVariants: {
    afk: 'brb between games',
    gaming: '🎯 LOCKED IN',
    music: '🎧 hype playlist',
    busy: 'ranked grind — dont @ me',
    available: 'gg ready 😎',
    talking: '🎙️ comms open',
    streaming: '🔴 live grind',
  },
  systemPrompt:
    'You are a competitive gamer companion. Reply in ≤140 characters. Confident, punchy, gamer slang (clutch, lock in, gg, tilt, queue). 1 emoji max. Driven and focused.',
};

export const PERSONAS: PersonaPreset[] = [
  CHILL,
  STREAMER,
  ANIME,
  COZY,
  GOTH,
  GAMER,
  CYBER,
  MINIMAL,
];

export function getPersona(id: string | undefined): PersonaPreset | null {
  return PERSONAS.find((p) => p.id === id) ?? null;
}

/** Default active persona id used when settings haven't been initialized. */
export const DEFAULT_PERSONA_ID = 'chill';
