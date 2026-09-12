# Toggle the Ask overlay on Alt+Space and Win+C. Win+S / Win+Shift+S stay with Windows.
$edge = @(
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
$ud = Join-Path $env:LOCALAPPDATA 'oc-search-shim'
if (-not $edge) { exit 0 }

$code = @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

public class SearchShimHook {
  public const int WH_KEYBOARD_LL = 13;
  public const int WM_KEYDOWN = 0x0100;
  public const int WM_SYSKEYDOWN = 0x0104;
  public const int VK_S = 0x53;
  public const int VK_C = 0x43;
  public const int VK_SPACE = 0x20;
  public const int VK_LWIN = 0x5B;
  public const int VK_RWIN = 0x5C;
  public const int VK_MENU = 0x12;

  public delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);

  [DllImport("user32.dll")] public static extern IntPtr SetWindowsHookEx(int idHook, HookProc lpfn, IntPtr hMod, uint dwThreadId);
  [DllImport("user32.dll")] public static extern bool UnhookWindowsHookEx(IntPtr hhk);
  [DllImport("user32.dll")] public static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
  [DllImport("kernel32.dll")] public static extern IntPtr GetModuleHandle(string lpModuleName);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint min, uint max);
  [DllImport("user32.dll")] public static extern bool TranslateMessage(ref MSG lpMsg);
  [DllImport("user32.dll")] public static extern IntPtr DispatchMessage(ref MSG lpMsg);

  [StructLayout(LayoutKind.Sequential)]
  public struct MSG {
    public IntPtr hwnd;
    public uint message;
    public IntPtr wParam;
    public IntPtr lParam;
    public uint time;
    public int pt_x;
    public int pt_y;
  }

  static IntPtr hook = IntPtr.Zero;
  static HookProc proc;
  static string edge;
  static string userData;

  public static void Run(string edgePath, string userDataDir) {
    edge = edgePath;
    userData = userDataDir;
    proc = HookCallback;
    using (Process cur = Process.GetCurrentProcess())
    using (ProcessModule mod = cur.MainModule) {
      hook = SetWindowsHookEx(WH_KEYBOARD_LL, proc, GetModuleHandle(mod.ModuleName), 0);
    }
    MSG msg;
    while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) {
      TranslateMessage(ref msg);
      DispatchMessage(ref msg);
    }
  }

  static bool WinDown() { return (GetAsyncKeyState(VK_LWIN) & 0x8000) != 0 || (GetAsyncKeyState(VK_RWIN) & 0x8000) != 0; }
  static bool AltDown() { return (GetAsyncKeyState(VK_MENU) & 0x8000) != 0; }

  static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam) {
    if (nCode >= 0 && (wParam == (IntPtr)WM_KEYDOWN || wParam == (IntPtr)WM_SYSKEYDOWN)) {
      int vk = Marshal.ReadInt32(lParam);
      bool hit = (vk == VK_C && WinDown()) || (vk == VK_SPACE && AltDown());
      if (hit) {
        try { Toggle(); } catch {}
        return (IntPtr)1;
      }
    }
    return CallNextHookEx(hook, nCode, wParam, lParam);
  }

  static void Toggle() {
    foreach (var p in Process.GetProcessesByName("msedge")) {
      try {
        if (p.MainWindowHandle != IntPtr.Zero && p.MainWindowTitle == "Ask") {
          ShowWindow(p.MainWindowHandle, 9);
          SetForegroundWindow(p.MainWindowHandle);
          return;
        }
      } catch {}
    }
    var psi = new ProcessStartInfo(edge);
    psi.Arguments = "--user-data-dir=\"" + userData + "\" --app=http://127.0.0.1:8320/ --window-size=780,560 --window-position=560,180";
    psi.UseShellExecute = false;
    Process.Start(psi);
  }
}
'@

Add-Type -TypeDefinition $code -ErrorAction Stop
[SearchShimHook]::Run($edge, $ud)
