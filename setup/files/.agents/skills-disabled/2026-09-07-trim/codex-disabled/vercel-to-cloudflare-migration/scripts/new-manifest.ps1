param(
  [Parameter(Mandatory = $true)]
  [string[]]$Domains,
  [Parameter(Mandatory = $true)]
  [string]$Output,
  [string]$Name = 'vercel-to-cloudflare-migration'
)

$manifest = [ordered]@{
  migration = [ordered]@{
    name = $Name
    created = (Get-Date).ToUniversalTime().ToString('o')
    vercelTeam = $null
    cloudflareAccount = $null
    assignedNameservers = @()
    status = 'inventory'
  }
  domains = @($Domains | Sort-Object -Unique | ForEach-Object {
    [ordered]@{
      domain = $_
      registrar = [ordered]@{ provider = $null; managedAccess = $false; oldNameservers = @() }
      classification = $null
      source = [ordered]@{ vercelProject = $null; behavior = $null }
      target = [ordered]@{ serviceType = $null; name = $null; routes = @() }
      dns = [ordered]@{ zoneStatus = $null; parity = $null; mailParity = $null; dnssec = $null }
      approval = $null
      cutover = $null
      verification = @()
      rollback = [ordered]@{ oldNameservers = @(); fallbackOriginRetained = $true }
      blockers = @()
    }
  })
}

$manifest | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $Output -Encoding utf8
Write-Output $Output
