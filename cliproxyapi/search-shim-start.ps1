# Detached start for the OpenCode search shim. Safe to run from Startup.
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$bun = Join-Path $env:USERPROFILE '.bun\bin\bun.exe'
$logDir = Join-Path $env:USERPROFILE '.config\opencode\run\runtime'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Test-Port([int]$Port) {
  return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Start-Detached([string]$Exe, [string]$Args, [string]$WorkDir) {
  $cmd = if ($Args) { "`"$Exe`" $Args" } else { "`"$Exe`"" }
  Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = $cmd
    CurrentDirectory = $(if ($WorkDir) { $WorkDir } else { $root })
  } | Out-Null
}

if (-not (Test-Port 3011)) {
  Start-Detached $bun "`"$env:USERPROFILE\.config\opencode\models\grok-sub-proxy.ts`"" $root
}
if (-not (Test-Port 8320)) {
  Start-Detached $bun "`"$root\search-shim.ts`"" $root
}

$ok = $false
foreach ($i in 1..30) {
  try {
    if ((Invoke-RestMethod -Uri 'http://127.0.0.1:8320/health' -TimeoutSec 1).ok) { $ok = $true; break }
  } catch {}
  Start-Sleep -Milliseconds 200
}
if (-not $ok) { throw "search-shim did not come up on :8320" }

$edge = @(
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
$ud = Join-Path $env:LOCALAPPDATA 'oc-search-shim'
New-Item -ItemType Directory -Force -Path $ud | Out-Null
$appRunning = [bool](Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -match 'oc-search-shim' })
if ($edge -and -not $appRunning) {
  Start-Detached $edge "--user-data-dir=`"$ud`" --app=http://127.0.0.1:8320/ --window-size=780,560 --window-position=560,180" $ud
}

$hot = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'search-shim-hotkey.ps1' }
if (-not $hot) {
  Start-Detached 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$root\search-shim-hotkey.ps1`"" $root
}

Write-Host 'search-shim ready  http://127.0.0.1:8320/  Alt+Space / Win+C'
