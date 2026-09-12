# The one OpenCode launcher. Node finishes selecting configuration before the native host starts,
# so OpenCode owns the console directly.
#
#   oc                  open OpenCode on the release that passed the gate
#   oc <branch>         open it running that branch's code instead, preparing or reusing a
#                       candidate -- no gate and nothing activated
#   oc --stable         the stable channel
#   oc --here           launch in the current directory instead of the hub
#   oc <branch> --fresh rebuild the candidate rather than reusing one
#   oc --model <route>  pin the model a candidate runs on
#
# Everything else is passed to the host. Arguments are parsed here rather than bound as PowerShell
# parameters so that the POSIX spellings Jon actually types (--stable, --here) work from a .cmd
# wrapper, which -Stable would not.
param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Arguments)
$ErrorActionPreference='Stop'

$hub=Join-Path $env:USERPROFILE 'Projects\opencode-hub'
$channel='dev'; $ref=$null; $here=$false; $fresh=$false; $model=$null; $hostArgs=@()
for($i=0;$i -lt $Arguments.Count;$i++){
 $a=$Arguments[$i]
 switch -Regex ($a) {
  '^--?stable$' {$channel='stable'}
  '^--?dev$'    {$channel='dev'}
  '^--?here$'   {$here=$true}
  '^--?fresh$'  {$fresh=$true}
  '^--?model$'  {$i++;if($i -ge $Arguments.Count){throw 'Name the model route: oc <branch> --model <exact-route>'};$model=$Arguments[$i]}
  '^-'          {$hostArgs+=$a}
  default       {if($null -eq $ref){$ref=$a}else{$hostArgs+=$a}}
 }
}
if($ref -and $channel -eq 'stable'){throw 'A branch is prepared as a dev candidate; drop --stable'}
if(($fresh -or $model) -and -not $ref){throw 'Name the branch those apply to: oc <branch> [--fresh] [--model <exact-route>]'}

# A branch is prepared or reused as an explicit candidate. Nothing about the activated channel moves.
if($ref){
 $planFile=Join-Path ([System.IO.Path]::GetTempPath()) ("opencode-try-$PID.json")
 $tryArgs=@($ref,'--plan',$planFile)
 if($fresh){$tryArgs+='--fresh'}
 if($model){$tryArgs+=@('--model',$model)}
 & node (Join-Path $PSScriptRoot 'try-ref.mjs') @tryArgs
 if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
 $tried=Get-Content -Raw $planFile | ConvertFrom-Json
 Remove-Item $planFile -ErrorAction SilentlyContinue
 $env:OPENCODE_DEV_CANDIDATE=$tried.candidate
}
$planText=& node (Join-Path $PSScriptRoot 'prepare-direct-channel.mjs') $channel --owner-pid $PID
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
$plan=$planText | ConvertFrom-Json

# Say which code is about to run. A candidate is never the release that passed the gate, and the
# difference has to be readable at a glance or the wrong one gets trusted.
# The host walks up from the launch directory for instructions, so a session started anywhere else
# never loads the hub AGENTS.md. Launch at the hub unless --here or an explicit --cwd says otherwise.
$explicitCwd=$hostArgs -contains '--cwd'
$launchAt=if($here -or $explicitCwd){(Get-Location).Path}else{$hub}
$b=$plan.banner
$rule='-'*72
if($b.candidate){
 Write-Host $rule -ForegroundColor Yellow
 Write-Host ' OpenCode on a BRANCH - nothing was activated, `oc` alone still runs the real one' -ForegroundColor Yellow
 Write-Host ("   branch    {0}{1}" -f $b.ref,$(if($b.resolvedRef -and $b.resolvedRef -ne $b.ref){"  (resolved $($b.resolvedRef))"}else{''}))
 Write-Host ("   commit    {0}  {1}" -f $b.commit.Substring(0,8),$b.subject)
 Write-Host ("   model     {0}" -f $b.model)
 if($b.activatedCommit){Write-Host ("   the gated release is still {0}" -f $b.activatedCommit.Substring(0,8)) -ForegroundColor DarkGray}
 Write-Host $rule -ForegroundColor Yellow
}else{
 Write-Host ("OpenCode {0} - commit {1}{2}" -f $channel,$plan.sourceCommit.Substring(0,8),$(if($b.model){"  model $($b.model)"}else{''})) -ForegroundColor DarkGray
}
Write-Host ("   in        {0}" -f $launchAt) -ForegroundColor DarkGray

$saved=@{}
Push-Location $launchAt
try {
 foreach($property in $plan.env.PSObject.Properties){
  $saved[$property.Name]=[Environment]::GetEnvironmentVariable($property.Name,'Process')
  [Environment]::SetEnvironmentVariable($property.Name,$property.Value,'Process')
 }
 $nativeArgs=@('--standalone')
 if($plan.giverSessionID -and $hostArgs -notcontains '--session' -and $hostArgs -notcontains '-s'){$nativeArgs+=@('--session',$plan.giverSessionID)}
 for($i=0;$i -lt $hostArgs.Count;$i++){
  if($hostArgs[$i] -eq '--cwd'){$i++;if($i -ge $hostArgs.Count){throw '--cwd needs a directory'}; $nativeArgs+=$hostArgs[$i]}
  else{$nativeArgs+=$hostArgs[$i]}
 }
 & $plan.host.executable @nativeArgs
 $hostExit=$LASTEXITCODE
} finally {
 Pop-Location
 if($plan.releaseLease){ & node $plan.retirementScript release $plan.releaseLease | Out-Null }
 foreach($name in $saved.Keys){[Environment]::SetEnvironmentVariable($name,$saved[$name],'Process')}
}
exit $hostExit
