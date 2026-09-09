/** Bounded read-only candidate review. No model/session launch or candidate edits.
 * All hook state, Git changes and junctions belong to the private fixture. */
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,symlinkSync,rmdirSync,realpathSync} from 'node:fs'
import {resolve,join,dirname} from 'node:path'
import {pathToFileURL} from 'node:url'
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'

const source=resolve(process.argv[2]??'../../../.worktrees/quest-ownership-recovery')
const root=mkdtempSync(join(process.env.LOCALAPPDATA??'C:/Users/Jk101/AppData/Local','Temp','opencode','codex-guard-review-'))
process.env.OPENCODE_QUEST_ROOT=root
process.env.OPENCODE_QUEST_SETTINGS=join(root,'settings.json')
writeFileSync(process.env.OPENCODE_QUEST_SETTINGS,JSON.stringify({version:1,workspaceMode:'worktree',revision:0}))
const load=(path:string)=>import(pathToFileURL(join(source,path)).href)
const {QuestStore}=await load('quest/store.ts'),{coordination}=await load('quest/coordination.ts')
const {codexHook}=await load('quest/codex/runtime.ts'),{recoverWorkspace,checkoutAliases}=await load('quest/codex/recovery-workspace.ts')
const git=(cwd:string,...args:string[])=>{
 const p=spawnSync('git',['-C',cwd,...args],{encoding:'utf8',windowsHide:true,timeout:20000})
 if(p.status!==0)throw Error(p.stderr||String(p.error));return p.stdout.trim()
}
const head=git(source,'rev-parse','HEAD')
if(head!=='6836c98775b1e38b2ea700f67113d4e4853f62ca')throw Error('Review requires the exact committed candidate')
if(git(source,'status','--porcelain'))throw Error('Candidate is dirty; review stopped')
const repo=join(root,'repo');mkdirSync(repo);git(repo,'init')
writeFileSync(join(repo,'owner.txt'),'committed');git(repo,'add','owner.txt');git(repo,'commit','-m','private guard review fixture')
writeFileSync(join(repo,'owner.txt'),'staged owner work');git(repo,'add','owner.txt');writeFileSync(join(repo,'owner.txt'),'dirty owner work')
const store=new QuestStore(root),owner={directory:repo,sessionID:'original-owner',host:'opencode'}
coordination(store,owner)({action:'join',title:'Original owner',scopes:['.']})
const ownerRecord=()=>coordination(store,owner)({action:'status'}).participants.find((p:any)=>p.sessionID==='original-owner')
const before=JSON.stringify(ownerRecord())
const hook=(session:string,id:string,tool:string,input:any,extra:any={})=>codexHook({session_id:session,cwd:repo,hook_event_name:'PreToolUse',tool_name:tool,tool_input:input,tool_use_id:id,...extra},store)

// A normal first patch is safe. Replace only our empty destination directory
// with a fixture junction before the same pending operation is replayed.
const binding=recoverWorkspace(store,repo,'patch-review',{aliases:{}})
const slot=join(binding.directory,'slot');mkdirSync(slot)
const patch={command:'*** Begin Patch\n*** Add File: slot/probe.txt\n+fixture\n*** End Patch'}
const first=hook('patch-review','same-patch','apply_patch',patch)
rmdirSync(slot);symlinkSync(repo,slot,process.platform==='win32'?'junction':'dir')
const replay=hook('patch-review','same-patch','apply_patch',patch)
const target=/\*\*\* Add File: (.+)/.exec(replay.hookSpecificOutput?.updatedInput?.command??'')?.[1]
let freshRejected=false
try{hook('patch-review','fresh-patch','apply_patch',patch)}catch(error){freshRejected=String(error).includes('resolves outside')}

const shell={command:'Write-Output private-review-only'}
const shellFirst=hook('shell-review','same-shell','Bash',shell)
const shellReplay=hook('shell-review','same-shell','Bash',shell)
const persistent=hook('shell-review','persistent','mcp__node_repl__js',{code:'0'})
const plan=hook('plan-review','plan-shell','Bash',shell,{permission_mode:'plan'})
const report={
 candidate:head,fixture:root,remoteModelCalls:0,modelSessionsCreated:0,
 files:['quest/codex/runtime.ts','quest/codex/recovery-workspace.ts','quest/codex/recovery-command.ts'].map(path=>({path,sha256:createHash('sha256').update(readFileSync(join(source,path))).digest('hex')})),
 patchReplay:{firstDecision:first.hookSpecificOutput?.permissionDecision,replayDecision:replay.hookSpecificOutput?.permissionDecision,identicalRewrite:JSON.stringify(first)===JSON.stringify(replay),targetParentResolvesToOriginalOwner:!!target&&realpathSync(dirname(target))===realpathSync(repo),freshCallRejectsSameJunction:freshRejected,patchExecuted:false},
 shellReplay:{sameTicket:JSON.stringify(shellFirst)===JSON.stringify(shellReplay),runnerExecuted:false},
 persistentDecision:persistent.hookSpecificOutput?.permissionDecision,
 planMode:{decision:plan.hookSpecificOutput?.permissionDecision,createsReplacementCommand:!!plan.hookSpecificOutput?.updatedInput?.command,runnerExecuted:false,permissionInheritanceVerified:false},
 defaultAliases:checkoutAliases(),
 owner:{recordUnchanged:before===JSON.stringify(ownerRecord()),dirtyPreserved:readFileSync(join(repo,'owner.txt'),'utf8')==='dirty owner work',stagedPreserved:git(repo,'show',':owner.txt')==='staged owner work'},
 logicalSessionCwd:repo,
 limitations:'Hook-level review only. Reuses prior real-host receipts; no model-facing acceptance or automatic retry executed.'
}
const output=resolve(process.argv[3]??join(root,'report.json'))
writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2))
if(!report.patchReplay.targetParentResolvesToOriginalOwner||!freshRejected||!report.owner.recordUnchanged||!report.owner.dirtyPreserved||!report.owner.stagedPreserved)throw Error('Review reproduction or preservation assertion failed')
