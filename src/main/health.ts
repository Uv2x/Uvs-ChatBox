// System Check — one place that answers "why isn't X working?".
//
// Each check returns ok / warn / error / off plus a plain-English fix. Checks
// run in parallel, each with a timeout, so one slow service can't hang the
// page. Several real bugs in this app looked like "the app is broken" until
// dug into by hand (an LRCLib outage, another OSC app stealing port 9001,
// a disabled VRChat OSC setting) — this surfaces all of them at a glance.
//
// Everything here is read-only: in-memory state from the services, plus
// tasklist / netstat queries and a couple of small HTTPS probes.

import { execFile } from 'child_process';
import type { AppSettings, HealthCheck, QuestAdbState } from '../shared/types';
import type { LyricsStatus } from './lyrics';
import { findRuntimeDir } from './vrActivity';

export interface HealthContext {
  settings: AppSettings;
  osc: {
    target: string;
    targetIp: string;
    listenPort: number;
    listening: boolean;
    listenError: string;
    lastInboundAt: number;
    totalSent: number;
  };
  liveRunning: boolean;
  weatherEnabled: boolean;
  overlayRunning: boolean;
  discordStatus: () => { state: string; error: string };
  probeLyrics: () => Promise<LyricsStatus>;
  probeWeather: () => Promise<{ available: boolean; city?: string }>;
  rescanAdb: () => Promise<QuestAdbState>;
  questBatteryWanted: boolean;
  pingHost: (ip: string) => Promise<{ reachable: boolean; ms: number | null }>;
  updates: () => Promise<Omit<HealthCheck, 'id' | 'label'>>;
}

const CHECK_TIMEOUT_MS = 10_000;

// ---- small system helpers -------------------------------------------------

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 8000 }, (_err, stdout) =>
      resolve(String(stdout || '')),
    );
  });
}

async function processRunning(image: string): Promise<boolean> {
  const out = await run('tasklist', ['/FI', `IMAGENAME eq ${image}`, '/FO', 'CSV', '/NH']);
  return out.toLowerCase().includes(image.toLowerCase());
}

/** Other processes bound to a UDP port. node-osc binds with reuseAddr, so a
 *  second OSC app on the same port binds fine — and silently takes VRChat's
 *  messages away from one of the two. */
async function udpPortOwners(port: number): Promise<string[]> {
  const [net, tasks] = await Promise.all([
    run('netstat', ['-ano', '-p', 'udp']),
    run('tasklist', ['/FO', 'CSV', '/NH']),
  ]);
  const pids = new Set<number>();
  for (const line of net.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] !== 'UDP' || parts.length < 4) continue;
    const local = parts[1] ?? '';
    const localPort = Number(local.slice(local.lastIndexOf(':') + 1));
    const pid = Number(parts[parts.length - 1]);
    if (localPort === port && pid && pid !== process.pid) pids.add(pid);
  }
  const names = new Map<number, string>();
  for (const line of tasks.split(/\r?\n/)) {
    const m = line.match(/^"([^"]+)","(\d+)"/);
    if (m) names.set(Number(m[2]), m[1]!);
  }
  return [...pids].map((pid) => names.get(pid) ?? `PID ${pid}`);
}

async function internetOk(): Promise<boolean> {
  for (const url of ['https://www.google.com/generate_204', 'https://1.1.1.1/cdn-cgi/trace']) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (r.status < 500) return true;
    } catch {
      /* try the next one */
    }
  }
  return false;
}

function ago(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 90 ? `${s}s` : `${Math.round(s / 60)}m`;
}

function isLocal(ip: string): boolean {
  const h = (ip || '').trim().toLowerCase();
  return h === '' || h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '0.0.0.0';
}

function withTimeout(id: string, label: string, p: Promise<HealthCheck>): Promise<HealthCheck> {
  return Promise.race([
    p.catch((e: unknown) => ({
      id,
      label,
      status: 'warn' as const,
      detail: `Check failed: ${(e as Error)?.message ?? e}`,
    })),
    new Promise<HealthCheck>((resolve) =>
      setTimeout(
        () => resolve({ id, label, status: 'warn', detail: 'Check timed out — try again' }),
        CHECK_TIMEOUT_MS,
      ),
    ),
  ]);
}

// ---- the checks -----------------------------------------------------------

export async function runSystemCheck(ctx: HealthContext): Promise<HealthCheck[]> {
  const s = ctx.settings;
  const o = ctx.osc;
  const remote = !isLocal(o.targetIp);
  const vrchatP = remote ? Promise.resolve(false) : processRunning('VRChat.exe');

  const checks: Array<[string, string, () => Promise<HealthCheck>]> = [
    [
      'internet',
      'Internet',
      async () =>
        (await internetOk())
          ? { id: 'internet', label: 'Internet', status: 'ok', detail: 'Connected' }
          : {
              id: 'internet',
              label: 'Internet',
              status: 'error',
              detail: "Can't reach the internet",
              fix: 'Lyrics, weather and updates need a connection. Check your network.',
            },
    ],
    [
      'vrchat',
      'VRChat',
      async () => {
        if (remote) {
          return {
            id: 'vrchat',
            label: 'VRChat',
            status: 'off',
            detail: `Not needed on this PC — sending to a headset at ${o.targetIp}`,
          };
        }
        return (await vrchatP)
          ? { id: 'vrchat', label: 'VRChat', status: 'ok', detail: 'Running' }
          : {
              id: 'vrchat',
              label: 'VRChat',
              status: 'off',
              detail: 'Not running — start it to test the connection',
            };
      },
    ],
    [
      'osc_out',
      'App → VRChat (chatbox)',
      async () => {
        const id = 'osc_out';
        const label = 'App → VRChat (chatbox)';
        if (remote) {
          const p = await ctx.pingHost(o.targetIp);
          return p.reachable
            ? {
                id,
                label,
                status: 'ok',
                detail: `Sending to ${o.target} — headset answers (${p.ms ?? '?'} ms)`,
              }
            : {
                id,
                label,
                status: 'error',
                detail: `Can't reach the headset at ${o.targetIp}`,
                fix: "Same Wi-Fi as the headset? Is it awake? Check the IP matches VRChat's OSC settings on the headset.",
              };
        }
        return (await vrchatP)
          ? {
              id,
              label,
              status: 'ok',
              detail: `Sending to ${o.target} · ${o.totalSent} messages this session`,
            }
          : { id, label, status: 'off', detail: 'Start VRChat to test' };
      },
    ],
    [
      'osc_in',
      'VRChat → App (mute, AFK, params)',
      async () => {
        const id = 'osc_in';
        const label = 'VRChat → App (mute, AFK, params)';
        if (o.listenError) {
          return {
            id,
            label,
            status: 'error',
            detail: `Can't listen on port ${o.listenPort}: ${o.listenError}`,
            fix: 'Change the Listen port on the Connection tab, or close the app using it.',
          };
        }
        if (remote) {
          return {
            id,
            label,
            status: 'off',
            detail: "Standalone headset — VRChat there doesn't send OSC back to this PC (normal)",
          };
        }
        if (!(await vrchatP)) return { id, label, status: 'off', detail: 'Start VRChat to test' };
        const since = Date.now() - o.lastInboundAt;
        if (o.lastInboundAt && since < 5 * 60_000) {
          return { id, label, status: 'ok', detail: `Receiving · last message ${ago(since)} ago` };
        }
        if (o.lastInboundAt) {
          return {
            id,
            label,
            status: 'warn',
            detail: `Quiet for ${ago(since)}`,
            fix: 'Move your avatar or toggle mute in VRChat, then re-check.',
          };
        }
        const others = await udpPortOwners(o.listenPort);
        if (others.length) {
          return {
            id,
            label,
            status: 'error',
            detail: `Nothing received — ${others.join(', ')} also listens on port ${o.listenPort}`,
            fix: "Only one app gets VRChat's messages. Close the other app, or give it a different port.",
          };
        }
        return {
          id,
          label,
          status: 'error',
          detail: 'VRChat is running but sends nothing to this app',
          fix: 'In VRChat: Action Menu → Options → OSC → Enabled. If it already is, use OSC → Reset Config.',
        };
      },
    ],
    [
      'live',
      'Live updates',
      async () =>
        ctx.liveRunning
          ? { id: 'live', label: 'Live updates', status: 'ok', detail: 'Running' }
          : {
              id: 'live',
              label: 'Live updates',
              status: 'off',
              detail: 'Stopped — press Start Live Updates (or turn on Auto-start with VRChat)',
            },
    ],
    [
      'lyrics',
      'Lyrics source (LRCLib)',
      async () => {
        const id = 'lyrics';
        const label = 'Lyrics source (LRCLib)';
        if (!s.liveLyrics?.enabled)
          return { id, label, status: 'off', detail: 'Live lyrics are off' };
        const st = await ctx.probeLyrics();
        return st.available
          ? { id, label, status: 'ok', detail: 'LRCLib is responding' }
          : {
              id,
              label,
              status: 'error',
              detail: `LRCLib isn't responding (${st.error || 'unknown'})`,
              fix: 'Usually an outage on their end. Lyrics come back on their own when it recovers.',
            };
      },
    ],
    [
      'weather',
      'Weather',
      async () => {
        if (!ctx.weatherEnabled) {
          return { id: 'weather', label: 'Weather', status: 'off', detail: 'Weather is off' };
        }
        const w = await ctx.probeWeather();
        return w.available
          ? { id: 'weather', label: 'Weather', status: 'ok', detail: `Working (${w.city ?? '—'})` }
          : {
              id: 'weather',
              label: 'Weather',
              status: 'error',
              detail: "Couldn't get the weather",
              fix: 'Check the city in the Weather panel, and your internet connection.',
            };
      },
    ],
    [
      'discord',
      'Discord presence',
      async () => {
        const id = 'discord';
        const label = 'Discord presence';
        if (!s.discord?.enabled)
          return { id, label, status: 'off', detail: 'Discord presence is off' };
        const d = ctx.discordStatus();
        switch (d.state) {
          case 'connected':
            return { id, label, status: 'ok', detail: 'Connected — presence is live' };
          case 'connecting':
            return { id, label, status: 'warn', detail: 'Connecting…' };
          case 'no-client':
            return {
              id,
              label,
              status: 'error',
              detail: "Discord desktop app isn't running",
              fix: 'Open the Discord app on this PC.',
            };
          case 'invalid-id':
            return {
              id,
              label,
              status: 'error',
              detail: 'Invalid Discord Application ID',
              fix: 'Check the ID in Features → Discord Presence.',
            };
          default:
            return {
              id,
              label,
              status: 'error',
              detail: `Not connected${d.error ? ` (${d.error})` : ''} — retrying`,
            };
        }
      },
    ],
    [
      'steamvr',
      'SteamVR',
      async () => {
        if (!(await findRuntimeDir())) {
          return {
            id: 'steamvr',
            label: 'SteamVR',
            status: 'off',
            detail:
              'Not installed (only needed for the VR overlay, VR notifications and headset battery)',
          };
        }
        return (await processRunning('vrserver.exe'))
          ? { id: 'steamvr', label: 'SteamVR', status: 'ok', detail: 'Running' }
          : { id: 'steamvr', label: 'SteamVR', status: 'off', detail: 'Installed, not running' };
      },
    ],
    [
      'overlay',
      'VR overlay',
      async () => {
        if (!s.vrOverlay?.enabled) {
          return { id: 'overlay', label: 'VR overlay', status: 'off', detail: 'VR overlay is off' };
        }
        return ctx.overlayRunning
          ? { id: 'overlay', label: 'VR overlay', status: 'ok', detail: 'Running' }
          : {
              id: 'overlay',
              label: 'VR overlay',
              status: 'error',
              detail: 'Enabled but not running',
              fix: 'Start SteamVR, then turn the overlay off and on in Features → VR Overlay.',
            };
      },
    ],
    [
      'quest_battery',
      'Quest battery (adb)',
      async () => {
        const id = 'quest_battery';
        const label = 'Quest battery (adb)';
        if (!ctx.questBatteryWanted)
          return { id, label, status: 'off', detail: 'Battery feature is off' };
        const a = await ctx.rescanAdb();
        switch (a.state) {
          case 'ok':
            return {
              id,
              label,
              status: 'ok',
              detail: `Headset ${a.percent}%${a.charging ? ' ⚡' : ''}`,
            };
          case 'unauthorized':
            return {
              id,
              label,
              status: 'error',
              detail: 'Quest is waiting for you to allow USB debugging',
              fix: 'Put the headset on and tap Allow.',
            };
          case 'no-device':
            return {
              id,
              label,
              status: 'warn',
              detail: 'No Quest connected over USB',
              fix: 'Plug in the Link cable (Developer Mode must be on).',
            };
          case 'no-adb':
            return {
              id,
              label,
              status: 'warn',
              detail: 'adb is not installed',
              fix: 'See Features → Battery for the one-time setup.',
            };
          default:
            return { id, label, status: 'error', detail: a.detail || 'adb error' };
        }
      },
    ],
    [
      'ai',
      'AI (Claude)',
      async () => {
        if (!s.ai?.enabled)
          return { id: 'ai', label: 'AI (Claude)', status: 'off', detail: 'AI is off' };
        return s.ai.apiKey?.trim()
          ? {
              id: 'ai',
              label: 'AI (Claude)',
              status: 'ok',
              detail: 'API key set (not test-called here — that would use API credits)',
            }
          : {
              id: 'ai',
              label: 'AI (Claude)',
              status: 'error',
              detail: 'AI is on but has no API key',
              fix: 'Add your Anthropic API key in Settings → AI.',
            };
      },
    ],
    [
      'updates',
      'App updates',
      async () => ({ id: 'updates', label: 'App updates', ...(await ctx.updates()) }),
    ],
  ];

  return Promise.all(checks.map(([id, label, fn]) => withTimeout(id, label, fn())));
}
