# OpenCode owns the console directly. Node finishes before the native host starts.
param([Parameter(Position=0,Mandatory=$true)][ValidateSet('dev','stable')][string]$Channel,
      [Parameter(ValueFromRemainingArguments=$true)][string[]]$HostArguments)
$ErrorActionPreference='Stop'
$planText=& node (Join-Path $PSScriptRoot 'prepare-direct-channel.mjs') $Channel --owner-pid $PID
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
$plan=$planText | ConvertFrom-Json
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
