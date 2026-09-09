param(
  [Parameter(Mandatory = $true)]
  [string]$Manifest,
  [string]$Output
)

$ErrorActionPreference = 'Stop'
$data = Get-Content -LiteralPath $Manifest -Raw | ConvertFrom-Json
$rows = foreach ($entry in $data.domains) {
  $domain = [string]$entry.domain
  foreach ($type in @('NS', 'A', 'AAAA', 'MX', 'TXT', 'CAA')) {
    try {
      $answers = Resolve-DnsName -Name $domain -Type $type -ErrorAction Stop
      foreach ($answer in $answers) {
        $parts = @($answer.NameHost, $answer.IPAddress, $answer.NameExchange, $answer.Strings, $answer.CanonicalName) |
          Where-Object { $null -ne $_ -and "$_" -ne '' }
        [pscustomobject]@{
          Domain = $domain
          Type = $type
          Name = $answer.Name
          Value = $parts -join ' '
          Priority = $answer.Preference
          TTL = $answer.TTL
          Error = $null
        }
      }
    } catch {
      [pscustomobject]@{
        Domain = $domain
        Type = $type
        Name = $null
        Value = $null
        Priority = $null
        TTL = $null
        Error = $_.Exception.Message
      }
    }
  }
}

if ($Output) {
  $rows | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $Output -Encoding utf8
} else {
  $rows | Format-Table -AutoSize
}
