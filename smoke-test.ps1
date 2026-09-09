# OpenCode config smoke test.
# Static: every .system.push() in plugins must push a SystemPart object
#         ({ type: "text", text: ... }) or the systemPart() helper.
#         A raw string push bricks OpenCode 2.0 sends with "Schema validation failed".
# Static: every TUI plugin listed in cli.json must be a V2 module the running
#         opencode2 TUI will load: default export Plugin.define({ id, setup })
#         or a default object with id + setup(). A default { id, tui } without
#         setup is Invalid V2 TUI plugin module (r5t in opencode2.exe).
#         Source-level — does not depend on the TUI host compiling JSX.
#         Do NOT bun-import TUI JSX here: without the host Plugin inject it
#         always BUN_SKIPs or hangs (20s×N). Source parse is the gate.
# Live (opt-in, costs a few tokens): sends a real prompt through the
#         background opencode2 service and asserts a reply. Never wait on
#         the live service unless -Live.
#
# Hang class: agent shells keep stdin a pipe without EOF. bun then looks like
# a REPL and never exits. Start-Process -NoNewWindow + WaitForExit can also
# refuse to time out on that pipe, so the reviewer kills us at 300s.
# Fix: run bun with CreateNoWindow + stdin closed; 45s watchdog process
# (ping+taskkill this PID only — never opencode2/TUI) so we fail loud <60s.

param([switch]$Live, [switch]$DesktopProbe)

$ErrorActionPreference = "Stop"
$script:SmokeStart = [datetime]::UtcNow
function Write-SmokeStep([string]$msg) {
  $ms = [int]([datetime]::UtcNow - $script:SmokeStart).TotalMilliseconds
  Write-Host "smoke-test[+${ms}ms]: $msg"
}
Write-SmokeStep "start"
$root = $PSScriptRoot
Write-SmokeStep "v2 runtime identity"
& (Join-Path $root "scripts\restart-opencode.ps1") -Status
if ($LASTEXITCODE -ne 0) {
  Write-Host "FAIL: v2 runtime identity" -ForegroundColor Red
  exit $LASTEXITCODE
}
# The plugin directory is plugins-active; "plugins" has not existed for a while.
# Get-ChildItem -Recurse on a missing path burns ~25s per call before returning
# nothing, so two stale scans alone tripped the 45s watchdog and no gate after
# them ever ran.
$plugins = @("plugins-active", "quest", "orchestration", "models", "usage", "harnesses", "papercut") | ForEach-Object { Join-Path $root $_ }
$bad = @()
$tmp = Join-Path $env:LOCALAPPDATA "Temp\opencode"
if (-not (Test-Path $tmp)) { New-Item -ItemType Directory -Path $tmp | Out-Null }

function Get-BunExe {
  $cmd = Get-Command bun -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source) { return $cmd.Source }
  $alt = Join-Path $env:USERPROFILE ".bun\bin\bun.exe"
  if (Test-Path -LiteralPath $alt) { return $alt }
  return "bun"
}

# Isolated bun: CreateNoWindow, stdin closed (not inherited agent pipe),
# stdout/stderr drained async. Never Start-Process -NoNewWindow.
# Timeout kills the bun tree only (Kill(true) / taskkill /T on that PID).
function Invoke-BunClosedStdin {
  param(
    [Parameter(Mandatory)][string[]]$ArgumentList,
    [int]$TimeoutMs = 15000
  )
  $bun = Get-BunExe
  $argStr = ($ArgumentList | ForEach-Object {
    if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ }
  }) -join ' '
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $bun
  $psi.Arguments = $argStr
  $psi.WorkingDirectory = (Get-Location).Path
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  try { $psi.Environment["CI"] = "1"; $psi.Environment["NO_COLOR"] = "1" } catch {}
  $p = New-Object System.Diagnostics.Process
  $p.StartInfo = $psi
  [void]$p.Start()
  $p.StandardInput.Close()
  $outTask = $p.StandardOutput.ReadToEndAsync()
  $errTask = $p.StandardError.ReadToEndAsync()
  if (-not $p.WaitForExit($TimeoutMs)) {
    $pidToKill = $p.Id
    try { $p.Kill($true) } catch {
      try { $p.Kill() } catch {}
    }
    Stop-HiddenProcessTree $pidToKill
    $null = $p.WaitForExit(2000)
    return [pscustomobject]@{ Code = 124; Out = "TIMEOUT after ${TimeoutMs}ms: bun $argStr" }
  }
  $out = ""
  $err = ""
  try { $out = $outTask.GetAwaiter().GetResult() } catch {}
  try { $err = $errTask.GetAwaiter().GetResult() } catch {}
  return [pscustomobject]@{ Code = $p.ExitCode; Out = "$out$err" }
}

function Stop-HiddenProcessTree([int]$TargetPid) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "$env:SystemRoot\System32\taskkill.exe"
  foreach($a in @('/PID',[string]$TargetPid,'/T','/F')) { $psi.ArgumentList.Add($a) }
  $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
  $psi.RedirectStandardInput = $true; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
  $p = New-Object System.Diagnostics.Process; $p.StartInfo=$psi; [void]$p.Start(); $p.StandardInput.Close(); [void]$p.WaitForExit(3000)
}

# Fail loud at 45s even if WaitForExit hangs. Kills this smoke-test PID only.
function Start-SmokeWatchdog([int]$TimeoutSec = 45) {
  $reason = Join-Path $tmp "smoke-watchdog-$PID.txt"
  $n = $TimeoutSec + 1
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = (Get-Command pwsh).Source
  foreach($a in @('-NoProfile','-NonInteractive','-Command',"Start-Sleep -Seconds $TimeoutSec; Set-Content -LiteralPath '$reason' -Value 'FAIL: smoke-test hung'; Stop-Process -Id $PID -Force")) { $psi.ArgumentList.Add($a) }
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $w = New-Object System.Diagnostics.Process
  $w.StartInfo = $psi
  [void]$w.Start()
  $w.StandardInput.Close()
  return @{ Process = $w; ReasonFile = $reason }
}

$watchdog = Start-SmokeWatchdog 45
Write-SmokeStep "watchdog pid=$($watchdog.Process.Id) (45s, this PID $PID only)"
try {

foreach ($pluginRoot in $plugins) { if (-not (Test-Path -LiteralPath $pluginRoot)) { Write-Host "FAIL: plugin directory not found: $pluginRoot" -ForegroundColor Red; exit 1 } }
Get-ChildItem $plugins -Recurse -File -Filter *.ts | ForEach-Object {
  $lines = Get-Content $_.FullName
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -notmatch "\bpush\(") { continue }
    if ($lines[$i] -notmatch "system") { continue }
    $joined = ($lines[$i] + $lines[$i + 1]).Trim()
    $ok = $joined -match "systemPart\(" -or $joined -match '\{ type: ?"text"'
    if (-not $ok) {
      $bad += "{0}:{1} {2}" -f $_.Name, ($i + 1), $lines[$i].Trim()
    }
  }
}

if ($bad.Count -gt 0) {
  Write-Host "FAIL: unsafe system push detected (raw strings brick opencode2 sends):" -ForegroundColor Red
  $bad | ForEach-Object { Write-Host "  $_" }
  exit 1
}

Write-Host "PASS: all system pushes are SystemPart objects." -ForegroundColor Green

function Strip-JsComments([string]$src) {
  $out = [regex]::Replace($src, '(?s)/\*.*?\*/', '')
  $out = [regex]::Replace($out, '(?m)^\s*//.*?$', '')
  return $out
}

function Get-BalancedObject([string]$code, [int]$openBrace) {
  if ($openBrace -lt 0 -or $openBrace -ge $code.Length -or $code[$openBrace] -ne '{') { return $null }
  $depth = 0
  $inStr = [char]0
  $escape = $false
  for ($i = $openBrace; $i -lt $code.Length; $i++) {
    $ch = $code[$i]
    if ($inStr -ne [char]0) {
      if ($escape) { $escape = $false; continue }
      if ($ch -eq [char]0x5C) { $escape = $true; continue }
      if ($ch -eq $inStr) { $inStr = [char]0 }
      continue
    }
    if ($ch -eq [char]'"' -or $ch -eq [char]'''' -or $ch -eq [char]'`') { $inStr = $ch; continue }
    if ($ch -eq [char]'{') { $depth++ }
    elseif ($ch -eq [char]'}') {
      $depth--
      if ($depth -eq 0) { return $code.Substring($openBrace, $i - $openBrace + 1) }
    }
  }
  return $null
}

function Get-DefaultExportObject([string]$code) {
  $m = [regex]::Match($code, 'export\s+default\s+Plugin\.define\s*\(\s*\{')
  if ($m.Success) {
    return Get-BalancedObject $code ($m.Index + $m.Length - 1)
  }
  $m = [regex]::Match($code, 'export\s+default\s+\{')
  if ($m.Success) {
    return Get-BalancedObject $code ($m.Index + $m.Length - 1)
  }
  $m = [regex]::Match($code, 'export\s+default\s+([A-Za-z_$][\w$]*)')
  if (-not $m.Success) { return $null }
  $name = $m.Groups[1].Value
  $assign = [regex]::Match($code, ("(?:const|let|var)\s+" + [regex]::Escape($name) + "\b[\s\S]*?=\s*(?:Plugin\.define\s*\(\s*)?\{"))
  if (-not $assign.Success) { return $null }
  return Get-BalancedObject $code ($assign.Index + $assign.Length - 1)
}

# Live opencode2 r5t: object with non-empty string id AND setup function.
# Reject default { id, tui } without setup — that is Invalid V2 TUI plugin module.
function Test-TuiPluginSource([string]$src, [string]$label) {
  $code = Strip-JsComments $src
  if ($code -match 'export\s*\{[^}]*\bserver\b') {
    return "${label}: TUI modules cannot export server"
  }
  $obj = Get-DefaultExportObject $code
  if (-not $obj) {
    return "${label}: default export must be Plugin.define({ id, setup }) or { id, setup }"
  }
  if ($obj -match '\bserver\s*:') {
    return "${label}: TUI modules cannot export server"
  }
  $idMatch = [regex]::Match($obj, '\bid\s*:\s*["'']([^"'']*)["'']')
  if (-not $idMatch.Success) {
    $idMatch = [regex]::Match($obj, '\bid\s*:\s*`([^`]*)`')
  }
  $id = if ($idMatch.Success) { $idMatch.Groups[1].Value } else { "" }
  if ([string]::IsNullOrWhiteSpace($id)) {
    return "${label}: empty/missing id"
  }
  $hasSetup = $obj -match '\bsetup\s*(\(|:|,|\})'
  $hasTui = $obj -match '\btui\s*(:|,|\})'
  if (-not $hasSetup) {
    if ($hasTui) {
      return "${label}: default { id, tui } without setup is Invalid V2 TUI plugin module"
    }
    return "${label}: default export missing setup()"
  }
  return $null
}

$oldShape = @'
const tui = async () => {}
const plugin = {
  id: "usage-sessions",
  tui,
}
export default plugin
'@
$oldErr = Test-TuiPluginSource $oldShape "<self-test {id,tui}>"
if (-not $oldErr) {
  Write-Host "FAIL: TUI gate did not reject default { id, tui } without setup (the shape opencode2 calls Invalid V2 TUI plugin module)." -ForegroundColor Red
  exit 1
}

$goodShape = @'
export default Plugin.define({
  id: "usage-sessions",
  setup(context) {}
})
'@
$goodErr = Test-TuiPluginSource $goodShape "<self-test Plugin.define>"
if ($goodErr) {
  Write-Host "FAIL: TUI gate rejected valid Plugin.define: $goodErr" -ForegroundColor Red
  exit 1
}

$cliJsonPath = Join-Path $root "cli.json"
if (-not (Test-Path $cliJsonPath)) {
  Write-Host "FAIL: missing cli.json at $cliJsonPath" -ForegroundColor Red
  exit 1
}

$cliJson = Get-Content $cliJsonPath -Raw | ConvertFrom-Json
$listed = @($cliJson.plugins)
if ($listed.Count -eq 0) {
  Write-Host "FAIL: cli.json plugins array is empty" -ForegroundColor Red
  exit 1
}

$tuiBad = @()
foreach ($rel in $listed) {
  $relNorm = [string]$rel
  if ([string]::IsNullOrWhiteSpace($relNorm)) {
    $tuiBad += "cli.json lists an empty plugin path"
    continue
  }
  $path = $relNorm
  if ($path.StartsWith("./") -or $path.StartsWith(".\") ) { $path = $path.Substring(2) }
  $full = Join-Path $root $path
  if (-not (Test-Path -LiteralPath $full)) {
    $tuiBad += "MISSING: $relNorm"
    continue
  }
  # beta-19059 resolves a plugin DIRECTORY to <dir>/tui.* and silently skips a
  # cli.json entry that names a file, so every entry must be a directory that
  # holds a tui module.
  if (-not (Test-Path -LiteralPath $full -PathType Container)) {
    $tuiBad += "${relNorm}: cli.json plugins must name a directory holding tui.tsx (the host skips file entries silently)"
    continue
  }
  $entry = @("tui.tsx", "tui.ts", "tui.jsx", "tui.js") | ForEach-Object { Join-Path $full $_ } | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
  if (-not $entry) {
    $tuiBad += "${relNorm}: no tui.tsx/tui.ts entrypoint in the plugin directory"
    continue
  }
  $src = Get-Content -LiteralPath $entry -Raw
  $err = Test-TuiPluginSource $src $relNorm
  if ($err) { $tuiBad += $err }
}

if ($tuiBad.Count -gt 0) {
  Write-Host "FAIL: invalid V2 TUI plugin module:" -ForegroundColor Red
  $tuiBad | ForEach-Object { Write-Host "  $_" }
  exit 1
}

Write-Host "PASS: TUI plugins in cli.json are Plugin.define / { id, setup } (not { id, tui })." -ForegroundColor Green
Write-Host "PASS: TUI gate self-test rejects { id, tui } without setup." -ForegroundColor Green

# bun:test must not live under plugins/ — the TUI/plugin loader can evaluate
# sibling .ts files and throw "Cannot use test outside of the test runner".
$bunTestHits = @()
Get-ChildItem $plugins -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
  $text = Get-Content -LiteralPath $_.FullName -Raw -ErrorAction SilentlyContinue
  if ($null -eq $text) { return }
  if ($text.Contains('from "bun:test"') -or $text.Contains("from 'bun:test'")) {
    $rel = $_.FullName.Substring($root.Length).TrimStart('\', '/')
    $bunTestHits += $rel.Replace('\', '/')
  }
}
if ($bunTestHits.Count -gt 0) {
  Write-Host "FAIL: bun:test import under plugins/ (TUI loader will throw 'Cannot use test outside of the test runner'):" -ForegroundColor Red
  $bunTestHits | ForEach-Object { Write-Host "  $_" }
  exit 1
}
Write-Host "PASS: no bun:test imports under plugins/." -ForegroundColor Green

# Exact configured-entrypoint preflight. This is deliberately a separate Bun
# process: syntax/import failures are quarantined before the live host sees a
# candidate. Helpers outside configured entrypoints are never loaded.
Write-SmokeStep "configured plugin entrypoint preflight"
Push-Location $root
try { $pluginRun = Invoke-BunClosedStdin -ArgumentList @("run", "plugin-health.ts") -TimeoutMs 12000 } finally { Pop-Location }
if ($pluginRun.Code -ne 0) {
  Write-Host "FAIL: configured plugin entrypoint preflight (candidate quarantined; active set unchanged)" -ForegroundColor Red
  Write-Host $pluginRun.Out
  exit 1
}
Write-Host "PASS: configured plugin entrypoints load/source-validate in isolated preflight." -ForegroundColor Green

Write-SmokeStep "shell guard self-test"
$shellGuardRun = Invoke-BunClosedStdin -ArgumentList @("run", "scripts/shell-guard.ts", "--self-test") -TimeoutMs 4000
if ($shellGuardRun.Code -ne 0) {
  Write-Host "FAIL: Windows shell guard self-test" -ForegroundColor Red
  Write-Host $shellGuardRun.Out
  exit 1
}
Write-Host "PASS: Windows shell guard self-test." -ForegroundColor Green

Write-SmokeStep "headless process policy"
$headlessRun = Invoke-BunClosedStdin -ArgumentList @("run", "scripts/headless-guard.ts") -TimeoutMs 6000
if ($headlessRun.Code -ne 0) {
  Write-Host "FAIL: background process callsite is not headless" -ForegroundColor Red
  Write-Host $headlessRun.Out
  exit 1
}
Write-Host "PASS: background process callsites satisfy headless policy." -ForegroundColor Green

# Desktop inspection is explicitly opt-in; ordinary validation stays headless.
if ($DesktopProbe) {
  Write-SmokeStep "focus sentinel"
  & (Join-Path $root "scripts\focus-sentinel.ps1")
}

Write-SmokeStep "self-test: bun timeout helper (sleep 60s, cap 2.5s)"
Push-Location $root
try {
  $hangRun = Invoke-BunClosedStdin -ArgumentList @("-e", "await Bun.sleep(60000)") -TimeoutMs 2500
} finally {
  Pop-Location
}
if ($hangRun.Code -ne 124) {
  Write-Host "FAIL: bun timeout helper did not fire (code=$($hangRun.Code); expected 124). A hung bun would sit until the 300s reviewer kill." -ForegroundColor Red
  Write-Host $hangRun.Out
  exit 1
}
Write-Host "PASS: bun timeout helper fires (124) instead of hanging." -ForegroundColor Green

# /usage keymap must register from a mounted slot, not setup()
# (setup() is outside Keymap.Provider → "Keymap.Provider is missing").
Write-SmokeStep "bun test usage+quota-cap (max 20s)"
$usageTests = @(
  "test/tui-usage.test.ts",
  "test/tui-dialog.test.ts",
  "test/tui-quests.test.ts",
  "test/tui-slots.test.ts",
  "test/quota-cap-failover.test.ts",
  "test/usage-reached.test.ts",
  "test/usage-format.test.ts",
  "test/usage-cell-format.test.ts",
  "test/plugin-loader.test.ts"
)
$missingUsageTests = @($usageTests | Where-Object { -not (Test-Path -LiteralPath (Join-Path $root $_) -PathType Leaf) })
if ($missingUsageTests.Count -gt 0) {
  Write-Host "FAIL: focused Bun test path missing: $($missingUsageTests -join ', ')" -ForegroundColor Red
  exit 1
}
Push-Location $root
try {
# Every path must exist. bun treats a missing file as a name FILTER and then
# walks the whole tree looking for it — which drags every generations/ copy of
# the suite into the run, executing stale tests against the live config.
  $usageArgs = @("test") + $usageTests
  $usageRun = Invoke-BunClosedStdin -ArgumentList $usageArgs -TimeoutMs 20000
  $usageOut = $usageRun.Out
  $usageCode = $usageRun.Code
} finally {
  Pop-Location
}
$usageText = ($usageOut | Out-String).Trim()
if ($usageCode -ne 0) {
  Write-Host "FAIL: bun test focused usage/quota/plugin-loader tests" -ForegroundColor Red
  Write-Host $usageText
  exit 1
}
Write-Host "PASS: bun test focused usage/quota/plugin-loader tests" -ForegroundColor Green
if ($usageText) { Write-Host $usageText }

if ($Live) {
  Write-Host "Running live check through opencode2 service..." -ForegroundColor Yellow
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $hostIdentity = (& node (Join-Path $PSScriptRoot 'scripts/host-status.mjs') | ConvertFrom-Json)
  if ($LASTEXITCODE -ne 0) { throw 'OpenCode2 identity could not be verified' }
  $psi.FileName = $hostIdentity.executable
  foreach($a in @('run','-m','openai/gpt-5.6-luna-fast','--agent','general','--auto','Reply with exactly: OK')) { $psi.ArgumentList.Add($a) }
  $psi.UseShellExecute=$false; $psi.CreateNoWindow=$true; $psi.RedirectStandardInput=$true; $psi.RedirectStandardOutput=$true; $psi.RedirectStandardError=$true
  $lp=New-Object System.Diagnostics.Process; $lp.StartInfo=$psi; [void]$lp.Start(); $lp.StandardInput.Close(); $ot=$lp.StandardOutput.ReadToEndAsync(); $et=$lp.StandardError.ReadToEndAsync()
  if(-not $lp.WaitForExit(20000)){ Stop-HiddenProcessTree $lp.Id; $out='TIMEOUT' } else { $out=$ot.Result+$et.Result }
  if ($out -notmatch "\bError\b" -and $out -match "\bOK\b") {
    Write-Host "PASS: live send works." -ForegroundColor Green
  } else {
    Write-Host "FAIL: live send failed. Output:" -ForegroundColor Red
    Write-Host ($out.Substring(0, [Math]::Min(600, $out.Length)))
    exit 1
  }
}

Write-SmokeStep "OK: opencode config is healthy."
Write-Host "OK: opencode config is healthy."

} finally {
  if ($watchdog -and $watchdog.Process -and -not $watchdog.Process.HasExited) {
    $wid = $watchdog.Process.Id
    try { $watchdog.Process.Kill($true) } catch {
      try { $watchdog.Process.Kill() } catch {}
    }
    Stop-HiddenProcessTree $wid
  }
  if ($watchdog -and $watchdog.ReasonFile -and (Test-Path -LiteralPath $watchdog.ReasonFile)) {
    Remove-Item -LiteralPath $watchdog.ReasonFile -Force -ErrorAction SilentlyContinue
  }
}
