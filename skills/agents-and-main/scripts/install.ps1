param([string]$Destination = "$env:USERPROFILE/.local/bin")
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'sb.ps1') -Destination (Join-Path $Destination 'sb.ps1')
Write-Output "Installed sb in $Destination. Add this directory to PATH if needed."
