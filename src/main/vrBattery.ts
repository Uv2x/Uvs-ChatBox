// SteamVR device-battery probe (HMD / controllers / trackers).
//
// Reads the standard OpenVR battery properties that VRCOSC's SteamVR module
// also uses — Prop_DeviceProvidesBatteryStatus_Bool (1004),
// Prop_DeviceBatteryPercentage_Float (1005), Prop_DeviceIsCharging_Bool
// (1003) — via the same PowerShell + inline-C# + P/Invoke bridge the HMD
// activity probe uses (vrActivity.ts). ONLY works while SteamVR is running
// (PCVR). A standalone Quest exposes none of this to the PC.
//
// FnTable indices (IVRSystem_022, verified against the activity probe which
// keys off index 15): 19 = GetTrackedDeviceClass, 20 = IsTrackedDeviceConnected,
// 21 = GetBoolTrackedDeviceProperty, 22 = GetFloatTrackedDeviceProperty.
// Device classes: 1 = HMD, 2 = Controller, 3 = GenericTracker.

import { spawn } from 'child_process';
import log from 'electron-log';
import type { BatteryDevice, BatteryStatus } from '../shared/types';
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

  const int APP_TYPE = 3; // Background — read-only utility, won't fight VRChat.
  const uint LOAD_WITH_ALTERED_SEARCH_PATH = 0x00000008;
  const int MAX_DEVICES = 64;
  // ETrackedDeviceProperty (correct OpenVR values — the earlier 1003/1004/1005
  // were RenderModelName/WillDriftInYaw/ManufacturerName, which is why the
  // percentage read back 0). Battery percentage is 0..1.
  const int PROP_PROVIDES_BATTERY = 1026; // Prop_DeviceProvidesBatteryStatus_Bool
  const int PROP_BATTERY_PCT = 1012;      // Prop_DeviceBatteryPercentage_Float
  const int PROP_IS_CHARGING = 1011;      // Prop_DeviceIsCharging_Bool

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

  static IntPtr Slot(IntPtr fnt, int i) { return Marshal.ReadIntPtr(fnt, i * IntPtr.Size); }

  public static string Read(string runtimeDir) {
    if (string.IsNullOrEmpty(runtimeDir))
      return "{\"available\":false,\"error\":\"runtime dir missing\"}";
    string dll = Path.Combine(runtimeDir, "openvr_api.dll");
    if (!File.Exists(dll)) return "{\"available\":false,\"error\":\"openvr_api.dll missing\"}";

    IntPtr h = LoadLibraryEx(dll, IntPtr.Zero, LOAD_WITH_ALTERED_SEARCH_PATH);
    if (h == IntPtr.Zero)
      return "{\"available\":false,\"error\":\"LoadLibraryEx err=" + Marshal.GetLastWin32Error() + "\"}";

    int err;
    try { VR_InitInternal2(out err, APP_TYPE, null); }
    catch (Exception ex) { return "{\"available\":false,\"error\":\"init: " + ex.Message.Replace("\"","'") + "\"}"; }
    if (err != 0) return "{\"available\":false,\"error\":\"init err=" + err + " (SteamVR not running?)\"}";

    try {
      IntPtr fnt = IntPtr.Zero;
      foreach (string v in new[] {"FnTable:IVRSystem_022","FnTable:IVRSystem_021","FnTable:IVRSystem_020"}) {
        fnt = VR_GetGenericInterface(v, out err);
        if (fnt != IntPtr.Zero && err == 0) break;
      }
      if (fnt == IntPtr.Zero) return "{\"available\":false,\"error\":\"no IVRSystem fntable\"}";

      var getClass = (GetClassFn)Marshal.GetDelegateForFunctionPointer(Slot(fnt,19), typeof(GetClassFn));
      var isConn = (IsConnectedFn)Marshal.GetDelegateForFunctionPointer(Slot(fnt,20), typeof(IsConnectedFn));
      var getBool = (GetBoolPropFn)Marshal.GetDelegateForFunctionPointer(Slot(fnt,21), typeof(GetBoolPropFn));
      var getFloat = (GetFloatPropFn)Marshal.GetDelegateForFunctionPointer(Slot(fnt,22), typeof(GetFloatPropFn));

      var sb = new StringBuilder();
      var dbg = new StringBuilder();
      // VERIFY: read the HMD display frequency (Prop_DisplayFrequency_Float=2002)
      // — a property the HMD definitely has. If this returns ~90 with e0, the
      // GetFloat index/signature is CORRECT and a battery e4 means the driver
      // (Quest over Link) simply doesn't expose battery. If this also e4's, the
      // FnTable index is wrong.
      try {
        int eF;
        float freq = getFloat(0, 2002, out eF);
        dbg.Append("freq@2002=" + freq.ToString("0.0") + ":e" + eF + " | ");
      } catch (Exception vex) { dbg.Append("freq-threw:" + vex.Message.Replace("\"","'") + " | "); }
      sb.Append("{\"available\":true,\"devices\":[");
      bool first = true;
      int ctrl = 0, trk = 0, connCount = 0;
      for (uint i = 0; i < MAX_DEVICES; i++) {
        try {
          if (!isConn(i)) continue;
          connCount++;
          int cls = getClass(i);            // 1 HMD, 2 Controller, 3 Tracker
          // Read the battery percentage + its error code (ETrackedPropertyError:
          // 0=Success 1=WrongDataType 4=UnknownProperty 5=InvalidDevice ...).
          int ePct = -1, eProv = -1;
          float pct = 0f;
          bool provides = false, charging = false;
          try { pct = getFloat(i, PROP_BATTERY_PCT, out ePct); } catch { ePct = -99; }
          try { provides = getBool(i, PROP_PROVIDES_BATTERY, out eProv); } catch { eProv = -99; }
          try { int ec; charging = getBool(i, PROP_IS_CHARGING, out ec); } catch {}
          // Diagnostic: class, provides flag, raw pct, and the pct error code.
          if (dbg.Length > 0) dbg.Append(" ");
          dbg.Append("i" + i + ":c" + cls + ":prov" + (provides ? 1 : 0) + ":pct" + pct.ToString("0.00") + ":e" + ePct);
          // Show controllers/trackers always; the HMD only when it reports one.
          bool want = provides || cls == 2 || cls == 3;
          if (!want) continue;
          string kind = cls == 1 ? "hmd" : cls == 2 ? "controller" : cls == 3 ? "tracker" : "other";
          string name = cls == 1 ? "Headset" : cls == 2 ? ("Controller " + (++ctrl)) : cls == 3 ? ("Tracker " + (++trk)) : ("Device " + i);
          if (!first) sb.Append(",");
          first = false;
          int pcti = (int)Math.Round(pct * 100.0);
          sb.Append("{\"kind\":\"" + kind + "\",\"name\":\"" + name + "\",\"percent\":" + pcti + ",\"charging\":" + (charging ? "true" : "false") + "}");
        } catch {}
      }
      sb.Append("],\"debug\":\"conn=" + connCount + " [" + dbg.ToString() + "]\"}");
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
  $rt = $env:UVS_OVR_RUNTIME
  if ([string]::IsNullOrEmpty($rt)) { '{"available":false,"error":"runtime empty"}' }
  else { [UvVrBat]::Read($rt) }
} catch {
  '{"available":false,"error":"ps: ' + ($_.Exception.Message -replace '"',"'") + '"}'
}
`;

interface RawBattery {
  available: boolean;
  devices?: BatteryDevice[];
  error?: string;
  debug?: string;
}

export class VRBatteryProbe {
  private last: BatteryStatus = { available: false, devices: [] };
  private lastError = '';
  private inflight: Promise<BatteryStatus> | null = null;
  private lastFetchAt = 0;
  // Battery moves slowly, but keep the throttle modest so the panel's
  // "Re-scan" button and 8s poll can actually refresh the reading.
  private static MIN_INTERVAL_MS = 9_000;

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

    this.inflight = new Promise<BatteryStatus>((resolve) => {
      const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_HARNESS], {
        windowsHide: true,
        env: { ...process.env, UVS_OVR_RUNTIME: dir },
      });
      let out = '';
      const timer = setTimeout(() => {
        ps.kill();
        this.lastError = 'probe timeout';
        resolve({ available: false, devices: [] });
      }, 12_000);
      ps.stdout.on('data', (d) => (out += d.toString()));
      ps.on('error', (e) => {
        clearTimeout(timer);
        this.lastError = e.message;
        resolve({ available: false, devices: [] });
      });
      ps.on('close', () => {
        clearTimeout(timer);
        const line =
          out
            .split(/\r?\n/)
            .map((l) => l.trim())
            .reverse()
            .find((l) => l.startsWith('{')) ?? '';
        try {
          const parsed = JSON.parse(line) as RawBattery;
          // Prefer an explicit error; otherwise surface the debug trace so
          // the panel can show what SteamVR reported even when it "works".
          this.lastError = parsed.error ?? parsed.debug ?? '';
          resolve({
            available: !!parsed.available,
            devices: Array.isArray(parsed.devices) ? parsed.devices : [],
          });
        } catch {
          this.lastError = line ? `bad json: ${line.slice(0, 120)}` : 'no output';
          resolve({ available: false, devices: [] });
        }
      });
    }).then((res) => {
      this.last = res;
      this.lastFetchAt = Date.now();
      this.inflight = null;
      log.info(`[vrBattery] devices=${res.devices.length} err=${this.lastError || 'none'}`);
      return res;
    });

    return this.inflight;
  }
}
