// Built-in status presets (mirrors the desktop app's set so it feels familiar).
// Tapping one sends its `text` to the chatbox.

export interface Status {
  id: string;
  label: string;
  icon: string;
  text: string;
}

export const STATUSES: Status[] = [
  { id: 'available', label: 'Available', icon: '🟢', text: '🟢 Available' },
  { id: 'afk', label: 'AFK', icon: '💤', text: '💤 AFK' },
  { id: 'busy', label: 'Busy', icon: '⛔', text: '⛔ Busy' },
  { id: 'talking', label: 'Talking', icon: '🗣️', text: '🎤 Talking' },
  { id: 'sleeping', label: 'Sleeping', icon: '😴', text: '😴 Sleeping — see you tomorrow' },
  { id: 'gaming', label: 'Gaming', icon: '🎮', text: '🎮 In Game' },
  { id: 'music', label: 'Music', icon: '🎵', text: '🎵 Listening to music' },
  { id: 'chilling', label: 'Chilling', icon: '😎', text: '😎 Just chilling' },
  { id: 'vibing', label: 'Vibing', icon: '🎧', text: '🎧 Vibing' },
  { id: 'brb', label: 'BRB', icon: '🏃', text: '🏃 BRB' },
  { id: 'lurking', label: 'Lurking', icon: '👀', text: '👀 Lurking' },
  { id: 'newfriends', label: 'New Friends', icon: '🤝', text: '🤝 New friends welcome!' },
  { id: 'cuddles', label: 'Cuddles', icon: '🫂', text: '🫂 Cuddle pile' },
  { id: 'photo', label: 'Photography', icon: '📸', text: '📸 Taking photos' },
  { id: 'exploring', label: 'Exploring', icon: '🗺️', text: '🗺️ Exploring worlds' },
  { id: 'dancing', label: 'Dancing', icon: '💃', text: '💃 Dancing' },
  { id: 'karaoke', label: 'Karaoke', icon: '🎶', text: '🎶 Karaoke night' },
  { id: 'movie', label: 'Movie Night', icon: '🍿', text: '🍿 Movie night' },
  { id: 'eating', label: 'Eating', icon: '🍔', text: '🍔 Eating — brb' },
  { id: 'drink', label: 'Getting a Drink', icon: '☕', text: '☕ Getting a drink' },
  { id: 'tired', label: 'Tired', icon: '🥱', text: '🥱 Tired' },
  { id: 'dnd', label: 'Do Not Disturb', icon: '🚫', text: '🚫 Do Not Disturb' },
  { id: 'meditating', label: 'Meditating', icon: '🧘', text: '🧘 Meditating' },
];
