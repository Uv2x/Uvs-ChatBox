// SteamVR in-headset notifications (toasts).
//
// Pushes a text toast into the headset via OpenVR's IVRNotifications, using
// the same PowerShell + inline-C# + P/Invoke bridge as vrActivity.ts /
// vrBattery.ts. ONLY works while SteamVR is running (PCVR — Link / Air Link /
// Virtual Desktop). A standalone Quest exposes nothing to the PC.
//
// A notification needs an overlay handle to attach to, so we do:
//   VR_InitInternal2  ->  IVROverlay.CreateOverlay  ->
//   IVRNotifications.CreateNotification  ->  brief Sleep so it displays.
//
// FnTable indices (stable across recent OpenVR versions — these three are the
// first methods of their interfaces):
//   IVROverlay:       1 = CreateOverlay  (0 = FindOverlay, 2 = DestroyOverlay)
//   IVRNotifications: 0 = CreateNotification  (1 = RemoveNotification)
//
// Text is marshalled as UTF-8 by hand (OpenVR takes const char* = UTF-8) so
// emoji in status/notification text survive.

import { spawn } from 'child_process';
import log from 'electron-log';
import { findRuntimeDir } from './vrActivity';

const CS_SOURCE = String.raw`
using System;
using System.Text;
using System.Threading;
using System.Runtime.InteropServices;
using System.IO;
public static class UvVrNotify {
  [DllImport("openvr_api.dll", CharSet = CharSet.Ansi)]
  static extern uint VR_InitInternal2(out int peError, int eApplicationType, string startup);
  [DllImport("openvr_api.dll", CharSet = CharSet.Ansi)]
  static extern IntPtr VR_GetGenericInterface(string version, out int peError);
  [DllImport("openvr_api.dll")] static extern void VR_ShutdownInternal();
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern IntPtr LoadLibraryEx(string lpFileName, IntPtr hReservedNull, uint dwFlags);

  const uint LOAD_WITH_ALTERED_SEARCH_PATH = 0x00000008;

  // CreateOverlay(key, name, out handle) -> EVROverlayError (0 = OK). ASCII key.
  [UnmanagedFunctionPointer(CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
  delegate uint CreateOverlayFn(string key, string name, out ulong handle);
  // CreateNotification(overlay, userValue, type, char* text, style, image*, out id)
  // -> EVRNotificationError (0 = OK). text is a UTF-8 pointer we build ourselves.
  [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
  delegate uint CreateNotifFn(ulong overlay, ulong userValue, uint type, IntPtr text,
                              uint style, IntPtr image, out uint id);

  static IntPtr Slot(IntPtr fnt, int i) { return Marshal.ReadIntPtr(fnt, i * IntPtr.Size); }

  static IntPtr GetTable(string[] versions, out int err) {
    foreach (string v in versions) {
      IntPtr t = VR_GetGenericInterface(v, out err);
      if (t != IntPtr.Zero && err == 0) return t;
    }
    err = -1;
    return IntPtr.Zero;
  }

  static string J(string s) { return s.Replace("\\", "\\\\").Replace("\"", "'"); }

  public static string Notify(string runtimeDir, string text, int holdMs) {
    if (holdMs < 500) holdMs = 500;
    if (holdMs > 20000) holdMs = 20000;
    if (string.IsNullOrEmpty(runtimeDir))
      return "{\"ok\":false,\"error\":\"runtime dir missing\"}";
    string dll = Path.Combine(runtimeDir, "openvr_api.dll");
    if (!File.Exists(dll)) return "{\"ok\":false,\"error\":\"openvr_api.dll missing\"}";
    if (LoadLibraryEx(dll, IntPtr.Zero, LOAD_WITH_ALTERED_SEARCH_PATH) == IntPtr.Zero)
      return "{\"ok\":false,\"error\":\"LoadLibraryEx err=" + Marshal.GetLastWin32Error() + "\"}";

    // Overlay creation wants an Overlay-type session (2); fall back to
    // Background (3) — the type our read-only probes use — if that fails.
    int err;
    int usedType = 2;
    VR_InitInternal2(out err, 2, null);
    if (err != 0) { usedType = 3; VR_InitInternal2(out err, 3, null); }
    if (err != 0)
      return "{\"ok\":false,\"error\":\"init err=" + err + " (SteamVR not running?)\"}";

    IntPtr textPtr = IntPtr.Zero;
    try {
      int eO, eN;
      IntPtr ov = GetTable(new[] {
        "FnTable:IVROverlay_027","FnTable:IVROverlay_026","FnTable:IVROverlay_025",
        "FnTable:IVROverlay_024","FnTable:IVROverlay_022"
      }, out eO);
      if (ov == IntPtr.Zero) return "{\"ok\":false,\"error\":\"no IVROverlay fntable\"}";
      IntPtr nt = GetTable(new[] { "FnTable:IVRNotifications_002" }, out eN);
      if (nt == IntPtr.Zero) return "{\"ok\":false,\"error\":\"no IVRNotifications fntable\"}";

      var createOverlay = (CreateOverlayFn)Marshal.GetDelegateForFunctionPointer(
        Slot(ov, 1), typeof(CreateOverlayFn));
      var createNotif = (CreateNotifFn)Marshal.GetDelegateForFunctionPointer(
        Slot(nt, 0), typeof(CreateNotifFn));

      // Unique key per process so repeated toasts don't collide.
      string key = "uvs.chatbox.notify." + System.Diagnostics.Process.GetCurrentProcess().Id;
      ulong handle = 0;
      uint eCreate = createOverlay(key, "Uv's Chat Box", out handle);
      if (eCreate != 0 || handle == 0)
        return "{\"ok\":false,\"error\":\"CreateOverlay err=" + eCreate + "\"}";

      byte[] utf8 = Encoding.UTF8.GetBytes(text + "\0");
      textPtr = Marshal.AllocHGlobal(utf8.Length);
      Marshal.Copy(utf8, 0, textPtr, utf8.Length);

      // type: 0 = Transient (auto-dismisses).  style: 1 = Application.
      uint id = 0;
      uint eNotify = createNotif(handle, 0, 0, textPtr, 1, IntPtr.Zero, out id);
      // Keep the OpenVR session (and thus the overlay the toast is attached to)
      // alive for the full display time — the moment we VR_ShutdownInternal the
      // overlay is destroyed and the notification vanishes with it. This hold
      // IS the visible duration.
      Thread.Sleep(holdMs);

      bool ok = eNotify == 0;
      string dbg = "appType=" + usedType + " ovErr=" + eCreate + " notifErr=" + eNotify + " id=" + id;
      return "{\"ok\":" + (ok ? "true" : "false") +
             (ok ? "" : ",\"error\":\"CreateNotification err=" + eNotify + "\"") +
             ",\"debug\":\"" + J(dbg) + "\"}";
    } catch (Exception ex) {
      return "{\"ok\":false,\"error\":\"" + J(ex.Message) + "\"}";
    } finally {
      if (textPtr != IntPtr.Zero) Marshal.FreeHGlobal(textPtr);
      try { VR_ShutdownInternal(); } catch {}
    }
  }
}
`;

interface RawNotify {
  ok: boolean;
  error?: string;
  debug?: string;
}

export class VRNotifier {
  private inflight: Promise<RawNotify> | null = null;
  private lastAt = 0;
  // SteamVR's notification queue is small; keep toasts modestly spaced.
  private static MIN_INTERVAL_MS = 4_000;

  /** Push a toast into the headset. Silently no-ops on non-Windows, when
   *  SteamVR isn't running, or if fired faster than MIN_INTERVAL_MS.
   *  `holdMs` is how long the toast stays visible (we hold the OpenVR session
   *  open that long — see the harness). */
  async notify(text: string, opts: { force?: boolean; holdMs?: number } = {}): Promise<RawNotify> {
    if (process.platform !== 'win32') return { ok: false, error: 'Windows only' };
    if (this.inflight) return this.inflight;
    if (!opts.force && Date.now() - this.lastAt < VRNotifier.MIN_INTERVAL_MS) {
      return { ok: false, error: 'throttled' };
    }
    const holdMs = Math.max(1500, Math.min(20000, Math.round(opts.holdMs ?? 6000)));

    const dir = await findRuntimeDir();
    if (!dir) return { ok: false, error: 'SteamVR (openvr_api.dll) not found' };

    const harness = `
$ErrorActionPreference = 'Stop'
try {
  Add-Type -TypeDefinition @'
${CS_SOURCE}
'@ -Language CSharp -ReferencedAssemblies System.dll | Out-Null
  [UvVrNotify]::Notify($env:UVS_OVR_RUNTIME, $env:UVS_NOTIFY_TEXT, [int]$env:UVS_NOTIFY_HOLD)
} catch {
  '{"ok":false,"error":"ps: ' + ($_.Exception.Message -replace '"',"'") + '"}'
}
`;

    this.inflight = new Promise<RawNotify>((resolve) => {
      const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', harness], {
        windowsHide: true,
        env: {
          ...process.env,
          UVS_OVR_RUNTIME: dir,
          UVS_NOTIFY_TEXT: text,
          UVS_NOTIFY_HOLD: String(holdMs),
        },
      });
      let out = '';
      // Give the harness the full hold duration plus headroom for init/compile.
      const timer = setTimeout(() => {
        ps.kill();
        resolve({ ok: false, error: 'notify timeout' });
      }, holdMs + 8000);
      ps.stdout.on('data', (d) => (out += d.toString()));
      ps.on('error', (e) => {
        clearTimeout(timer);
        resolve({ ok: false, error: e.message });
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
          resolve(JSON.parse(line) as RawNotify);
        } catch {
          resolve({ ok: false, error: line ? `bad json: ${line.slice(0, 120)}` : 'no output' });
        }
      });
    }).then((res) => {
      this.lastAt = Date.now();
      this.inflight = null;
      log.info(`[vrNotify] ok=${res.ok} ${res.error ?? res.debug ?? ''}`);
      return res;
    });

    return this.inflight;
  }
}
