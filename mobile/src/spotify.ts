// Spotify "now playing" via the Spotify Web API (Authorization Code + PKCE).
//
// iOS can't read what Spotify is playing system-wide (Apple blocks that for
// third-party apps), so instead we ask Spotify's own servers: this works no
// matter where playback happens (even on the headset). It needs a one-time
// login and a free Spotify app id the user creates.
//
// Flow:
//   connect()        -> open Spotify's authorize page (PKCE, no client secret)
//   handleRedirect() -> app deep-link comes back with ?code, we exchange it
//   getCurrentTrack()-> GET /me/player/currently-playing (auto-refreshes token)
//
// All HTTP goes through CapacitorHttp so it's a NATIVE request on device (no
// browser CORS). On the web dev preview these calls will CORS-fail, which is
// fine — real auth only happens on the phone.
//
// NOTE (Spotify, 2026): "development mode" apps require a Spotify Premium
// account. Register the app at developer.spotify.com and add the redirect URI
// below exactly.

import { CapacitorHttp } from '@capacitor/core';
import { Browser } from '@capacitor/browser';

const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const NOW_URL = 'https://api.spotify.com/v1/me/player/currently-playing';
export const REDIRECT_URI = 'uvschatbox://spotify-callback';
const SCOPE = 'user-read-currently-playing';

const K = {
  client: 'spotify.clientId',
  access: 'spotify.access',
  refresh: 'spotify.refresh',
  exp: 'spotify.exp',
  verifier: 'spotify.verifier',
};

function get(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function set(k: string, v: string | null): void {
  try {
    if (v == null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
}

function base64url(bytes: ArrayBuffer): string {
  let bin = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomVerifier(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const arr = new Uint8Array(64);
  crypto.getRandomValues(arr);
  let out = '';
  for (let i = 0; i < arr.length; i++) out += chars[arr[i]! % chars.length];
  return out;
}

async function challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(digest);
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

export function getClientId(): string {
  return get(K.client) ?? '';
}
export function isConnected(): boolean {
  return !!get(K.refresh);
}

export async function connect(clientId: string): Promise<void> {
  const id = clientId.trim();
  set(K.client, id);
  const verifier = randomVerifier();
  set(K.verifier, verifier);
  const params = new URLSearchParams({
    client_id: id,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge: await challenge(verifier),
    scope: SCOPE,
  });
  await Browser.open({ url: `${AUTH_URL}?${params.toString()}` });
}

function storeTokens(d: TokenResponse): void {
  if (d.access_token) set(K.access, d.access_token);
  if (d.refresh_token) set(K.refresh, d.refresh_token);
  set(K.exp, String(Date.now() + (d.expires_in ?? 3600) * 1000 - 60_000));
}

/** Called when the app is re-opened via the uvschatbox://spotify-callback URL. */
export async function handleRedirect(url: string): Promise<boolean> {
  try {
    await Browser.close();
  } catch {
    /* ignore */
  }
  const query = url.split('?')[1] ?? '';
  const code = new URLSearchParams(query).get('code');
  const verifier = get(K.verifier);
  const clientId = getClientId();
  if (!code || !verifier || !clientId) return false;
  const res = await CapacitorHttp.post({
    url: TOKEN_URL,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    data: {
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      code_verifier: verifier,
    },
  });
  set(K.verifier, null);
  if (res.status !== 200) return false;
  storeTokens(res.data as TokenResponse);
  return true;
}

async function refresh(): Promise<boolean> {
  const rt = get(K.refresh);
  const clientId = getClientId();
  if (!rt || !clientId) return false;
  const res = await CapacitorHttp.post({
    url: TOKEN_URL,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    data: { grant_type: 'refresh_token', refresh_token: rt, client_id: clientId },
  });
  if (res.status !== 200) return false;
  storeTokens(res.data as TokenResponse);
  return true;
}

async function accessToken(): Promise<string | null> {
  const exp = Number(get(K.exp) ?? 0);
  if (!get(K.access) || Date.now() > exp) {
    if (!(await refresh())) return null;
  }
  return get(K.access);
}

export interface NowPlaying {
  title: string;
  artist: string;
  playing: boolean;
}

export async function getCurrentTrack(): Promise<NowPlaying | null> {
  const t = await accessToken();
  if (!t) return null;
  const res = await CapacitorHttp.get({ url: NOW_URL, headers: { Authorization: `Bearer ${t}` } });
  if (res.status === 204 || res.status !== 200 || !res.data) return null; // 204 = nothing playing
  const d = res.data as {
    is_playing?: boolean;
    item?: { name?: string; artists?: { name?: string }[] };
  };
  if (!d.item) return null;
  const artist = (d.item.artists ?? []).map((a) => a.name ?? '').filter(Boolean).join(', ');
  return { title: d.item.name ?? '', artist, playing: !!d.is_playing };
}

export function disconnect(): void {
  set(K.access, null);
  set(K.refresh, null);
  set(K.exp, null);
  set(K.verifier, null);
}
