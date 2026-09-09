[CmdletBinding()]
param([string]$RepoRoot = (Get-Location).Path, [string]$Stage = (Join-Path $env:TEMP "t3code-canvas-stage"))
$ErrorActionPreference = "Stop"
$RepoRoot = [IO.Path]::GetFullPath($RepoRoot)
$Stage = [IO.Path]::GetFullPath($Stage)
if (-not (Test-Path (Join-Path $RepoRoot ".git"))) { throw "Not a Git worktree: $RepoRoot" }
if (-not (Test-Path (Join-Path $RepoRoot "vendor/t3code"))) { throw "Missing vendor/t3code in $RepoRoot" }
if (Test-Path $Stage) { Remove-Item -LiteralPath $Stage -Recurse -Force }
New-Item -ItemType Directory -Path $Stage -Force | Out-Null
$archive = Join-Path $Stage "vendor.tar"
# Write the archive directly; piping bytes through Set-Content is unsafe.
& git -C $RepoRoot archive --format=tar -o $archive HEAD -- vendor/t3code
if ($LASTEXITCODE -ne 0) { throw "git archive failed with exit code $LASTEXITCODE" }
& tar -xf $archive -C $Stage
if ($LASTEXITCODE -ne 0) { throw "tar extraction failed with exit code $LASTEXITCODE" }
Write-Host "Canvas stage synchronized: $Stage"
