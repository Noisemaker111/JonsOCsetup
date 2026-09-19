# Presses keys in an already-open terminal window and photographs it after each press.
# Steps are JSON lines: {"send":"<SendKeys string>","label":"...","wait":1200} or
# {"shot":"<name>"} or {"wait":5000}. It refuses to send unless the foreground window is the one
# whose title it matched, which is what keeps stray keystrokes out of Jon's other tabs.
param(
  [string]$TitleLike,
  # The window handle the launcher printed. Preferred: once the host starts, it renames the tab to
  # "OpenCode", which is also what Jon's own live window is called, and typing into that one would be
  # exactly the accident this whole harness exists to avoid.
  [long]$Handle = 0,
  [Parameter(Mandatory = $true)][string]$Steps,
  [Parameter(Mandatory = $true)][string]$Out
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class W3 {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc lpEnumFunc, IntPtr lParam);
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder s, int max);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int max);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
}
"@
New-Item -ItemType Directory -Force -Path $Out | Out-Null
if ($Handle -ne 0) {
  $hwnd = [IntPtr]$Handle
  if (-not [W3]::IsWindowVisible($hwnd)) { throw "Window $Handle is gone" }
  $t = New-Object Text.StringBuilder 512; [void][W3]::GetWindowText($hwnd, $t, 512)
  Write-Host "target window $Handle title '$($t.ToString())'"
} else {
  if (-not $TitleLike) { throw "Pass -Handle or -TitleLike" }
  $script:hits = @()
  $cb = [W3+EnumProc]{ param($h, $l)
    $c = New-Object Text.StringBuilder 256; [void][W3]::GetClassName($h, $c, 256)
    if ($c.ToString() -eq "CASCADIA_HOSTING_WINDOW_CLASS" -and [W3]::IsWindowVisible($h)) {
      $t = New-Object Text.StringBuilder 512; [void][W3]::GetWindowText($h, $t, 512)
      if ($t.ToString() -like $TitleLike) { $script:hits += $h }
    }
    return $true }
  [void][W3]::EnumWindows($cb, [IntPtr]::Zero)
  if ($script:hits.Count -ne 1) { throw "Expected exactly one window like '$TitleLike', found $($script:hits.Count)" }
  $hwnd = $script:hits[0]
}
$shell = New-Object -ComObject WScript.Shell
[void][W3]::SetForegroundWindow($hwnd)
Start-Sleep -Milliseconds 500
if ([W3]::GetForegroundWindow() -ne $hwnd) {
  $shell.SendKeys("%"); Start-Sleep -Milliseconds 250
  [void][W3]::SetForegroundWindow($hwnd); Start-Sleep -Milliseconds 500
}
if ([W3]::GetForegroundWindow() -ne $hwnd) { throw "Foreground is not the target window; refusing to send keys" }
Write-Host "foreground confirmed on $hwnd"

function Shot([string]$name) {
  $r = New-Object W3+RECT
  [void][W3]::GetWindowRect($hwnd, [ref]$r)
  $w = $r.Right - $r.Left; $h = $r.Bottom - $r.Top
  $bmp = New-Object Drawing.Bitmap $w, $h
  $g = [Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($r.Left, $r.Top, 0, 0, (New-Object Drawing.Size $w, $h))
  $bmp.Save((Join-Path $Out "$name.png"), [Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  Write-Host "  shot $name"
}

foreach ($line in (Get-Content $Steps)) {
  if (-not $line.Trim()) { continue }
  $step = $line | ConvertFrom-Json
  if ($step.shot) { Shot $step.shot; continue }
  if ($step.send) {
    if ([W3]::GetForegroundWindow() -ne $hwnd) { throw "Lost foreground before $($step.label)" }
    Write-Host "  -> $($step.label)"
    $shell.SendKeys($step.send)
  }
  Start-Sleep -Milliseconds ([int]($step.wait | ForEach-Object { if ($_) { $_ } else { 1200 } }))
}
Write-Host "done"
