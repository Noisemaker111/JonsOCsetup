# The one OpenCode launcher. Node finishes selecting configuration before the native host starts,
# so OpenCode owns the console directly.
#
#   oc                     open OpenCode on the latest merged agents code
#   oc <branch>            on that branch's code instead
#   oc --gated             on the release that passed the acceptance gate
#   oc --default gated     make that the default for plain `oc`; --default branch puts it back
#   oc --stable            the stable channel
#   oc --here              launch in the current directory instead of the maintained source
#   oc <branch> --fresh    rebuild the candidate rather than reusing one
#   oc --model <route>     pin the model a candidate runs on
#
# Plain `oc` runs the branch, not the gated release, because the gate is a promotion check and was
# never meant to be the delivery path: about half of its runs fail, so a merged fix could be absent
# from the command Jon types with nothing saying so. The gated release is still one flag away.
#
# Everything else is passed to the host. Arguments are parsed here rather than bound as PowerShell
# parameters so that the POSIX spellings Jon actually types (--stable, --here) work from a .cmd
# wrapper, which -Stable would not.
param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Arguments)
$ErrorActionPreference='Stop'

$defaultDirectory=Join-Path $env:USERPROFILE 'Projects\JonsOCsetup'
$rule='-'*72
$source=join-path $PSScriptRoot 'oc-source.mjs'
$channel='dev'; $ref=$null; $defaulted=$false; $here=$false; $fresh=$false; $model=$null; $want=$null; $setDefault=$null; $hostArgs=@()
for($i=0;$i -lt $Arguments.Count;$i++){
 $a=$Arguments[$i]
 switch -Regex ($a) {
  '^--?stable$'  {$channel='stable';break}
  '^--?dev$'     {$channel='dev';break}
  '^--?gated$'   {$want='gated';break}
  '^--?branch$'  {$want='branch';break}
  '^--?here$'    {$here=$true;break}
  '^--?fresh$'   {$fresh=$true;break}
  '^--?model$'   {$i++;if($i -ge $Arguments.Count){throw 'Name the model route: oc <branch> --model <exact-route>'};$model=$Arguments[$i];break}
  '^--?default$' {$i++;if($i -ge $Arguments.Count){throw 'Choose what plain oc opens: oc --default branch|gated'};$setDefault=$Arguments[$i];break}
  '^--?cwd$'     {$i++;if($i -ge $Arguments.Count){throw '--cwd needs a directory'};$hostArgs+=@('--cwd',$Arguments[$i]);break}
  '^-'           {$hostArgs+=$a;break}
  default        {if($null -eq $ref){$ref=$a}else{$hostArgs+=$a};break}
 }
}
# Flipping the default is a setting, not a launch.
if($setDefault){& node $source set $setDefault; exit $LASTEXITCODE}
if($ref -and $channel -eq 'stable'){throw 'A branch is prepared as a dev candidate; drop --stable'}
if(($fresh -or $model) -and -not $ref){throw 'Name the branch those apply to: oc <branch> [--fresh] [--model <exact-route>]'}
if($ref -and $want){throw "You named both a branch and --$want; pick one"}

# No branch and no flag means the stored default decides, and it is the branch unless flipped.
if($channel -eq 'dev' -and -not $ref){
 if(-not $want){$want=(& node $source).Trim();if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}}
 if($want -ne 'gated'){$ref='agents';$defaulted=$true}
}

# A branch is prepared or reused as an explicit candidate. Nothing about the activated channel moves.
#
# Preparation is not free of the outside world: it restores the lockfile and sends one real prompt to
# the configured model, and it fails if that model refuses. That is fine for a branch someone asked
# for by name -- say so and stop. It is not fine for plain `oc`, which is now the branch by default:
# a rate-limited provider would leave Jon with no OpenCode at all. So a defaulted launch falls back
# to the gated release and says loudly what it could not do, because a working editor on older code
# beats an error message.
if($ref){
 $planFile=Join-Path ([System.IO.Path]::GetTempPath()) ("opencode-try-$PID.json")
 $tryArgs=@($ref,'--plan',$planFile)
 if($fresh){$tryArgs+='--fresh'}
 if($model){$tryArgs+=@('--model',$model)}
 & node (Join-Path $PSScriptRoot 'try-ref.mjs') @tryArgs
 if($LASTEXITCODE -ne 0){
  if(-not $defaulted){exit $LASTEXITCODE}
  Write-Host ''
  Write-Host $rule -ForegroundColor Red
  Write-Host (" Could not prepare the latest merged {0}, so this is the gated release instead." -f $ref) -ForegroundColor Red
  Write-Host ' The reason is above. `oc --branch` retries; `oc <branch> --fresh` rebuilds.' -ForegroundColor Red
  Write-Host $rule -ForegroundColor Red
  Write-Host ''
  $ref=$null;$defaulted=$false
 }else{
  $tried=Get-Content -Raw $planFile | ConvertFrom-Json
  Remove-Item $planFile -ErrorAction SilentlyContinue
  $env:OPENCODE_DEV_CANDIDATE=$tried.candidate
  # The generation loaded at this commit; only the provider could not be asked to confirm it. That is
  # worth saying out loud, because the alternative used to be running older code without being told.
  if($tried.probe -eq 'provider-unavailable'){
   Write-Host $rule -ForegroundColor Yellow
   Write-Host ' This code loaded and is what you are running. No provider answered the check.' -ForegroundColor Yellow
   Write-Host ("   route     {0} refused the preparation prompt" -f $tried.model) -ForegroundColor Yellow
   Write-Host '   `oc --model <exact-route>` prepares on a route that still has room.' -ForegroundColor Yellow
   Write-Host $rule -ForegroundColor Yellow
  }
 }
}
$planText=& node (Join-Path $PSScriptRoot 'prepare-direct-channel.mjs') $channel --owner-pid $PID
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
$plan=$planText | ConvertFrom-Json

# Say which code is about to run. A candidate is never the release that passed the gate, and the
# difference has to be readable at a glance or the wrong one gets trusted.
# New launches start in the maintained source. Existing sessions retain their saved identity.
# --here and explicit --cwd continue to select the caller's directory.
$explicitCwd=$hostArgs -contains '--cwd'
# Opening the registered giver means opening it where it lives. Only the giver's own location runs
# the board polls, and there is one host at the directory opened here, so launching anywhere else
# leaves the board with no coordinator: nothing reconciles a finished run, no saved start request is
# consumed, and no continuation advances. --here and an explicit --cwd still win, and a launch with
# no registered giver still opens the maintained source.
$launchAt=if($here -or $explicitCwd){(Get-Location).Path}elseif($plan.giverDirectory -and (Test-Path -LiteralPath $plan.giverDirectory)){$plan.giverDirectory}else{$defaultDirectory}
$b=$plan.banner
if($b.candidate -and $defaulted){
 # The ordinary case now: plain `oc` on the latest merged code. Say what it is, quietly.
 Write-Host ("OpenCode {0} - commit {1}  {2}" -f $b.ref,$b.commit.Substring(0,8),$b.subject) -ForegroundColor DarkGray
}elseif($b.candidate){
 # A branch that is not the default is worth being loud about: it is code nobody else is running.
 Write-Host $rule -ForegroundColor Yellow
 Write-Host ' OpenCode on a BRANCH - not the default, and nothing was activated' -ForegroundColor Yellow
 Write-Host ("   branch    {0}{1}" -f $b.ref,$(if($b.resolvedRef -and $b.resolvedRef -ne $b.ref){"  (resolved $($b.resolvedRef))"}else{''}))
 Write-Host ("   commit    {0}  {1}" -f $b.commit.Substring(0,8),$b.subject)
 Write-Host ("   model     {0}" -f $b.model)
 Write-Host $rule -ForegroundColor Yellow
}else{
 Write-Host ("OpenCode {0} - commit {1}{2}" -f $(if($channel -eq 'dev'){'gated release'}else{$channel}),$plan.sourceCommit.Substring(0,8),$(if($b.model){"  model $($b.model)"}else{''})) -ForegroundColor DarkGray
 # A gated release goes out of date silently. Nothing used to say how far, and Jon typed /new at a
 # release that predated the fix for it.
 if($channel -eq 'dev' -and $b.behind -gt 0){
  Write-Host ("   {0} commit{1} behind agents - `oc --branch` runs the latest merged code" -f $b.behind,$(if($b.behind -eq 1){''}else{'s'})) -ForegroundColor Yellow
 }
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
 # The native session keeps its saved model unless this launch explicitly chose one.
 # Record the actual session argument, including a caller override of the registered giver.
 $selectionName='OPENCODE_LAUNCH_SELECTION'
 $saved[$selectionName]=[Environment]::GetEnvironmentVariable($selectionName,'Process')
 $selection=@{explicitModel=[bool]($model -or $hostArgs -contains '--model' -or $hostArgs -contains '-m')}
 $sessionAt=[Array]::IndexOf($nativeArgs,'--session')
 if($sessionAt -lt 0){$sessionAt=[Array]::IndexOf($nativeArgs,'-s')}
 if($sessionAt -ge 0 -and $sessionAt+1 -lt $nativeArgs.Count){$selection.sessionID=$nativeArgs[$sessionAt+1]}
 [Environment]::SetEnvironmentVariable($selectionName,($selection | ConvertTo-Json -Compress),'Process')
 if($plan.hostOwnershipScript){ & node $plan.hostOwnershipScript -- $plan.host.executable @nativeArgs }
 else { & $plan.host.executable @nativeArgs }
 $hostExit=$LASTEXITCODE
} finally {
 Pop-Location
 if($plan.releaseLease){ & node $plan.retirementScript release $plan.releaseLease | Out-Null }
 foreach($name in $saved.Keys){[Environment]::SetEnvironmentVariable($name,$saved[$name],'Process')}
}
exit $hostExit
