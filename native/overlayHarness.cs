// Persistent SteamVR control overlay for Uv's Chat Box.
//
// Compiled at runtime (Add-Type) together with the vendored Valve binding
// (openvr_api.cs) by src/main/overlay.ts. Two modes:
//
//   dashboard  — a tab in the SteamVR dashboard (opened with the system
//                button). SteamVR handles positioning + laser input.
//   wrist      — a small overlay attached to a controller, always visible;
//                you point at it with the OTHER controller and pull the
//                trigger. We position it ourselves relative to the controller
//                and flag it interactive so laser clicks generate mouse events.
//
// Protocol (line-based, UTF-8, over stdio):
//   IN  (app -> harness):
//     STATE  \t <title> \t <btnspec>        btnspec = id|label|active ; ...
//     CONFIG \t <hand> \t <sizeM> \t <tiltDeg> \t <upM> \t <fwdM> \t <rightM>
//     QUIT
//   OUT (harness -> app):
//     READY | CLICK\t<id> | ERR\t<message>
//
// The overlay MODE is fixed for the process lifetime (via UVS_OVERLAY_MODE) —
// switching modes restarts the process. Wrist placement is live-tunable via
// CONFIG so the user can adjust it from the app without a restart.

using System;
using System.Text;
using System.Threading;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.IO;
using Valve.VR;

public static class UvOverlay {
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern IntPtr LoadLibraryEx(string f, IntPtr r, uint fl);

  const int W = 784;
  const int H = 560;
  const int PAD = 24;
  const int BTN_W = (W - 3 * PAD) / 2;
  const int BTN_H = 100;
  const int GAP = 16;
  const int TOP = 76;

  struct Btn { public string id; public string label; public bool active; public Rectangle rect; }

  static readonly object gate = new object();
  static readonly Queue<string> inbox = new Queue<string>();
  static volatile bool quit = false;
  static List<Btn> buttons = new List<Btn>();
  static string title = "Uv's Chat Box";
  static int hover = -1;

  // Wrist config (live-tunable via CONFIG).
  static bool wrist = false;
  static int handRole = 1;        // ETrackedControllerRole: 1 Left, 2 Right
  static float sizeM = 0.22f;
  static float tiltRad = -0.87f;  // ~ -50 deg
  static float ox = 0f, oy = 0.02f, oz = 0.06f; // right, up, toward-user(+Z)
  static bool transformDirty = true;
  static bool wristShown = false;

  static StreamWriter Out;
  static StreamReader In;

  static void Emit(string s) { try { Out.WriteLine(s); Out.Flush(); } catch {} }

  static void ReaderThread() {
    try { string line; while ((line = In.ReadLine()) != null) { lock (gate) inbox.Enqueue(line); } } catch {}
    quit = true;
  }

  static float F(string s, float dflt) { float v; return float.TryParse(s, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out v) ? v : dflt; }

  static void Layout() {
    for (int i = 0; i < buttons.Count && i < 8; i++) {
      int col = i % 2, row = i / 2;
      var b = buttons[i];
      b.rect = new Rectangle(PAD + col * (BTN_W + PAD), TOP + row * (BTN_H + GAP), BTN_W, BTN_H);
      buttons[i] = b;
    }
  }

  static int HitTest(int x, int y) {
    for (int i = 0; i < buttons.Count && i < 8; i++) if (buttons[i].rect.Contains(x, y)) return i;
    return -1;
  }

  static void HandleLine(string line, ref bool dirty) {
    if (line == null) return;
    if (line == "QUIT") { quit = true; return; }
    string[] p = line.Split('\t');
    if (p.Length >= 1 && p[0] == "STATE") {
      title = p.Length > 1 ? p[1] : "Uv's Chat Box";
      var list = new List<Btn>();
      if (p.Length > 2 && p[2].Length > 0) {
        foreach (string spec in p[2].Split(';')) {
          if (spec.Length == 0) continue;
          string[] f = spec.Split('|');
          if (f.Length < 2) continue;
          var b = new Btn(); b.id = f[0]; b.label = f[1]; b.active = f.Length > 2 && f[2] == "1";
          list.Add(b);
        }
      }
      buttons = list; Layout(); dirty = true;
    } else if (p.Length >= 7 && p[0] == "CONFIG") {
      handRole = p[1] == "right" ? 2 : 1;
      sizeM = F(p[2], sizeM);
      tiltRad = (float)(F(p[3], -50f) * Math.PI / 180.0);
      oy = F(p[4], oy);      // up
      oz = F(p[5], oz);      // toward user (+Z)
      ox = F(p[6], ox);      // right
      transformDirty = true;
    }
  }

  static byte[] Render() {
    using (var bmp = new Bitmap(W, H, PixelFormat.Format32bppArgb))
    using (var g = Graphics.FromImage(bmp)) {
      g.SmoothingMode = SmoothingMode.AntiAlias;
      g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
      g.Clear(Color.FromArgb(245, 18, 16, 26));
      using (var titleFont = new Font("Segoe UI", 20, FontStyle.Bold))
      using (var btnFont = new Font("Segoe UI Emoji", 17, FontStyle.Regular))
      using (var white = new SolidBrush(Color.White))
      using (var sub = new SolidBrush(Color.FromArgb(150, 200, 200, 220))) {
        g.DrawString(title, titleFont, white, PAD, 20);
        var fmt = new StringFormat { LineAlignment = StringAlignment.Center };
        for (int i = 0; i < buttons.Count && i < 8; i++) {
          var b = buttons[i];
          Color fill = b.active ? Color.FromArgb(255, 84, 72, 148) : Color.FromArgb(255, 28, 26, 40);
          Color border = i == hover ? Color.FromArgb(255, 175, 165, 235) : Color.FromArgb(255, 70, 64, 96);
          using (var fb = new SolidBrush(fill)) FillRounded(g, fb, b.rect, 14);
          using (var pen = new Pen(border, i == hover ? 3f : 2f)) DrawRounded(g, pen, b.rect, 14);
          var textRect = new RectangleF(b.rect.X + 18, b.rect.Y, b.rect.Width - 28, b.rect.Height);
          g.DrawString(b.label, btnFont, white, textRect, fmt);
          if (b.active) g.DrawString("●", btnFont, sub, b.rect.Right - 34, b.rect.Y + 8);
        }
      }
      var data = bmp.LockBits(new Rectangle(0, 0, W, H), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
      int n = W * H * 4; byte[] bgra = new byte[n];
      Marshal.Copy(data.Scan0, bgra, 0, n); bmp.UnlockBits(data);
      byte[] rgba = new byte[n];
      for (int i = 0; i < n; i += 4) { rgba[i] = bgra[i + 2]; rgba[i + 1] = bgra[i + 1]; rgba[i + 2] = bgra[i]; rgba[i + 3] = bgra[i + 3]; }
      return rgba;
    }
  }

  static GraphicsPath RoundedPath(Rectangle r, int rad) {
    var p = new GraphicsPath(); int d = rad * 2;
    p.AddArc(r.X, r.Y, d, d, 180, 90); p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
    p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90); p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
    p.CloseFigure(); return p;
  }
  static void FillRounded(Graphics g, Brush b, Rectangle r, int rad) { using (var p = RoundedPath(r, rad)) g.FillPath(b, p); }
  static void DrawRounded(Graphics g, Pen pen, Rectangle r, int rad) { using (var p = RoundedPath(r, rad)) g.DrawPath(pen, p); }

  static void Push(CVROverlay ov, ulong main, ulong thumb) {
    byte[] rgba = Render();
    var h = GCHandle.Alloc(rgba, GCHandleType.Pinned);
    try {
      ov.SetOverlayRaw(main, h.AddrOfPinnedObject(), W, H, 4);
      if (thumb != 0) ov.SetOverlayRaw(thumb, h.AddrOfPinnedObject(), W, H, 4);
    } finally { h.Free(); }
  }

  // Attach the wrist overlay to the current controller for handRole. Returns
  // true once a controller is found + the transform is applied.
  static bool ApplyWristTransform(CVRSystem sys, CVROverlay ov, ulong main) {
    if (sys == null) return false;
    uint dev = sys.GetTrackedDeviceIndexForControllerRole((ETrackedControllerRole)handRole);
    if (dev == OpenVR.k_unTrackedDeviceIndexInvalid) return false;
    float c = (float)Math.Cos(tiltRad), s = (float)Math.Sin(tiltRad);
    var m = new HmdMatrix34_t {
      m0 = 1, m1 = 0, m2 = 0, m3 = ox,
      m4 = 0, m5 = c, m6 = -s, m7 = oy,
      m8 = 0, m9 = s, m10 = c, m11 = oz,
    };
    ov.SetOverlayTransformTrackedDeviceRelative(main, dev, ref m);
    return true;
  }

  public static void Run(string runtimeDir) {
    Out = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)); Out.AutoFlush = true;
    In = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));

    // Initial config from env (CONFIG lines override live).
    wrist = (Environment.GetEnvironmentVariable("UVS_OVERLAY_MODE") ?? "dashboard") == "wrist";
    handRole = (Environment.GetEnvironmentVariable("UVS_OVERLAY_HAND") ?? "left") == "right" ? 2 : 1;
    sizeM = F(Environment.GetEnvironmentVariable("UVS_OVERLAY_SIZE") ?? "0.22", 0.22f);
    tiltRad = (float)(F(Environment.GetEnvironmentVariable("UVS_OVERLAY_TILT") ?? "-50", -50f) * Math.PI / 180.0);
    oy = F(Environment.GetEnvironmentVariable("UVS_OVERLAY_UP") ?? "0.02", 0.02f);
    oz = F(Environment.GetEnvironmentVariable("UVS_OVERLAY_FWD") ?? "0.06", 0.06f);
    ox = F(Environment.GetEnvironmentVariable("UVS_OVERLAY_RIGHT") ?? "0", 0f);

    if (LoadLibraryEx(Path.Combine(runtimeDir, "openvr_api.dll"), IntPtr.Zero, 0x00000008) == IntPtr.Zero) {
      Emit("ERR\topenvr_api.dll not loadable"); return;
    }
    EVRInitError ie = EVRInitError.None;
    OpenVR.Init(ref ie, EVRApplicationType.VRApplication_Overlay);
    if (ie != EVRInitError.None) { Emit("ERR\tinit " + ie); return; }
    var ov = OpenVR.Overlay;
    var sys = OpenVR.System;
    if (ov == null) { OpenVR.Shutdown(); Emit("ERR\tno overlay iface"); return; }

    try {
      string key = "uvs.chatbox.panel." + System.Diagnostics.Process.GetCurrentProcess().Id;
      ulong main = 0, thumb = 0;
      if (wrist) {
        var e = ov.CreateOverlay(key, "Uv's Chat Box", ref main);
        if (e != EVROverlayError.None) { Emit("ERR\tcreate " + e); return; }
        ov.SetOverlayWidthInMeters(main, sizeM);
        ov.SetOverlayFlag(main, VROverlayFlags.MakeOverlaysInteractiveIfVisible, true);
      } else {
        var e = ov.CreateDashboardOverlay(key, "Uv's Chat Box", ref main, ref thumb);
        if (e != EVROverlayError.None) { Emit("ERR\tcreate " + e); return; }
        ov.SetOverlayWidthInMeters(main, 2.2f);
      }
      ov.SetOverlayInputMethod(main, VROverlayInputMethod.Mouse);
      var scale = new HmdVector2_t { v0 = W, v1 = H };
      ov.SetOverlayMouseScale(main, ref scale);

      var reader = new Thread(ReaderThread); reader.IsBackground = true; reader.Start();
      Push(ov, main, thumb);
      Emit("READY");

      uint evSize = (uint)Marshal.SizeOf(typeof(VREvent_t));
      int tick = 0;
      while (!quit) {
        bool dirty = false;
        lock (gate) { while (inbox.Count > 0) HandleLine(inbox.Dequeue(), ref dirty); }

        // Wrist: keep it attached to the (possibly reconnected) controller and
        // re-apply size/placement when config changed.
        if (wrist && (transformDirty || (tick % 30 == 0))) {
          if (transformDirty) { ov.SetOverlayWidthInMeters(main, sizeM); transformDirty = false; }
          bool ok = ApplyWristTransform(sys, ov, main);
          if (ok && !wristShown) { ov.ShowOverlay(main); wristShown = true; }
          if (!ok && wristShown) { ov.HideOverlay(main); wristShown = false; }
        }

        VREvent_t ev = default(VREvent_t);
        while (ov.PollNextOverlayEvent(main, ref ev, evSize)) {
          uint t = ev.eventType;
          if (t == (uint)EVREventType.VREvent_MouseButtonUp) {
            int px = (int)ev.data.mouse.x, py = (int)(H - ev.data.mouse.y);
            int hit = HitTest(px, py);
            if (hit >= 0) Emit("CLICK\t" + buttons[hit].id);
          } else if (t == (uint)EVREventType.VREvent_MouseMove) {
            int px = (int)ev.data.mouse.x, py = (int)(H - ev.data.mouse.y);
            int nh = HitTest(px, py);
            if (nh != hover) { hover = nh; dirty = true; }
          } else if (t == (uint)EVREventType.VREvent_Quit) {
            quit = true;
          }
        }

        if (dirty) Push(ov, main, thumb);
        tick++;
        Thread.Sleep(16);
      }
    } catch (Exception ex) {
      Emit("ERR\t" + ex.Message.Replace("\t", " ").Replace("\n", " "));
    } finally {
      try { OpenVR.Shutdown(); } catch {}
    }
  }
}
