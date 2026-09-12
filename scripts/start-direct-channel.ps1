# OpenCode owns the console directly. Node finishes before the native host starts.
# -Try <ref> prepares or reuses a candidate for that ref and launches it without activating
# anything, so looking at a change costs one preparation and never the acceptance gate.
param([Parameter(Position=0,Mandatory=$true)][ValidateSet('dev','stable')][string]$Channel,
      [string]$Try,
      [Parameter(ValueFromRemainingArguments=$true)][string[]]$HostArguments)
$ErrorActionPreference='Stop'
if($Try){
 if($Channel -ne 'dev'){throw 'Trying a ref prepares a dev candidate; name the dev channel'}
 $planFile=Join-Path ([System.IO.Path]::GetTempPath()) ("opencode-try-$PID.json")
 $tryArgs=@($Try,'--plan',$planFile)
 $rest=@()
 for($i=0;$i -lt $HostArguments.Count;$i++){
  if($HostArguments[$i] -eq '--fresh'){$tryArgs+='--fresh'}
  elseif($HostArguments[$i] -eq '--model'){$i++;if($i -ge $HostArguments.Count){throw '--model needs an exact route'};$tryArgs+=@('--model',$HostArguments[$i])}
  else{$rest+=$HostArguments[$i]}
 }
 $HostArguments=$rest
 & node (Join-Path $PSScriptRoot 'try-ref.mjs') @tryArgs
 if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
 $tried=Get-Content -Raw $planFile | ConvertFrom-Json
 Remove-Item $planFile -ErrorAction SilentlyContinue
 $env:OPENCODE_DEV_CANDIDATE=$tried.candidate
}
$planText=& node (Join-Path $PSScriptRoot 'prepare-direct-channel.mjs') $Channel --owner-pid $PID
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
$plan=$planText | ConvertFrom-Json
# Say which code is about to run. A candidate is never the activated channel, and the difference
# has to be readable at a glance or the wrong one gets trusted.
$b=$plan.banner
$rule='-'*72
if($b.candidate){
 Write-Host $rule -ForegroundColor Yellow
 Write-Host ' OpenCode2 CANDIDATE - not the activated channel, nothing was activated' -ForegroundColor Yellow
 Write-Host ("   ref       {0}{1}" -f $b.ref,$(if($b.resolvedRef -and $b.resolvedRef -ne $b.ref){"  (resolved $($b.resolvedRef))"}else{''}))
 Write-Host ("   commit    {0}  {1}" -f $b.commit.Substring(0,8),$b.subject)
 Write-Host ("   model     {0}" -f $b.model)
 Write-Host ("   release   {0}" -f $b.candidate)
 if($b.activatedCommit){Write-Host ("   activated dev is still {0} - ocd runs that" -f $b.activatedCommit.Substring(0,8)) -ForegroundColor DarkGray}
 Write-Host $rule -ForegroundColor Yellow
}else{
 Write-Host ("OpenCode2 {0} channel (activated)  commit {1}{2}" -f $Channel,$plan.sourceCommit.Substring(0,8),$(if($b.model){"  model $($b.model)"}else{''})) -ForegroundColor DarkGray
}
$saved=@{}
try {
 foreach($property in $plan.env.PSObject.Properties){
  $saved[$property.Name]=[Environment]::GetEnvironmentVariable($property.Name,'Process')
  [Environment]::SetEnvironmentVariable($property.Name,$property.Value,'Process')
 }
 $nativeArgs=@('--standalone')
 if($plan.giverSessionID -and $HostArguments -notcontains '--session' -and $HostArguments -notcontains '-s'){$nativeArgs+=@('--session',$plan.giverSessionID)}
 for($i=0;$i -lt $HostArguments.Count;$i++){
  if($HostArguments[$i] -eq '--cwd'){$i++;if($i -ge $HostArguments.Count){throw '--cwd needs a directory'}; $nativeArgs+=$HostArguments[$i]}
  else{$nativeArgs+=$HostArguments[$i]}
 }
 & $plan.host.executable @nativeArgs
 $hostExit=$LASTEXITCODE
} finally {
 if($plan.releaseLease){ & node $plan.retirementScript release $plan.releaseLease | Out-Null }
 foreach($name in $saved.Keys){[Environment]::SetEnvironmentVariable($name,$saved[$name],'Process')}
}
exit $hostExit
