# Runs the prepared candidate host in its OWN new Windows Terminal window, brings that exact window
# to the foreground, injects real key presses at the Win32 input layer so Windows Terminal's own
# encoder produces the bytes, and photographs the window after each press. This is the only path that
# exercises the terminal Jon actually types into; the PTY drive uses an embedded terminal that
# answers the kitty keyboard query and therefore reports modifiers Windows Terminal never sends.
# It never touches an existing window: it matches its own probe title and refuses to send a key
# unless the foreground handle is the one it found. Host state is redirected into the output
# directory, so it writes nothing into the real session database or quest ledger.
param(
  [Parameter(Mandatory = $true)][string]$Release,
  [Parameter(Mandatory = $true)][string]$Out,
  [string]$Model = "opencode-go/kimi-k3",
  [string]$Cwd = "C:\Users\Jk101\Projects\JonsOCsetup",
  [int]$BootSeconds = 35,
  # Diagnostic builds of the composer plugin append one JSON line per Backspace press here.
  [string]$ComposerDebug = "",
  # Boot and leave the window for a separate press script instead of running the built-in scenario.
  [switch]$BootOnly
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class W2 {
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

$title = "OCPHYSICAL"
New-Item -ItemType Directory -Force -Path $Out | Out-Null

function Find-Window([string]$match) {
  $script:hits = @()
  $cb = [W2+EnumProc]{
    param($h, $l)
    $cls = New-Object Text.StringBuilder 256
    [void][W2]::GetClassName($h, $cls, 256)
    if ($cls.ToString() -eq "CASCADIA_HOSTING_WINDOW_CLASS" -and [W2]::IsWindowVisible($h)) {
      $t = New-Object Text.StringBuilder 512
      [void][W2]::GetWindowText($h, $t, 512)
      if ($t.ToString() -like $match) { $script:hits += [pscustomobject]@{ Handle = $h; Title = $t.ToString() } }
    }
    return $true
  }
  [void][W2]::EnumWindows($cb, [IntPtr]::Zero)
  return $script:hits
}

# A launch script rather than one long command line: the isolation variables have to be set in the
# window's own environment, and quoting that through wt and cmd is where the previous attempt broke.
$script = Join-Path $Release "scripts\opencode-runtime.mjs"
$launch = Join-Path $Out "launch.cmd"
@"
@echo off
set OPENCODE_CONFIG_PROJECT_DISABLE=1
set OPENCODE_DB=$Out\host.db
set OPENCODE_QUEST_ROOT=$Out\quests
set OPENCODE_ORCHESTRATION_LEDGER=$Out\orchestration.jsonl
set OPENCODE_TELEMETRY_FILE=$Out\requests.jsonl
set XDG_STATE_HOME=$Out\state
set OPENCODE_RELEASE_CHANNEL=dev
set OPENCODE_DISABLE_AUTOUPDATE=1
set COMPOSER_DEBUG=$ComposerDebug
node "$script" --config-root "$Release" --cwd "$Cwd" --model $Model --auto
"@ | Set-Content -Path $launch -Encoding ascii

Write-Host "launching host window"
Start-Process wt.exe -ArgumentList @("-w", "-1", "new-tab", "--title", $title, "-d", $Release, "cmd", "/k", $launch)

$win = $null
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Milliseconds 500
  $hits = Find-Window "*$title*"
  if ($hits.Count -eq 1) { $win = $hits[0]; break }
  if ($hits.Count -gt 1) { throw "More than one window matches $title; refusing to send" }
}
if (-not $win) { throw "Host window never appeared" }
Write-Host ("found window {0} title '{1}'" -f $win.Handle, $win.Title)

$shell = New-Object -ComObject WScript.Shell
[void][W2]::SetForegroundWindow($win.Handle)
Start-Sleep -Milliseconds 500
if ([W2]::GetForegroundWindow() -ne $win.Handle) {
  $shell.SendKeys("%")
  Start-Sleep -Milliseconds 250
  [void][W2]::SetForegroundWindow($win.Handle)
  Start-Sleep -Milliseconds 500
}
if ([W2]::GetForegroundWindow() -ne $win.Handle) { throw "Foreground is not the host window; refusing to send keys" }
Write-Host "foreground confirmed; waiting $BootSeconds s for the host to paint"
Start-Sleep -Seconds $BootSeconds

function Shot([string]$name) {
  $r = New-Object W2+RECT
  [void][W2]::GetWindowRect($win.Handle, [ref]$r)
  $w = $r.Right - $r.Left; $h = $r.Bottom - $r.Top
  $bmp = New-Object Drawing.Bitmap $w, $h
  $g = [Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($r.Left, $r.Top, 0, 0, (New-Object Drawing.Size $w, $h))
  $path = Join-Path $Out "$name.png"
  $bmp.Save($path, [Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  Write-Host "  captured $path"
}

function Send([string]$keys, [string]$label) {
  if ([W2]::GetForegroundWindow() -ne $win.Handle) { throw "Lost foreground before $label" }
  Write-Host "  -> $label"
  $shell.SendKeys($keys)
  Start-Sleep -Milliseconds 1200
}

Shot "00-booted"
if ($BootOnly) { Write-Host ("BOOTED handle={0}" -f $win.Handle); exit 0 }
Send "alpha beta gamma delta" "type a multi-word draft"
Shot "01-typed"
Send "^{BS}" "physical Ctrl+Backspace 1"
Shot "02-ctrl-backspace-1"
Send "^{BS}" "physical Ctrl+Backspace 2"
Shot "03-ctrl-backspace-2"
Send "{BS}" "plain Backspace"
Shot "04-plain-backspace"
Send "^{BS}" "physical Ctrl+Backspace 3"
Shot "05-ctrl-backspace-3"
Write-Host "done; window left open for inspection"
