// VRChat chatbox character limit, mirrored on the renderer side
// so we don't have to import main-process code into the UI bundle.
export const OscManagerMax = 144;

/** Count by Unicode code points (matches how the OSC layer clamps). */
export function charLen(text: string): number {
  return Array.from(text).length;
}

/** Validate a chatbox string against VRChat's limit. */
export function validateLength(text: string): {
  len: number;
  over: boolean;
  remaining: number;
} {
  const len = charLen(text);
  return { len, over: len > OscManagerMax, remaining: OscManagerMax - len };
}
