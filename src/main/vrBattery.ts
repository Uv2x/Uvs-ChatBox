// SteamVR device-battery probe (HMD / controllers / trackers).
//
// Reads the standard OpenVR battery properties — the same approach VRCOSC and
// MagicChatbox use: a device counts only when Prop_DeviceProvidesBatteryStatus
// says it reports battery AND Prop_DeviceBatteryPercentage reads back without
// an error. Quest Touch controllers over Link answer UnknownProperty, so they
// are left out instead of showing a fake 0% (which also fired false
// low-battery toasts). The Quest headset itself does report over Link.
//
// Runs through a long-lived PowerShell + inline-C# helper (psHelper.ts,
// compiled once) that answers one JSON line per request. Each request
// still attaches to SteamVR as a Background app and detaches again, so a
// SteamVR shutdown is never held up by us. ONLY works while SteamVR runs.
//
// FnTable indices are for the IVRSystem_022 table we request (checked against
// Valve's openvr_api.cs; the activity probe keys off 15): 18 =
// GetControllerRoleForTrackedDeviceIndex, 19 = GetTrackedDeviceClass, 20 =
// IsTrackedDeviceConnected, 21 = GetBool…, 22 = GetFloat…, 27 = GetString….
//
// Names: controllers use their Left/Right role; trackers use the body role
// set in SteamVR → Manage Trackers (steamvr.vrsettings "trackers", keyed by
// serial), falling back to SlimeVR's "human://LEFT_FOOT" style serials.

import { promises as fsp } from 'fs';
import path from 'path';
import log from 'electron-log';
import type { BatteryDevice, BatteryStatus } from '../shared/types';
import { PsJsonHelper } from './psHelper';
import { findRuntimeDir } from './vrActivity';

const CS_SOURCE = String.raw`
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.IO;
public static class UvVrBat {
  [DllImport("openvr_api.dll", CharSet = CharSet.Ansi)]
  static extern uint VR_InitInternal2(out int peError, int eApplicationType, string startup);
  [DllImport("openvr_api.dll", CharSet = CharSet.Ansi)]
  static extern IntPtr VR_GetGenericInterface(string version, out int peError);
  [DllImport("openvr_api.dll")] static extern void VR_ShutdownInternal();
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern IntPtr LoadLibraryEx(string lpFileName, IntPtr hReservedNull, uint dwFlags);

  const int APP_TYPE = 3; // Background — read-only, never launches SteamVR or fights VRChat.
  const uint LOAD_WITH_ALTERED_SEARCH_PATH = 0x00000008;
  const int MAX_DEVICES = 64;
  // ETrackedDeviceProperty values from Valve's openvr_api.cs.
  const int PROP_SERIAL = 1002;           // Prop_SerialNumber_String
  const int PROP_IS_CHARGING = 1011;      // Prop_DeviceIsCharging_Bool
  const int PROP_BATTERY_PCT = 1012;      // Prop_DeviceBatteryPercentage_Float (0..1)
  const int PROP_PROVIDES_BATTERY = 1026; // Prop_DeviceProvidesBatteryStatus_Bool

  [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
  delegate int GetRoleFn(uint deviceIndex);
  [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
  delegate int GetClassFn(uint deviceIndex);
  [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
  [return: MarshalAs(UnmanagedType.I1)]
  delegate bool IsConnectedFn(uint deviceIndex);
  [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
  [return: MarshalAs(UnmanagedType.I1)]
  delegate bool GetBoolPropFn(uint deviceIndex, int prop, out int err);
  [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
  delegate float GetFloatPropFn(uint deviceIndex, int prop, out int err);
  [UnmanagedFunctionPointer(CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
  delegate uint GetStringPropFn(uint deviceIndex, int prop, StringBuilder value, uint size, out int err);

  static bool loaded;

  static IntPtr Slot(IntPtr fnt, int i) { return Marshal.ReadIntPtr(fnt, i * IntPtr.Size); }
  static string Esc(string s) {
    return (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", " ").Replace("\n", " ");
  }
  static string Fail(string why) { return "{\"available\":false,\"error\":\"" + Esc(why) + "\"}"; }

  // One request per stdin line (the SteamVR runtime dir) -> one JSON line.
  // "QUIT" or EOF (the app exited) ends the loop.
  public static void Run() {
    string line;
    while ((line = Console.In.ReadLine()) != null) {
      if (line == "QUIT") break;
      string json;
      try { json = Read(line.Trim()); } catch (Exception ex) { json = Fail("read: " + ex.Message); }
      Console.Out.WriteLine(json);
      Console.Out.Flush();
    }
  }

  static string Read(string runtimeDir) {
    if (!loaded) {
      string dll = Path.Combine(runtimeDir, "openvr_api.dll");
      if (!File.Exists(dll)) return Fail("openvr_api.dll missing");
      if (LoadLibraryEx(dll, IntPtr.Zero, LOAD_WITH_ALTERED_SEARCH_PATH) == IntPtr.Zero)
        return Fail("LoadLibraryEx err=" + Marshal.GetLastWin32Error());
      loaded = true;
    }

    int err;
    VR_InitInternal2(out err, APP_TYPE, null);
    if (err != 0) return Fail("init err=" + err + " (SteamVR not running?)");

    try {
      IntPtr fnt = IntPtr.Zero;
      foreach (string v in new[] {"FnTable:IVRSystem_022","FnTable:IVRSystem_021","FnTable:IVRSystem_020"}) {
        fnt = VR_GetGenericInterface(v, out err);
        if (fnt != IntPtr.Zero && err == 0) break;
      }
      if (fnt == IntPtr.Zero) return Fail("no IVRSystem fntable");

      var getRole = (GetRoleFn)Marshal.GetDelegateForFunctionPointer(Slot(fnt,18), typeof(GetRoleFn));
      var getClass = (GetClassFn)Marshal.GetDelegateForFunctionPointer(Slot(fnt,19), typeof(GetClassFn));
      var isConn = (IsConnectedFn)Marshal.GetDelegateForFunctionPointer(Slot(fnt,20), typeof(IsConnectedFn));
      var getBool = (GetBoolPropFn)Marshal.GetDelegateForFunctionPointer(Slot(fnt,21), typeof(GetBoolPropFn));
      var getFloat = (GetFloatPropFn)Marshal.GetDelegateForFunctionPointer(Slot(fnt,22), typeof(GetFloatPropFn));
      var getString = (GetStringPropFn)Marshal.GetDelegateForFunctionPointer(Slot(fnt,27), typeof(GetStringPropFn));

      var sb = new StringBuilder("{\"available\":true,\"devices\":[");
      var dbg = new StringBuilder();
      bool first = true;
      int connCount = 0;
      for (uint i = 0; i < MAX_DEVICES; i++) {
        try {
          if (!isConn(i)) continue;
          connCount++;
          int cls = getClass(i); // 1 HMD, 2 Controller, 3 GenericTracker
          if (cls < 1 || cls > 3) continue;
          // ETrackedPropertyError: 0 = Success, 4 = UnknownProperty, ...
          int eProv, ePct, eChg;
          bool provides = getBool(i, PROP_PROVIDES_BATTERY, out eProv);
          float pct = getFloat(i, PROP_BATTERY_PCT, out ePct);
          bool charging = getBool(i, PROP_IS_CHARGING, out eChg);
          dbg.Append(" i" + i + ":c" + cls + ":prov" + (provides ? 1 : 0) + ":pct" + pct.ToString("0.00") + ":e" + ePct);
          if (!provides || eProv != 0 || ePct != 0) continue;

          int role = cls == 2 ? getRole(i) : 0; // ETrackedControllerRole: 1 Left, 2 Right
          var serial = new StringBuilder(256);
          int eSer;
          getString(i, PROP_SERIAL, serial, (uint)serial.Capacity, out eSer);
          string kind = cls == 1 ? "hmd" : cls == 2 ? "controller" : "tracker";
          int percent = (int)Math.Round(Math.Max(0f, Math.Min(1f, pct)) * 100.0);
          if (!first) sb.Append(",");
          first = false;
          sb.Append("{\"kind\":\"" + kind + "\",\"role\":" + role
            + ",\"serial\":\"" + Esc(eSer == 0 ? serial.ToString() : "") + "\""
            + ",\"percent\":" + percent
            + ",\"charging\":" + (charging && eChg == 0 ? "true" : "false") + "}");
        } catch {}
      }
      sb.Append("],\"debug\":\"conn=" + connCount + dbg.ToString() + "\"}");
      return sb.ToString();
    } finally {
      try { VR_ShutdownInternal(); } catch {}
    }
  }
}
`;

const PS_HARNESS = `
$ErrorActionPreference = 'Stop'
try {
  Add-Type -TypeDefinition @'
${CS_SOURCE}
'@ -Language CSharp -ReferencedAssemblies System.dll | Out-Null
  [UvVrBat]::Run()
} catch {
  [Console]::Out.WriteLine('{"available":false,"error":"ps: ' + ($_.Exception.Message -replace '["\\r\\n]',' ') + '"}')
}
`;

interface RawDevice {
  kind: 'hmd' | 'controller' | 'tracker';
  /** ETrackedControllerRole for controllers: 1 = left, 2 = right. */
  role: number;
  serial: string;
  percent: number;
  charging: boolean;
}

interface RawBattery {
  available: boolean;
  devices?: RawDevice[];
  error?: string;
  debug?: string;
}

/** "LeftFoot" / "LEFT_FOOT" → "Left foot". */
function humanize(id: string): string {
  const words = id
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** steamvr.vrsettings tracker role → label. "TrackerRole_Waist" → "Waist";
 *  a handed tracker ("TrackerRole_Handed,TrackedControllerRole_LeftHand")
 *  → "Left hand". Unassigned roles → null. */
function roleLabel(role: string): string | null {
  const hand = role.match(/TrackedControllerRole_(\w+)/)?.[1];
  if (hand) return humanize(hand);
  const r = role.match(/TrackerRole_(\w+)/)?.[1];
  if (!r || r === 'None' || r === 'Handed' || r === 'Disabled') return null;
  return humanize(r);
}

/** SteamVR's config dirs, from openvrpaths.vrpath (what SteamVR itself uses),
 *  else <Steam>/config next to the runtime. */
async function steamVrConfigDirs(runtimeDir: string): Promise<string[]> {
  const dirs: string[] = [];
  try {
    const vrpath = path.join(process.env.LOCALAPPDATA ?? '', 'openvr', 'openvrpaths.vrpath');
    const cfg = JSON.parse(await fsp.readFile(vrpath, 'utf8')) as { config?: string[] };
    dirs.push(...(cfg.config ?? []));
  } catch {
    /* fall through to the runtime-relative guess */
  }
  dirs.push(path.resolve(runtimeDir, '..', '..', '..', 'config'));
  return dirs;
}

const ROLES_TTL_MS = 60_000;
let rolesCache: { at: number; map: Map<string, string> } | null = null;

/** serial (lower-case) → tracker role, from steamvr.vrsettings "trackers"
 *  (keys look like "/devices/slimevr/human://WAIST"). */
async function trackerRoles(runtimeDir: string): Promise<Map<string, string>> {
  if (rolesCache && Date.now() - rolesCache.at < ROLES_TTL_MS) return rolesCache.map;
  const map = new Map<string, string>();
  for (const dir of await steamVrConfigDirs(runtimeDir)) {
    try {
      const raw = await fsp.readFile(path.join(dir, 'steamvr.vrsettings'), 'utf8');
      const trackers = (JSON.parse(raw) as { trackers?: Record<string, string> }).trackers ?? {};
      for (const [key, role] of Object.entries(trackers)) {
        map.set(key.replace(/^\/devices\/[^/]+\//, '').toLowerCase(), role);
      }
      break;
    } catch {
      /* try the next dir */
    }
  }
  rolesCache = { at: Date.now(), map };
  return map;
}

function deviceName(d: RawDevice, roles: Map<string, string>): string {
  if (d.kind === 'hmd') return 'Headset';
  if (d.kind === 'controller') {
    return d.role === 1 ? 'Left controller' : d.role === 2 ? 'Right controller' : 'Controller';
  }
  const role = roles.get(d.serial.toLowerCase());
  const fromRole = role ? roleLabel(role) : null;
  if (fromRole) return fromRole;
  const human = d.serial.match(/^human:\/\/(.+)$/i)?.[1];
  return human ? humanize(human) : 'Tracker';
}

/** Headset first, then left/right controllers, then trackers (SteamVR order);
 *  repeated names get numbered ("Tracker 1", "Tracker 2"). */
function toDevices(raw: RawDevice[], roles: Map<string, string>): BatteryDevice[] {
  const rank = (d: RawDevice) =>
    d.kind === 'hmd' ? 0 : d.kind === 'controller' ? 1 + d.role / 10 : 2;
  const sorted = raw.map((d, i) => ({ d, i })).sort((a, b) => rank(a.d) - rank(b.d) || a.i - b.i);
  const devices = sorted.map(({ d }) => ({
    kind: d.kind,
    name: deviceName(d, roles),
    percent: d.percent,
    charging: d.charging,
  }));
  const total = new Map<string, number>();
  for (const d of devices) total.set(d.name, (total.get(d.name) ?? 0) + 1);
  const seen = new Map<string, number>();
  for (const d of devices) {
    if ((total.get(d.name) ?? 0) < 2) continue;
    const n = (seen.get(d.name) ?? 0) + 1;
    seen.set(d.name, n);
    d.name = `${d.name} ${n}`;
  }
  return devices;
}

export class VRBatteryProbe {
  private last: BatteryStatus = { available: false, devices: [] };
  private lastError = '';
  private lastLogged = '';
  private inflight: Promise<BatteryStatus> | null = null;
  private lastFetchAt = 0;
  private helper = new PsJsonHelper('vrBattery', PS_HARNESS);
  // Battery moves slowly, but keep the throttle modest so the panel's
  // "Re-scan" button and 8s poll can actually refresh the reading.
  private static MIN_INTERVAL_MS = 9_000;
  // The first request also compiles the helper (a few seconds).
  private static READ_TIMEOUT_MS = 15_000;

  current(): BatteryStatus {
    return this.last;
  }
  error(): string {
    return this.lastError;
  }

  async poll(): Promise<BatteryStatus> {
    if (process.platform !== 'win32') return this.last;
    if (this.inflight) return this.inflight;
    if (Date.now() - this.lastFetchAt < VRBatteryProbe.MIN_INTERVAL_MS) return this.last;

    const dir = await findRuntimeDir();
    if (!dir) {
      this.lastError = 'SteamVR (openvr_api.dll) not found';
      this.last = { available: false, devices: [] };
      return this.last;
    }

    this.inflight = this.request(dir)
      .then(async (raw): Promise<BatteryStatus> => {
        if (!raw?.available) return { available: false, devices: [] };
        const devices = toDevices(raw.devices ?? [], await trackerRoles(dir));
        return { available: true, devices };
      })
      .then((res) => {
        this.last = res;
        this.lastFetchAt = Date.now();
        this.inflight = null;
        const summary = `devices=${res.devices.map((d) => `${d.name}:${d.percent}`).join(',') || 'none'} err=${this.lastError || 'none'}`;
        if (summary !== this.lastLogged) {
          this.lastLogged = summary;
          log.info(`[vrBattery] ${summary}`);
        }
        return res;
      });

    return this.inflight;
  }

  /** Stop the helper process (app quit). */
  dispose(): void {
    this.helper.dispose();
  }

  /** One read from the helper; null when it failed or timed out. */
  private async request(runtimeDir: string): Promise<RawBattery | null> {
    const line = await this.helper.request(runtimeDir, VRBatteryProbe.READ_TIMEOUT_MS);
    if (!line) {
      this.lastError = `helper: ${this.helper.lastFailure}`;
      return null;
    }
    try {
      const parsed = JSON.parse(line) as RawBattery;
      // Prefer an explicit error; otherwise surface the debug trace so the
      // panel can show what SteamVR reported even when it "works".
      this.lastError = parsed.error ?? parsed.debug ?? '';
      return parsed;
    } catch {
      this.lastError = `bad json: ${line.slice(0, 120)}`;
      return null;
    }
  }
}
