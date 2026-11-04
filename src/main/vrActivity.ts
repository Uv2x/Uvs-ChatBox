// Minimal SteamVR probe — answers one question: "is the HMD currently on the
// user's head?" by reading IVRSystem::GetTrackedDeviceActivityLevel(0).
//
// Architecture is the same as the removed battery probe (PowerShell +
// inline C# + P/Invoke against openvr_api.dll), but scoped down to a single
// function call. No property reads, no battery enumeration. We learned from
// the battery debug that:
//   - LoadLibraryEx with full DLL path is the only reliable way to load
//     openvr_api.dll from outside SteamVR's own bin folder.
//   - VR_GetGenericInterface("FnTable:IVRSystem_022") returns a struct of C
//     function pointers laid out in IVRSystem method order.
//   - Index 15 is GetTrackedDeviceActivityLevel (after ResetSeatedZeroPose
//     was removed in the SDK).
//
// Returned activity-level enum values (EDeviceActivityLevel):
//   -1 Unknown
//    0 Idle
//    1 UserInteraction       <- headset on head, actively in use
//    2 UserInteraction_Timeout <- recently active, ~0.5s of stillness
//    3 Standby               <- proximity sensor not triggered (off head)
//    4 Idle_Timeout

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import log from 'electron-log';

export interface VRActivity {
  /** True iff SteamVR was reachable and answered. */
  available: boolean;
  /** EDeviceActivityLevel, or -1 when unknown / unavailable. */
  activityLevel: number;
  /** Convenience flag: HMD is currently being worn (activity is 1 or 2). */
  hmdOnHead: boolean;
  /** Optional probe error message for diagnostics. */
  error?: string;
}

/** Re-implemented runtime dir lookup (we deleted steamvr.ts when the battery
 *  feature went away). Same registry/library-folders walk as before.
 *  Exported so the battery probe (vrBattery.ts) reuses the same finder +
 *  cache instead of duplicating the registry/library walk. */
let cachedRuntime: string | null | undefined;
export async function findRuntimeDir(): Promise<string | null> {
  if (cachedRuntime !== undefined) return cachedRuntime;
  if (process.platform !== 'win32') {
    cachedRuntime = null;
    return null;
  }

  const candidates: string[] = [];
  if (process.env.OPENVR_RUNTIME) candidates.push(process.env.OPENVR_RUNTIME);

  const ps = (cmd: string) =>
    new Promise<string>((resolve) => {
      const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], {
        windowsHide: true,
      });
      let out = '';
      const t = setTimeout(() => {
        p.kill();
        resolve('');
      }, 3000);
      p.stdout.on('data', (d) => (out += d.toString()));
      p.on('error', () => {
        clearTimeout(t);
        resolve('');
      });
      p.on('close', () => {
        clearTimeout(t);
        resolve(out.trim());
      });
    });

  for (const key of [
    `HKLM:\\SOFTWARE\\WOW6432Node\\Valve\\Steam`,
    `HKLM:\\SOFTWARE\\Valve\\Steam`,
    `HKCU:\\SOFTWARE\\Valve\\Steam`,
  ]) {
    const p = await ps(`(Get-ItemProperty '${key}' -ErrorAction SilentlyContinue).InstallPath`);
    if (p) candidates.push(path.join(p, 'steamapps', 'common', 'SteamVR'));
  }
  candidates.push(
    'C:\\Program Files (x86)\\Steam\\steamapps\\common\\SteamVR',
    'C:\\Program Files\\Steam\\steamapps\\common\\SteamVR',
    'D:\\Steam\\steamapps\\common\\SteamVR',
    'D:\\SteamLibrary\\steamapps\\common\\SteamVR',
    'E:\\Steam\\steamapps\\common\\SteamVR',
    'E:\\SteamLibrary\\steamapps\\common\\SteamVR',
  );

  const seen = new Set<string>();
  for (const root of candidates) {
    if (!root) continue;
    const dll = path.join(root, 'bin', 'win64', 'openvr_api.dll');
    if (seen.has(dll)) continue;
    seen.add(dll);
    try {
      await fs.access(dll);
      cachedRuntime = path.dirname(dll);
      return cachedRuntime;
    } catch {
      /* try next */
    }
  }
  cachedRuntime = null;
  return null;
}

const CS_SOURCE = String.raw`
using System;
using System.Runtime.InteropServices;
using System.IO;
public static class UvVrAct {
  [DllImport("openvr_api.dll", CharSet = CharSet.Ansi)]
  static extern uint VR_InitInternal2(out int peError, int eApplicationType, string startup);
  [DllImport("openvr_api.dll", CharSet = CharSet.Ansi)]
  static extern IntPtr VR_GetGenericInterface(string version, out int peError);
  [DllImport("openvr_api.dll")] static extern void VR_ShutdownInternal();
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern IntPtr LoadLibraryEx(string lpFileName, IntPtr hReservedNull, uint dwFlags);

  // VRApplication_Background == 3. Background mode means "read-only utility,
  // no input or rendering" — won't fight with the running VRChat scene app.
  const int APP_TYPE = 3;
  const uint LOAD_WITH_ALTERED_SEARCH_PATH = 0x00000008;

  [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
  delegate int GetTrackedDeviceActivityLevelFn(uint deviceIndex);

  public static string Read(string runtimeDir) {
    if (string.IsNullOrEmpty(runtimeDir))
      return "{\"available\":false,\"activityLevel\":-1,\"error\":\"runtime dir missing\"}";
    string dll = Path.Combine(runtimeDir, "openvr_api.dll");
    if (!File.Exists(dll))
      return "{\"available\":false,\"activityLevel\":-1,\"error\":\"openvr_api.dll not at " + dll.Replace("\\","/").Replace("\"","'") + "\"}";

    IntPtr h = LoadLibraryEx(dll, IntPtr.Zero, LOAD_WITH_ALTERED_SEARCH_PATH);
    if (h == IntPtr.Zero) {
      int e = Marshal.GetLastWin32Error();
      return "{\"available\":false,\"activityLevel\":-1,\"error\":\"LoadLibraryEx err=" + e + "\"}";
    }

    int err;
    try { VR_InitInternal2(out err, APP_TYPE, null); }
    catch (Exception ex) { return "{\"available\":false,\"activityLevel\":-1,\"error\":\"init: " + ex.Message.Replace("\"","'") + "\"}"; }
    if (err != 0) return "{\"available\":false,\"activityLevel\":-1,\"error\":\"init err=" + err + "\"}";

    try {
      IntPtr fnt = IntPtr.Zero;
      foreach (string v in new[] {"FnTable:IVRSystem_022","FnTable:IVRSystem_021","FnTable:IVRSystem_020"}) {
        fnt = VR_GetGenericInterface(v, out err);
        if (fnt != IntPtr.Zero && err == 0) break;
      }
      if (fnt == IntPtr.Zero)
        return "{\"available\":false,\"activityLevel\":-1,\"error\":\"no IVRSystem fntable\"}";

      // FnTable slot 15 == GetTrackedDeviceActivityLevel (verified during
      // the earlier battery debug — index 14 is GetSortedTrackedDeviceIndicesOfClass,
      // 15 is activity level, 19 is class, 20 is connected, etc).
      IntPtr fp = Marshal.ReadIntPtr(fnt, 15 * IntPtr.Size);
      var fn = (GetTrackedDeviceActivityLevelFn)Marshal.GetDelegateForFunctionPointer(fp, typeof(GetTrackedDeviceActivityLevelFn));
      int activity = -1;
      try { activity = fn(0); } catch {} // device index 0 == HMD slot
      return "{\"available\":true,\"activityLevel\":" + activity + "}";
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
  $rt = $env:UVS_OVR_RUNTIME
  if ([string]::IsNullOrEmpty($rt)) {
    '{"available":false,"activityLevel":-1,"error":"UVS_OVR_RUNTIME empty"}'
  } else {
    [UvVrAct]::Read($rt)
  }
} catch {
  '{"available":false,"activityLevel":-1,"error":"ps: ' + ($_.Exception.Message -replace '"',"'") + '"}'
}
`;

export class VRActivityProbe {
  /** Cached most-recent reading. We poll lazily — callers get this last
   *  reading if they ask, and the cache refreshes when poll() is called.
   *  Keeping the last value makes "headset just came off" detection trivial. */
  private last: VRActivity = { available: false, activityLevel: -1, hmdOnHead: false };
  /** Throttle so chatty callers don't spawn a fresh PowerShell every tick. */
  private inflight: Promise<VRActivity> | null = null;
  private lastFetchAt = 0;
  private static MIN_INTERVAL_MS = 4_000;

  /** Last known reading without re-polling. */
  current(): VRActivity {
    return this.last;
  }

  /** Re-poll if enough time has passed; otherwise return cached. */
  async poll(): Promise<VRActivity> {
    if (process.platform !== 'win32') return this.last;
    const now = Date.now();
    if (this.inflight) return this.inflight;
    if (now - this.lastFetchAt < VRActivityProbe.MIN_INTERVAL_MS) return this.last;

    const dir = await findRuntimeDir();
    if (!dir) {
      this.last = {
        available: false,
        activityLevel: -1,
        hmdOnHead: false,
        error: 'openvr_api.dll not found',
      };
      return this.last;
    }

    this.inflight = new Promise<VRActivity>((resolve) => {
      const ps = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', PS_HARNESS],
        { windowsHide: true, env: { ...process.env, UVS_OVR_RUNTIME: dir } },
      );
      let out = '';
      const timer = setTimeout(() => {
        ps.kill();
        resolve({
          available: false,
          activityLevel: -1,
          hmdOnHead: false,
          error: 'probe timeout',
        });
      }, 8000);
      ps.stdout.on('data', (d) => (out += d.toString()));
      ps.on('error', (e) => {
        clearTimeout(timer);
        resolve({ available: false, activityLevel: -1, hmdOnHead: false, error: e.message });
      });
      ps.on('close', () => {
        clearTimeout(timer);
        const line =
          out
            .split(/\r?\n/)
            .map((l) => l.trim())
            .reverse()
            .find((l) => l.startsWith('{')) ?? '';
        if (!line) {
          resolve({ available: false, activityLevel: -1, hmdOnHead: false, error: 'no json line' });
          return;
        }
        try {
          const parsed = JSON.parse(line) as {
            available: boolean;
            activityLevel: number;
            error?: string;
          };
          const lvl = Number(parsed.activityLevel);
          resolve({
            available: !!parsed.available,
            activityLevel: lvl,
            // 1 = UserInteraction, 2 = UserInteraction_Timeout — both mean
            // the proximity sensor is triggered (headset is being worn).
            hmdOnHead: lvl === 1 || lvl === 2,
            ...(parsed.error ? { error: parsed.error } : {}),
          });
        } catch {
          resolve({ available: false, activityLevel: -1, hmdOnHead: false, error: 'parse failed' });
        }
      });
    }).then((res) => {
      this.last = res;
      this.lastFetchAt = Date.now();
      this.inflight = null;
      if (res.error) log.info(`[vrActivity] ${res.error}`);
      else log.info(`[vrActivity] level=${res.activityLevel} onHead=${res.hmdOnHead}`);
      return res;
    });

    return this.inflight;
  }
}
