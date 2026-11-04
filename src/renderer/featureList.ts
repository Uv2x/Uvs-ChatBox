// Single source of truth for the Features sidebar list. Imported by App
// (renders the sidebar sub-nav) and Settings (feature-order editor) so the
// two never drift out of sync.

export interface FeatureMeta {
  id: string;
  label: string;
  icon: string;
}

export const FEATURE_MODULES: ReadonlyArray<FeatureMeta> = [
  { id: 'audio', label: 'Mute / Deaf Alert', icon: '🔇' },
  { id: 'afk', label: 'Smart AFK', icon: '💤' },
  { id: 'media', label: 'Spotify', icon: '🎵' },
  { id: 'clock', label: 'Clock', icon: '🕐' },
  { id: 'timezones', label: 'Timezones', icon: '🌍' },
  { id: 'custom', label: 'Custom Text', icon: '💭' },
  { id: 'stt', label: 'Speech-to-Text', icon: '🎙️' },
  { id: 'pc', label: 'PC Components', icon: '🖥️' },
  { id: 'network', label: 'Network', icon: '🌐' },
  { id: 'persona', label: 'AI Personality', icon: '🎭' },
  { id: 'weather', label: 'Weather', icon: '🌤️' },
  { id: 'voice', label: 'Voice Commands', icon: '🗣️' },
  { id: 'clips', label: 'ChatBox Clips', icon: '🎬' },
  { id: 'whisper', label: 'Whisper STT', icon: '🎙️' },
  { id: 'battery', label: 'Battery', icon: '🔋' },
  { id: 'session', label: 'Session Timer', icon: '⏱️' },
  { id: 'vrnotify', label: 'VR Notifications', icon: '🔔' },
  { id: 'vroverlay', label: 'VR Overlay', icon: '🎛️' },
  { id: 'discord', label: 'Discord Presence', icon: '💬' },
];

/** Apply a saved order (array of ids) to the feature list. Ids present in
 *  `order` come first in that order; anything missing falls to the end in
 *  natural order, so newly-added features still show up. */
export function orderedFeatures(order: string[] | undefined): FeatureMeta[] {
  const byId = new Map(FEATURE_MODULES.map((m) => [m.id, m]));
  const out: FeatureMeta[] = [];
  for (const id of order ?? []) {
    const m = byId.get(id);
    if (m) {
      out.push(m);
      byId.delete(id);
    }
  }
  for (const m of FEATURE_MODULES) if (byId.has(m.id)) out.push(m);
  return out;
}
