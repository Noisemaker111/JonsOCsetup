[CmdletBinding()]
param(
  [string]$RepoUrl = "https://github.com/Noisemaker111/t3code-canvas.git",
  [string]$RepoRoot,
  [string]$ArtifactUrl,
  [string]$ArtifactPath,
  [string]$PackageUrl,
  [string]$ArtifactCommit,
  [string]$VpsRepoRoot,
  [string]$ExpectedVpsCommit,
  [string]$PublishStatusFile,
  [ValidateSet("succeeded", "credentials-limitation")][string]$PublishStatus
)

$ErrorActionPreference = "Stop"
$checks = [ordered]@{ source = $false; artifact = $false; publish = $false; vps = $true }
$failures = [System.Collections.Generic.List[string]]::new()

function Pass([string]$Name, [string]$Detail) {
  Write-Host "ARTIFACT-GATE PASS ${Name}: $Detail"
}
function Fail([string]$Name, [string]$Detail) {
  $script:failures.Add("${Name}: $Detail")
  Write-Host "ARTIFACT-GATE BLOCK ${Name}: $Detail"
}

function Test-DistributableArtifact([string]$Path) {
  $name = [IO.Path]::GetFileName($Path).ToLowerInvariant()
  if ($name -match '\.(zip|tar|tar\.gz|tgz|dmg|appimage|exe|msi|deb|rpm|pkg)$') { return $true }
  return $name -match '\.mjs$' -and $Path -match '[\\/](dist|build|release)[\\/]'
}

function Test-DistributableUrl([string]$Url) {
  try { return Test-DistributableArtifact ([Uri]$Url).AbsolutePath }
  catch { return $false }
}

# A source check must count actual tracked files, not merely a repository HEAD.
$files = @()
if ($RepoRoot) {
  if (-not (Test-Path (Join-Path $RepoRoot ".git"))) { Fail "source" "RepoRoot is not a git worktree" }
  else {
    $files = @(& git -C $RepoRoot ls-tree -r --name-only HEAD 2>$null)
    if ($LASTEXITCODE -ne 0) { Fail "source" "git ls-tree failed" }
  }
} else {
  $head = (& git ls-remote $RepoUrl HEAD 2>$null)
  if ($LASTEXITCODE -ne 0 -or -not $head) { Fail "source" "git ls-remote did not return HEAD" }
  $api = $RepoUrl -replace "\.git$", "" -replace "^https://github\.com/", "https://api.github.com/repos/"
  try {
    $tree = Invoke-RestMethod -Uri "$api/git/trees/HEAD?recursive=1" -Headers @{ "User-Agent" = "opencode-artifact-gate" }
    $files = @($tree.tree | Where-Object { $_.type -eq "blob" } | ForEach-Object path)
  } catch { Fail "source" "GitHub tree API unavailable: $($_.Exception.Message)" }
}
if ($files.Count -gt 0) {
  $sourceFiles = @($files | Where-Object {
    $_ -notmatch "(^|/)(README|LICENSE|COPYING)(\.|$)" -and
    $_ -notmatch "(^|/)\.gitignore$" -and
    $_ -match "\.(ts|tsx|js|jsx|json|css|html|vue|svelte|rs|py|cs|go)$"
  })
  if ($sourceFiles.Count -gt 0) {
    $checks.source = $true
    Pass "source" "$($sourceFiles.Count) source files at published HEAD"
  } else { Fail "source" "published tree contains no source files beyond README/metadata" }
}

# A local built file or a remotely downloadable package/release is required.
if ($ArtifactPath) {
  if (-not (Test-Path $ArtifactPath -PathType Leaf)) { Fail "artifact" "local artifact is missing: $ArtifactPath" }
  elseif (-not (Test-DistributableArtifact $ArtifactPath)) { Fail "artifact" "not a distributable artifact: $ArtifactPath" }
  else {
    $item = Get-Item $ArtifactPath
    if ($item.Length -le 0) { Fail "artifact" "distributable artifact is empty: $ArtifactPath" }
    else {
      $hash = (Get-FileHash $ArtifactPath -Algorithm SHA256).Hash
      $checks.artifact = $true; Pass "artifact" "$($item.Name) type=$([IO.Path]::GetExtension($item.Name)) size=$($item.Length) sha256=$hash path=$($item.FullName)"
    }
  }
} elseif ($ArtifactUrl) {
  if (-not (Test-DistributableUrl $ArtifactUrl)) { Fail "artifact" "URL does not name a distributable artifact: $ArtifactUrl" }
  else { try {
    $response = Invoke-WebRequest -Uri $ArtifactUrl -Method Head -Headers @{ "User-Agent" = "opencode-artifact-gate" }
    if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) {
      $checks.artifact = $true; Pass "artifact" "downloadable ($($response.StatusCode)): $ArtifactUrl"
    } else { Fail "artifact" "download returned HTTP $($response.StatusCode)" }
  } catch { Fail "artifact" "artifact is not downloadable: $($_.Exception.Message)" } }
} elseif ($PackageUrl) {
  if (-not (Test-DistributableUrl $PackageUrl)) { Fail "artifact" "package URL does not name a distributable artifact: $PackageUrl" }
  else { try {
    $response = Invoke-WebRequest -Uri $PackageUrl -Method Head -Headers @{ "User-Agent" = "opencode-artifact-gate" }
    if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) {
      $checks.artifact = $true; Pass "artifact" "downloadable package ($($response.StatusCode)): $PackageUrl"
    } else { Fail "artifact" "package download returned HTTP $($response.StatusCode)" }
  } catch { Fail "artifact" "package is not downloadable: $($_.Exception.Message)" } }
} elseif ($RepoRoot) {
  Fail "artifact" "no distributable artifact supplied; manifests, source, and lockfiles are not artifacts"
} else { Fail "artifact" "no artifact URL, package URL, or local artifact supplied" }

if ($ArtifactCommit -and $RepoRoot) {
  $actualCommit = (& git -C $RepoRoot rev-parse HEAD 2>$null).Trim()
  if ($actualCommit -ne $ArtifactCommit) { Fail "artifact" "artifact commit mismatch: expected $ArtifactCommit, found $actualCommit" }
  else { Pass "artifact-commit" "artifact validated from HEAD $actualCommit" }
}

if (-not $PublishStatus -and $PublishStatusFile -and (Test-Path $PublishStatusFile)) {
  $PublishStatus = (Get-Content $PublishStatusFile -Raw).Trim()
}
if ($PublishStatus -eq "succeeded") {
  $checks.publish = $true; Pass "publish" "publish step reported succeeded"
} elseif ($PublishStatus -eq "credentials-limitation") {
  $checks.publish = $true; Pass "publish" "credentials limitation explicitly recorded (not treated as success)"
} else { Fail "publish" "publish result is unproven; record succeeded or credentials-limitation" }

if ($ExpectedVpsCommit -or $VpsRepoRoot) {
  $checks.vps = $false
  if (-not $VpsRepoRoot -or -not $ExpectedVpsCommit) {
    Fail "vps" "both VpsRepoRoot and ExpectedVpsCommit are required"
  } elseif (-not (Test-Path (Join-Path $VpsRepoRoot ".git"))) {
    Fail "vps" "vps-code worktree is missing"
  } else {
    $actualVps = (& git -C $VpsRepoRoot rev-parse HEAD 2>$null).Trim()
    if ($LASTEXITCODE -eq 0 -and $actualVps -eq $ExpectedVpsCommit) {
      $checks.vps = $true; Pass "vps" "vps-code points to tested commit $actualVps"
    } else { Fail "vps" "expected $ExpectedVpsCommit, found $actualVps" }
  }
}

if ($failures.Count) {
  Write-Host "ARTIFACT-GATE BLOCK: $($failures -join '; ')"
  exit 1
}
Write-Host "ARTIFACT-GATE CLEAN: source, artifact, publish, and vps gates verified"
exit 0
