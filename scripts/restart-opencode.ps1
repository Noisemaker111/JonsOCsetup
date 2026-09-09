<#
.SYNOPSIS
  Inspect or prepare the selected OpenCode release. Never deploy dirty source on restart.
.DESCRIPTION
  Managed terminals restart only their owned child through opencode-runtime.mjs.
  Legacy callers receive instructions instead of terminating unrelated hosts.
  -Update refuses while any OpenCode host is running.
#>
[CmdletBinding()]
param(
  [switch]$Status,
  [switch]$Update,
  [string]$SessionID = "",
  [switch]$NoDeploy,
  [switch]$DryRun,
  [switch]$PrepareOnly
)

$ErrorActionPreference = "Stop"
$ConfigRoot = Split-Path -Parent $PSScriptRoot
$LogFile = Join-Path $ConfigRoot "run" "restart-last.log"
$resolver = Join-Path $ConfigRoot 'project-router/executable.mjs'
$exe = (& node --input-type=module -e 'import {pathToFileURL} from "node:url"; const m=await import(pathToFileURL(process.argv[1]).href); process.stdout.write(m.resolveHostExecutable())' $resolver | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve the selected native OpenCode host' }

function Write-RestartLog([string]$msg) {
  try {
    $dir = Split-Path -Parent $LogFile
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    Add-Content -LiteralPath $LogFile -Value ("[{0}] {1}" -f (Get-Date -Format o), $msg) -ErrorAction SilentlyContinue
  } catch {}
}

function Get-Opencode2 {
  if (-not (Test-Path -LiteralPath $exe)) {
    throw "opencode2 not found at $exe"
  }
  return $exe
}

function Assert-V2([string]$path) {
  $version = (& $path --version | Out-String).Trim()
  if ($version -notmatch '^opencode2 v0\.0\.0-beta-\d+$') {
    throw "Refusing restart: expected a v2 beta opencode2 host, got '$version'"
  }
  return $version
}

function Install-Latest {
  $package = if ($exe -match '[\\/]@opencode[\\/]cli[\\/]') { "@opencode/cli" } elseif ($exe -match '[\\/]@opencode-ai[\\/]cli[\\/]') { "@opencode-ai/cli" } else { throw "Explicit custom host cannot be updated through npm automatically" }
  $npmDir = Join-Path $env:APPDATA "npm"
  if (Test-Path -LiteralPath $npmDir) { $env:Path = "$npmDir;$env:Path" }
  npm i -g "$package@latest"
  if ($LASTEXITCODE -ne 0) { throw "npm update for $package failed with exit $LASTEXITCODE" }
}

function Get-ActiveGeneration {
  $pointer = Join-Path $ConfigRoot "plugin-activation.json"
  if (-not (Test-Path -LiteralPath $pointer)) { return "" }
  try { return (Get-Content -LiteralPath $pointer -Raw | ConvertFrom-Json).activeGeneration } catch { return "" }
}

function Get-RelaunchArgs {
  if ($SessionID -ne "") { return @("--session", $SessionID) }
  return @("--continue")
}

function Restart-Host {
  param([string[]]$RelaunchArgs, [string]$WorkDir)
  throw 'This terminal has no owned restart supervisor. Close only this OpenCode terminal, then launch with: bun run runtime:start --no-deploy --cwd <project-path>. Existing processes were not stopped.'
}

try {
  if ($PrepareOnly -and ($Update -or $Status)) { throw "-PrepareOnly cannot update or control a running host" }
  if ($Status) {
    $path = Get-Opencode2
    $version = Assert-V2 $path
    Write-Host "runtime: $version"
    & $path service status
    exit $LASTEXITCODE
  }

  # Restart is selection-only. Publishing a reviewed generation is a separate operation.
  $NoDeploy = $true
  $workDir = (Get-Location).Path
  $relaunchArgs = Get-RelaunchArgs

  if ($DryRun) {
    $fresh = @{ newer = $false; reason = "-NoDeploy" }
    $plan = [ordered]@{
      wouldDeploy  = [bool]$fresh.newer
      reason       = [string]$fresh.reason
      relaunchArgs = @($relaunchArgs)
      workdir      = $workDir
      active       = (Get-ActiveGeneration)
    }
    Write-Host ($plan | ConvertTo-Json -Compress)
    exit 0
  }

  if ($Update) {
    Start-Sleep -Seconds 1
    if (Get-Process -Name opencode2 -ErrorAction SilentlyContinue) { throw 'Close the OpenCode processes you own before updating the host. No processes were stopped.' }
    Install-Latest
    $path = Get-Opencode2
    $version = Assert-V2 $path
    Write-Host "updated runtime: $version"
    Write-RestartLog "relaunching after update args='$($relaunchArgs -join ' ')' workdir='$workDir'"
    Start-Process -FilePath $path -ArgumentList $relaunchArgs -WorkingDirectory $workDir
    exit 0
  }

  Write-Host "Using selected release; source deployment is separate."

  if ($PrepareOnly) {
    $activation = Get-Content -LiteralPath (Join-Path $ConfigRoot "plugin-activation.json") -Raw | ConvertFrom-Json
    if ($activation.evidence.ok -ne $true) { throw "active generation has no successful runtime validation" }
    Write-Host (@{ generation = $activation.activeGeneration; sourceCommit = $activation.evidence.sourceCommit; configRoot = $ConfigRoot; relaunchArgs = @($relaunchArgs) } | ConvertTo-Json -Compress)
    exit 0
  }

  Restart-Host -RelaunchArgs $relaunchArgs -WorkDir $workDir
  Write-RestartLog "restart ok"
} catch {
  Write-RestartLog "FAIL: $($_.Exception.Message)"
  Write-Host "FAIL: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
