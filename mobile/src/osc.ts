// OSC encoding + UDP send for VRChat's chatbox.
//
// VRChat chatbox OSC (same as the desktop app uses):
//   /chatbox/input  (string text, bool sendImmediately, bool notifySound)
//   /chatbox/typing (bool)
//
// The bytes are built here in TS (fully testable) and handed to the native
// `OscUdp` Capacitor plugin (native/OscUdpPlugin.swift) as base64, which fires
// a UDP datagram at the headset over WiFi. On the web (dev preview on a
// desktop browser) there's no UDP, so send() no-ops with a console note.

import { registerPlugin, Capacitor } from '@capacitor/core';

export interface OscUdpPlugin {
  send(opts: { host: string; port: number; dataBase64: string }): Promise<void>;
}

const OscUdp = registerPlugin<OscUdpPlugin>('OscUdp');

// ---- OSC wire format ------------------------------------------------------

/** OSC strings are null-terminated and padded with NULs to a 4-byte boundary. */
function oscString(s: string): Uint8Array {
  const utf8 = new TextEncoder().encode(s);
  const len = utf8.length + 1; // +1 for the terminating NUL
  const padded = Math.ceil(len / 4) * 4;
  const out = new Uint8Array(padded); // zero-filled → NUL terminator + padding
  out.set(utf8, 0);
  return out;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

export type OscArg = { s: string } | { b: boolean };

/** Build a complete OSC message. Booleans are encoded purely in the type tag
 *  (T/F) with no payload bytes, per the OSC 1.0 spec — which is exactly what
 *  VRChat expects for the chatbox bool args. */
export function encodeOsc(address: string, args: OscArg[]): Uint8Array {
  let tags = ',';
  const data: Uint8Array[] = [];
  for (const a of args) {
    if ('s' in a) {
      tags += 's';
      data.push(oscString(a.s));
    } else {
      tags += a.b ? 'T' : 'F'; // no data bytes
    }
  }
  return concat([oscString(address), oscString(tags), ...data]);
}

export function chatboxInput(text: string, sendImmediately = true, notify = false): Uint8Array {
  return encodeOsc('/chatbox/input', [{ s: text }, { b: sendImmediately }, { b: notify }]);
}

export function chatboxTyping(typing: boolean): Uint8Array {
  return encodeOsc('/chatbox/typing', [{ b: typing }]);
}

// ---- transport ------------------------------------------------------------

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

/** Fire a pre-encoded OSC packet at host:port over UDP. */
export async function sendOsc(host: string, port: number, packet: Uint8Array): Promise<void> {
  if (Capacitor.getPlatform() === 'web') {
    // No UDP in a browser — this path is only hit during desktop dev preview.
    console.info(`[osc] (web no-op) would send ${packet.length}B to ${host}:${port}`);
    return;
  }
  await OscUdp.send({ host, port, dataBase64: toBase64(packet) });
}

export async function sendChatbox(
  host: string,
  port: number,
  text: string,
  opts: { immediate?: boolean; notify?: boolean } = {},
): Promise<void> {
  await sendOsc(host, port, chatboxInput(text, opts.immediate ?? true, opts.notify ?? false));
}
