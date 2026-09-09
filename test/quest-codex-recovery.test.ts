import {test,expect,setDefaultTimeout} from 'bun:test'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,symlinkSync,readdirSync,rmdirSync,renameSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'
import {QuestStore} from '../quest/store'
import {coordination} from '../quest/coordination'
import {codexHook as runHook,stagedRecoveryCommand,type HookInput} from '../quest/codex/runtime'
import {prepareRecoveredEnvironment,executeRecoveredCommand} from '../quest/codex/recovery-command'
import {checkoutIndependent,recoverWorkspace as prepareWorkspace,recoveryPatch,recoveryWorkingDirectory,type RecoveryOptions} from '../quest/codex/recovery-workspace'
// Existing isolation/replay cases explicitly authorize the committed fixture,
// independent of the owner's dirty input. Default-policy regressions below do not.
function recoverWorkspace(store:QuestStore,repo:string,session:string,options:RecoveryOptions={}){
 const source=Object.values(options.aliases??{})[0]??repo
 const head=spawnSync('git',['-C',source,'rev-parse','HEAD'],{encoding:'utf8'}).stdout.trim()
 return prepareWorkspace(store,repo,session,{...options,sourceCommit:head})
}
function codexHook(input:HookInput,store:QuestStore){
 const head=spawnSync('git',['-C',input.cwd,'rev-parse','HEAD'],{encoding:'utf8'}).stdout.trim()
 return runHook(input,store,{sourceCommit:head})
}
setDefaultTimeout(30000)
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'ownership-recovery-')),repo=join(root,'repo');mkdirSync(repo)
 const git=(...args:string[])=>{const r=spawnSync('git',['-C',repo,...args],{encoding:'utf8',windowsHide:true});if(r.status!==0)throw Error(r.stderr);return r.stdout.trim()}
 git('init');writeFileSync(join(repo,'a.txt'),'committed');git('add','a.txt');git('commit','-m','fixture')
 writeFileSync(join(repo,'a.txt'),'owner dirty work')
 const store=new QuestStore(root),owner={directory:repo,sessionID:'owner',host:'opencode'}
 coordination(store,owner)({action:'join',title:'Existing owner',scopes:['.']})
 const ownerFile=join(store.runtime,'coordination',coordination(store,owner)({action:'status'}).project.id+'.json')
 const before=readFileSync(ownerFile,'utf8')
 let calls=0
  const hook=(tool_name:string,tool_input:any,session_id='contender')=>codexHook({session_id,cwd:repo,hook_event_name:'PreToolUse',tool_name,tool_input,tool_use_id:'call-'+(++calls)},store)
 return {root,repo,git,store,owner,ownerFile,before,hook}
}
test('web and literal skill reads run without acquiring or moving checkout ownership',()=>{
 const f=fixture()
 for(const [name,input] of [['webrun',{search_query:[{q:'Codex hooks'}]}],['WebSearch',{query:'HTML artifacts'}],['Read',{file_path:join(f.root,'skill.md')}],['Bash',{command:"Get-Content -LiteralPath 'C:/Users/Jk101/.agents/skills/windows-shell/SKILL.md'"}]] as const)expect(f.hook(name,input)).toEqual({})
 expect(readFileSync(f.ownerFile,'utf8')).toBe(f.before)
 expect(existsSync(join(f.repo,'.worktrees'))).toBe(false)
})
test('shell read exemptions reject expressions, pipelines, chained writes and relative paths',()=>{
 for(const command of ["Get-Content 'C:/x'; Set-Content 'C:/x' bad",'Get-Content "$([IO.File]::WriteAllText(\'C:/x\',\'bad\'))"',"Get-Content 'C:/x' | Invoke-Expression","Get-Content 'a.txt'","Get-Content 'C:/x' > C:/y",'Get-Content C:/x&evil'])expect(checkoutIndependent('Bash',{command})).toBe(false)
 expect(checkoutIndependent('Bash',{command:"Get-Content 'C:/one'; Get-Content -LiteralPath 'C:/two' -Tail 5"})).toBe(true)
 expect(checkoutIndependent('mcp__arbitrary__read',{})).toBe(false)
})
test('conflict prepares an owned worktree and rewrites the pending call without releasing owner',()=>{
 const f=fixture(),pre=f.hook('Bash',{command:"Set-Content a.txt 'recovered'"})
 expect(pre.hookSpecificOutput.permissionDecision).toBe('allow')
 expect(pre.hookSpecificOutput.updatedInput.command).toContain('recovery-command.ts')
 const binding=recoverWorkspace(f.store,f.repo,'contender')
 expect(binding.directory).not.toBe(f.repo)
 expect(readFileSync(join(binding.directory,'a.txt'),'utf8')).toBe('committed')
 expect(readFileSync(join(f.repo,'a.txt'),'utf8')).toBe('owner dirty work')
 const ownerNow=JSON.parse(readFileSync(f.ownerFile,'utf8')).participants.find((p:any)=>p.sessionID==='owner')
 expect(ownerNow).toEqual(JSON.parse(f.before).participants[0])
 const again=f.hook('Bash',{command:'Get-Location'})
 expect(again.hookSpecificOutput.permissionDecision).toBe('allow')
 expect(f.git('worktree','list','--porcelain').split('worktree ').length-1).toBe(2)
})
test('recovered edits survive hook restart and do not snapshot dirty owner work',()=>{
 const f=fixture(),binding=recoverWorkspace(f.store,f.repo,'contender')
 writeFileSync(join(binding.directory,'a.txt'),'task edit')
 expect(recoverWorkspace(new QuestStore(f.root),f.repo,'contender')).toEqual(binding)
 expect(readFileSync(join(binding.directory,'a.txt'),'utf8')).toBe('task edit')
 expect(readFileSync(join(f.repo,'a.txt'),'utf8')).toBe('owner dirty work')
})
test('an explicit hub alias creates a worktree only in its configured editable repository',()=>{
 const f=fixture(),hub=join(f.root,'hub');mkdirSync(hub)
 const binding=recoverWorkspace(f.store,hub,'hub-session',{aliases:{[hub]:f.repo}})
 expect(binding.repository.replaceAll('\\','/')).toBe(f.repo.replaceAll('\\','/'))
 expect(binding.directory).toContain('.worktrees')
 expect(readFileSync(f.ownerFile,'utf8')).toBe(f.before)
})
test('a pre-existing destination without a receipt is never adopted',()=>{
 const f=fixture(),binding=recoverWorkspace(f.store,f.repo,'contender')
 const otherStore=new QuestStore(join(f.root,'other-ledger'))
 expect(()=>recoverWorkspace(otherStore,f.repo,'contender')).toThrow('without a session receipt')
 expect(readFileSync(join(binding.directory,'a.txt'),'utf8')).toBe('committed')
})
test('patch targets bind to recovery checkout and reject escapes or owner junctions',()=>{
 const f=fixture(),binding=recoverWorkspace(f.store,f.repo,'contender')
 const patch=recoveryPatch('*** Begin Patch\n*** Update File: a.txt\n@@\n-committed\n+changed\n*** End Patch',binding)
 expect(patch).toContain(binding.directory.replaceAll('\\','/')+'/a.txt')
 expect(()=>recoveryPatch('*** Begin Patch\n*** Delete File: ../a.txt\n*** End Patch',binding)).toThrow('escapes')
 const link=join(binding.directory,'owner-link');symlinkSync(f.repo,link,process.platform==='win32'?'junction':'dir')
 expect(()=>recoveryPatch('*** Begin Patch\n*** Delete File: owner-link/a.txt\n*** End Patch',binding)).toThrow('resolves outside')
})
test('persistent tools without a verified rebinding path remain denied',()=>{
 const f=fixture();expect(f.hook('mcp__node_repl__js',{code:'write a file'}).hookSpecificOutput.permissionDecision).toBe('deny')
 expect(readFileSync(f.ownerFile,'utf8')).toBe(f.before)
})

test('duplicate recovery input reuses its ticket and unknown completion keeps ownership',()=>{
 const f=fixture(),input={session_id:'contender',cwd:f.repo,hook_event_name:'PreToolUse',tool_name:'Bash',tool_input:{command:'Set-Content created.txt fixture'},tool_use_id:'retry'}
 const first=codexHook(input,f.store),second=codexHook(input,f.store)
 expect(second).toEqual(first)
 expect(()=>codexHook({...input,tool_input:{command:'Set-Content a.txt changed'}},f.store)).toThrow('different input')
 const commandDirectory=join(f.store.runtime,'codex','commands'),tickets=readdirSync(commandDirectory).filter(p=>p.endsWith('.json'))
 expect(tickets).toHaveLength(1)
 codexHook({...input,hook_event_name:'PostToolUse',tool_response:{exit_code:1}},f.store)
 codexHook({...input,hook_event_name:'SessionEnd'},f.store)
 const binding=recoverWorkspace(f.store,f.repo,'contender'),context={directory:binding.directory,sessionID:'observer',host:'codex'}
 expect(coordination(f.store,context)({action:'status'}).participants.some((p:any)=>p.sessionID==='contender')).toBe(true)
 writeFileSync(join(commandDirectory,tickets[0]+'.claimed.result.json'),JSON.stringify({exitCode:0,stdout:'',stderr:''}))
 codexHook({...input,hook_event_name:'SessionEnd'},f.store)
 expect(coordination(f.store,context)({action:'status'}).participants.some((p:any)=>p.sessionID==='contender')).toBe(false)
 expect(readFileSync(join(f.repo,'a.txt'),'utf8')).toBe('owner dirty work')
})

test('a retried patch cannot bypass a new owner after the session releases its tree',()=>{
 const f=fixture(),input={session_id:'contender',cwd:f.repo,hook_event_name:'PreToolUse',tool_name:'apply_patch',tool_input:{command:'*** Begin Patch\n*** Add File: created.txt\n+owned\n*** End Patch'},tool_use_id:'patch-retry'}
 codexHook(input,f.store)
 codexHook({...input,hook_event_name:'PostToolUse',tool_response:{success:true}},f.store)
 codexHook({...input,hook_event_name:'SessionEnd'},f.store)
 const binding=recoverWorkspace(f.store,f.repo,'contender')
 const next={directory:binding.directory,sessionID:'next-owner',host:'codex'}
 expect(coordination(f.store,next)({action:'join',title:'Next owner',scopes:['.']}).acquired).toBe(true)
 expect(()=>codexHook(input,f.store)).toThrow('another owner')
 expect(coordination(f.store,next)({action:'status'}).participants.some((p:any)=>p.sessionID==='next-owner')).toBe(true)
})

test('cached patch replay revalidates every header after a destination becomes an owner junction',()=>{
 const f=fixture(),binding=recoverWorkspace(f.store,f.repo,'contender'),slot=join(binding.directory,'slot');mkdirSync(slot)
 const headers=['*** Add File: slot/a.txt\n+new','*** Update File: slot/a.txt\n@@\n-old\n+new','*** Delete File: slot/a.txt','*** Update File: a.txt\n*** Move to: slot/a.txt\n@@\n-committed\n+new']
 const inputs=headers.map((header,index)=>({session_id:'contender',cwd:f.repo,hook_event_name:'PreToolUse',tool_name:'apply_patch',tool_use_id:'cached-'+index,tool_input:{command:'*** Begin Patch\n'+header+'\n*** End Patch'}}))
 for(const input of inputs){const first=codexHook(input,f.store);expect(codexHook(input,f.store)).toEqual(first)}
 rmdirSync(slot);symlinkSync(f.repo,slot,process.platform==='win32'?'junction':'dir')
 for(const input of inputs)expect(()=>codexHook(input,new QuestStore(f.root))).toThrow('resolves outside')
 expect(readFileSync(join(f.repo,'a.txt'),'utf8')).toBe('owner dirty work')
 expect(JSON.parse(readFileSync(f.ownerFile,'utf8')).participants.find((p:any)=>p.sessionID==='owner')).toEqual(JSON.parse(f.before).participants[0])
},60000)

test('cached patch replay rejects a replaced recovery root before acquiring its new target',()=>{
 const f=fixture(),input={session_id:'contender',cwd:f.repo,hook_event_name:'PreToolUse',tool_name:'apply_patch',tool_use_id:'root-replay',tool_input:{command:'*** Begin Patch\n*** Delete File: a.txt\n*** End Patch'}}
 codexHook(input,f.store);const binding=recoverWorkspace(f.store,f.repo,'contender')
 renameSync(binding.directory,binding.directory+'-preserved');symlinkSync(f.repo,binding.directory,process.platform==='win32'?'junction':'dir')
 const before=readFileSync(f.ownerFile,'utf8')
 expect(()=>codexHook(input,new QuestStore(f.root))).toThrow('identity changed')
 expect(readFileSync(f.ownerFile,'utf8')).toBe(before)
 expect(readFileSync(join(f.repo,'a.txt'),'utf8')).toBe('owner dirty work')
})

test('cached patch replay rejects changed branch and missing binding without creating a replacement',()=>{
 const f=fixture(),input={session_id:'contender',cwd:f.repo,hook_event_name:'PreToolUse',tool_name:'apply_patch',tool_use_id:'identity-replay',tool_input:{command:'*** Begin Patch\n*** Delete File: a.txt\n*** End Patch'}}
 codexHook(input,f.store);const binding=recoverWorkspace(f.store,f.repo,'contender')
 const switched=spawnSync('git',['-C',binding.directory,'switch','-c','different-owner-branch'],{encoding:'utf8',windowsHide:true});expect(switched.status).toBe(0)
 expect(()=>codexHook(input,new QuestStore(f.root))).toThrow('identity changed')
 renameSync(binding.directory,binding.directory+'-preserved')
 expect(()=>codexHook(input,new QuestStore(f.root))).toThrow()
 expect(existsSync(binding.directory)).toBe(false)
 expect(readFileSync(join(f.repo,'a.txt'),'utf8')).toBe('owner dirty work')
})

test('packaged PreToolUse process blocks a cached patch junction replay with exit 2',async()=>{
 const f=fixture(),out=join(f.root,'package');mkdirSync(out)
 const built=await Bun.build({entrypoints:[join(import.meta.dir,'../quest/codex/hook.ts')],target:'bun',outdir:out,naming:'[name].js'})
 expect(built.success).toBe(true)
 const binding=recoverWorkspace(f.store,f.repo,'packaged'),slot=join(binding.directory,'slot');mkdirSync(slot)
 const input={session_id:'packaged',cwd:f.repo,hook_event_name:'PreToolUse',tool_name:'apply_patch',tool_use_id:'packaged-replay',tool_input:{command:'*** Begin Patch\n*** Add File: slot/a.txt\n+fixture\n*** End Patch'}}
 const invoke=()=>spawnSync(process.execPath,[join(out,'hook.js')],{input:JSON.stringify(input),encoding:'utf8',windowsHide:true,timeout:30000,env:{...process.env,OPENCODE_QUEST_ROOT:f.root}})
 const first=invoke();expect(first.status).toBe(0);expect(JSON.parse(first.stdout).hookSpecificOutput.permissionDecision).toBe('allow')
 const repeat=invoke();expect(repeat.status).toBe(0);expect(repeat.stdout).toBe(first.stdout)
 rmdirSync(slot);symlinkSync(f.repo,slot,process.platform==='win32'?'junction':'dir')
 const rejected=invoke();expect(rejected.status).toBe(2);expect(rejected.stdout.trim()).toBe('');expect(rejected.stderr).toContain('Patch path resolves outside the recovered checkout')
 expect(readFileSync(join(f.repo,'a.txt'),'utf8')).toBe('owner dirty work')
 expect(JSON.parse(readFileSync(f.ownerFile,'utf8')).participants.find((p:any)=>p.sessionID==='owner')).toEqual(JSON.parse(f.before).participants[0])
},60000)
test('recovered command keeps its explicit package working directory',()=>{
 const f=fixture(),nested=join(f.repo,'packages','fixture');mkdirSync(nested,{recursive:true});writeFileSync(join(nested,'package.json'),'{}');f.git('add','packages');f.git('commit','-m','nested fixture')
 const pre=f.hook('Bash',{command:'Set-Content created.txt fixture',workdir:nested})
 expect(pre.hookSpecificOutput.permissionDecision).toBe('allow')
 const binding=recoverWorkspace(f.store,f.repo,'contender'),dir=join(f.store.runtime,'codex','commands'),ticket=readdirSync(dir).find(p=>p.endsWith('.json'))!
 expect(JSON.parse(readFileSync(join(dir,ticket),'utf8')).directory).toBe(join(binding.directory,'packages','fixture'))
 expect(readFileSync(join(f.repo,'a.txt'),'utf8')).toBe('owner dirty work')
})
test('working directory mapping accepts package paths and rejects outside paths or junction escapes',()=>{
 const f=fixture(),nested=join(f.repo,'packages','fixture');mkdirSync(nested,{recursive:true});writeFileSync(join(nested,'package.json'),'{}');f.git('add','packages');f.git('commit','-m','nested fixture')
 const binding=recoverWorkspace(f.store,f.repo,'contender'),target=join(binding.directory,'packages','fixture')
 expect(recoveryWorkingDirectory(binding,'packages/fixture')).toBe(target)
 expect(recoveryWorkingDirectory(binding,target)).toBe(target)
 expect(recoveryWorkingDirectory({...binding,origin:nested})).toBe(target)
 const hub=join(f.root,'hub');mkdirSync(hub);const config=join(hub,'config');symlinkSync(f.repo,config,process.platform==='win32'?'junction':'dir')
 expect(recoveryWorkingDirectory({...binding,origin:hub},join(config,'packages','fixture'))).toBe(target)
 expect(()=>recoveryWorkingDirectory(binding,f.root)).toThrow('escapes')
 expect(()=>recoveryWorkingDirectory(binding,'../')).toThrow('escapes')
 const external=join(f.repo,'external');symlinkSync(f.root,external,process.platform==='win32'?'junction':'dir')
 expect(()=>recoveryWorkingDirectory(binding,external)).toThrow('escapes')
 const ownerLink=join(binding.directory,'owner-link');symlinkSync(f.repo,ownerLink,process.platform==='win32'?'junction':'dir')
 expect(()=>recoveryWorkingDirectory(binding,ownerLink)).toThrow('escapes')
 expect(readFileSync(join(f.repo,'a.txt'),'utf8')).toBe('owner dirty work')
})
test('default recovery refuses dirty input omission with a durable preparation reason',()=>{
 const f=fixture()
 writeFileSync(join(f.repo,'private-untracked.txt'),'owner secret fixture')
 expect(()=>prepareWorkspace(f.store,f.repo,'default-source')).toThrow('Untracked source inputs are ambiguous')
 expect(existsSync(join(f.repo,'.worktrees'))).toBe(false)
 const receipts=join(f.store.runtime,'codex','workspaces')
 const receipt=JSON.parse(readFileSync(join(receipts,readdirSync(receipts)[0]),'utf8'))
 expect(receipt.preparation.state).toBe('blocked')
 expect(receipt.preparation.dirty).toBe(true)
 expect(JSON.stringify(receipt)).not.toContain('owner secret fixture')
 expect(readFileSync(f.ownerFile,'utf8')).toBe(f.before)
 expect(readFileSync(join(f.repo,'private-untracked.txt'),'utf8')).toBe('owner secret fixture')
})
test('clean source recovery reports readiness and uses the selected checkout commit',()=>{
 const f=fixture();f.git('add','a.txt');f.git('commit','-m','authorized fixture source')
 const binding=prepareWorkspace(f.store,f.repo,'clean-source')
 expect(binding.head).toBe(f.git('rev-parse','HEAD'))
 expect(binding.preparation).toEqual({state:'ready',source:'clean-checkout',dirty:false,environment:'no package dependencies',reason:undefined})
 expect(readFileSync(join(binding.directory,'a.txt'),'utf8')).toBe('owner dirty work')
 expect(prepareWorkspace(f.store,f.repo,'clean-source')).toEqual(binding)
})
test('tracked dirty inputs recover automatically through an immutable snapshot without changing owner index',()=>{
 const f=fixture()
 writeFileSync(join(f.repo,'staged.txt'),'staged input');f.git('add','staged.txt')
 const indexBefore=f.git('ls-files','--stage'),statusBefore=f.git('status','--porcelain')
 const input={session_id:'tracked-default',cwd:f.repo,hook_event_name:'PreToolUse',tool_name:'apply_patch',tool_use_id:'first',tool_input:{command:'*** Begin Patch\n*** Add File: task.txt\n+task\n*** End Patch'}}
 const result=runHook(input,f.store)
 expect(result.hookSpecificOutput.permissionDecision).toBe('allow')
 const binding=prepareWorkspace(f.store,f.repo,'tracked-default')
 expect(binding.preparation?.source).toBe('tracked-snapshot')
 expect(binding.preparation?.tree).toMatch(/^[a-f0-9]{40}$/)
 expect(binding.preparation?.applied).toBe(true)
 expect(readFileSync(join(binding.directory,'a.txt'),'utf8')).toBe('owner dirty work')
 expect(readFileSync(join(binding.directory,'staged.txt'),'utf8')).toBe('staged input')
 expect(f.git('ls-files','--stage')).toBe(indexBefore)
 expect(f.git('status','--porcelain','--','.',':(exclude).worktrees')).toBe(statusBefore)
 writeFileSync(join(f.repo,'a.txt'),'owner later edit')
 expect(prepareWorkspace(f.store,f.repo,'tracked-default').preparation?.tree).toBe(binding.preparation?.tree)
 expect(readFileSync(join(binding.directory,'a.txt'),'utf8')).toBe('owner dirty work')
 expect(JSON.parse(readFileSync(f.ownerFile,'utf8')).participants.find((p:any)=>p.sessionID==='owner')).toEqual(JSON.parse(f.before).participants[0])
})
test('sensitive tracked inputs require explicit handoff instead of being copied',()=>{
 const f=fixture();writeFileSync(join(f.repo,'.env'),'fixture-only');f.git('add','.env');f.git('commit','-m','sensitive fixture baseline')
 writeFileSync(join(f.repo,'.env'),'private dirty value')
 expect(()=>prepareWorkspace(f.store,f.repo,'sensitive')).toThrow('Sensitive tracked input requires explicit handoff: .env')
 expect(existsSync(join(f.repo,'.worktrees'))).toBe(false)
 expect(readFileSync(f.ownerFile,'utf8')).toBe(f.before)
})
test('tracked source junctions cannot smuggle external input into a snapshot',()=>{
 const f=fixture(),folder=join(f.repo,'source');mkdirSync(folder);writeFileSync(join(folder,'code.txt'),'baseline');f.git('add','source');f.git('commit','-m','tracked folder')
 renameSync(folder,folder+'-preserved')
 const outside=join(f.root,'external');mkdirSync(outside);writeFileSync(join(outside,'code.txt'),'external fixture')
 symlinkSync(outside,folder,process.platform==='win32'?'junction':'dir')
 // The moved tracked directory is ignored only in this isolated fixture so the
 // assertion reaches canonical path validation rather than untracked admission.
 f.git('config','core.excludesFile',join(f.root,'fixture-ignore'))
 writeFileSync(join(f.root,'fixture-ignore'),'source-preserved/\n')
 expect(()=>prepareWorkspace(f.store,f.repo,'source-junction')).toThrow('not an isolated regular file')
 expect(existsSync(join(f.repo,'.worktrees'))).toBe(false)
 expect(readFileSync(join(outside,'code.txt'),'utf8')).toBe('external fixture')
})
test('snapshot and worktree materialization never invoke configured filters or fsmonitor',()=>{
 const f=fixture(),marker=join(f.root,'filter-invoked'),monitor=join(f.root,'monitor-invoked')
 writeFileSync(join(f.repo,'.gitattributes'),'a.txt filter=fixture\n');f.git('add','.gitattributes');f.git('commit','-m','filter attributes')
 f.git('config','filter.fixture.clean',`echo invoked > '${marker.replaceAll('\\','/')}'; cat`)
 f.git('config','filter.fixture.smudge',`echo invoked > '${marker.replaceAll('\\','/')}'; cat`)
 f.git('config','core.fsmonitor',`echo invoked > '${monitor.replaceAll('\\','/')}'`)
 const binding=prepareWorkspace(f.store,f.repo,'filter-safe')
 expect(binding.preparation?.source).toBe('tracked-snapshot')
 expect(readFileSync(join(binding.directory,'a.txt'),'utf8')).toBe('owner dirty work')
 expect(existsSync(marker)).toBe(false)
 expect(existsSync(monitor)).toBe(false)
})
test('dependency preparation is visibly blocked without running lifecycle scripts or sharing owner dependencies',()=>{
 const f=fixture()
 writeFileSync(join(f.repo,'package.json'),JSON.stringify({dependencies:{fixture:'1.0.0'},scripts:{postinstall:'echo forbidden'}}))
 f.git('add','package.json');f.git('commit','-m','dependency fixture')
 expect(()=>recoverWorkspace(f.store,f.repo,'dependencies',{needsEnvironment:true})).toThrow('isolated preparation receipt')
 const receipts=join(f.store.runtime,'codex','workspaces'),receipt=JSON.parse(readFileSync(join(receipts,readdirSync(receipts)[0]),'utf8'))
 expect(receipt.preparation.state).toBe('blocked')
 expect(existsSync(join(receipt.directory,'node_modules'))).toBe(false)
 expect(()=>recoverWorkspace(f.store,f.repo,'dependencies',{needsEnvironment:true})).toThrow('isolated preparation receipt')
 const patch=f.hook('apply_patch',{command:'*** Begin Patch\n*** Add File: task.txt\n+task\n*** End Patch'},'dependencies')
 expect(patch.hookSpecificOutput.permissionDecision).toBe('allow')
 expect(f.hook('Read',{file_path:'package.json'},'dependencies').hookSpecificOutput.updatedInput.file_path).toBe(join(receipt.directory,'package.json'))
 expect(f.hook('Bash',{command:'bun test'},'dependencies').hookSpecificOutput.permissionDecision).toBe('allow')
 const tickets=join(f.store.runtime,'codex','commands')
 expect(readdirSync(tickets).map(name=>JSON.parse(readFileSync(join(tickets,name),'utf8'))).some(row=>row.command==='bun test'&&row.prepare===true)).toBe(true)
 expect(JSON.parse(readFileSync(f.ownerFile,'utf8')).participants.find((p:any)=>p.sessionID==='owner')).toEqual(JSON.parse(f.before).participants[0])
})
test('fixed Bun preparation records verified result, reuses it, and never prepares from a read-only ticket',async()=>{
  const root=mkdtempSync(join(tmpdir(),'recovery-preparation-')),receipt=join(root,'receipt.json')
  const cache=join(root,'source-cache'),slot=join(cache,'fixture@1.0.0@@@1');mkdirSync(slot,{recursive:true});writeFileSync(join(slot,'package.json'),JSON.stringify({name:'fixture',version:'1.0.0'}))
 writeFileSync(join(root,'package.json'),JSON.stringify({packageManager:'bun@1.3.14',dependencies:{fixture:'1.0.0'},scripts:{postinstall:'must not execute'}}))
  writeFileSync(join(root,'bun.lock'),JSON.stringify({lockfileVersion:1,workspaces:{'':{dependencies:{fixture:'1.0.0'}}},packages:{fixture:['fixture@1.0.0','',{},'sha512-'+Buffer.alloc(64).toString('base64')]}}))
 let calls=0
 const execute=async(directory:string,command:string,workspace?:string)=>{
  calls++;expect(directory).toBe(root);expect(workspace).toBe(root)
  expect(command).toContain('--frozen-lockfile --ignore-scripts --backend=copyfile')
   expect(command).toContain('--registry=http://127.0.0.1:9');expect(command).not.toContain('must not execute')
   expect(command).toContain('--cache-dir=');expect(command).not.toContain(cache)
  mkdirSync(join(root,'node_modules'));return {exitCode:0,stdout:'installed',stderr:''}
 }
  const prepared=await prepareRecoveredEnvironment(root,receipt,execute,cache)
  expect(prepared.state).toBe('ready')
  writeFileSync(join(prepared.cache.directory,'fixture@1.0.0@@@1','package.json'),'private edit')
  expect(JSON.parse(readFileSync(join(slot,'package.json'),'utf8')).name).toBe('fixture')
  renameSync(cache,cache+'-preserved')
  expect((await prepareRecoveredEnvironment(root,receipt,execute,cache)).cache).toEqual(prepared.cache);expect(calls).toBe(1)
  renameSync(prepared.cache.directory,prepared.cache.directory+'-preserved')
  symlinkSync(cache+'-preserved',prepared.cache.directory,process.platform==='win32'?'junction':'dir')
  await expect(prepareRecoveredEnvironment(root,receipt,execute,cache)).rejects.toThrow('symlink/junction')
 expect(JSON.parse(readFileSync(receipt,'utf8'))).toMatchObject({networkAccess:false,scripts:false,backend:'copyfile'})
 writeFileSync(join(root,'package.json'),'{}')
 await expect(prepareRecoveredEnvironment(root,receipt,execute)).rejects.toThrow('inputs changed')
 expect(calls).toBe(1)
 const f=fixture();writeFileSync(join(f.repo,'package.json'),JSON.stringify({dependencies:{fixture:'1.0.0'}}));f.git('add','package.json');f.git('commit','-m','package')
 f.hook('apply_patch',{command:'*** Begin Patch\n*** Add File: task.txt\n+task\n*** End Patch'})
 f.hook('Bash',{command:'Get-Location'})
 const tickets=join(f.store.runtime,'codex','commands'),ticket=JSON.parse(readFileSync(join(tickets,readdirSync(tickets)[0]),'utf8'))
 expect(ticket.prepare).toBe(false)
})
test('failed or unknown dependency preparation stays bounded and preserves readable task inputs',async()=>{
 const root=mkdtempSync(join(tmpdir(),'recovery-preparation-')),receipt=join(root,'receipt.json')
 writeFileSync(join(root,'package.json'),'{}');writeFileSync(join(root,'bun.lock'),'{"lockfileVersion":1,"workspaces":{"":{}},"packages":{}}')
  let calls=0;const execute=async()=>{calls++;return {exitCode:1,stdout:'token=fixture-secret '+ 'x'.repeat(5000),stderr:'EPERM opening cache https://user:password@example.test/path'}}
 await expect(prepareRecoveredEnvironment(root,receipt,execute)).rejects.toThrow('cache-only preparation failed')
 await expect(prepareRecoveredEnvironment(root,receipt,execute)).rejects.toThrow('Prior dependency preparation is blocked')
  expect(calls).toBe(1);expect(readFileSync(join(root,'package.json'),'utf8')).toBe('{}')
  const failed=JSON.parse(readFileSync(receipt,'utf8'))
  expect(failed.output.stderr).toContain('EPERM opening cache');expect(failed.output.stdout.length).toBeLessThanOrEqual(4096)
  expect(JSON.stringify(failed)).not.toContain('fixture-secret');expect(JSON.stringify(failed)).not.toContain('user:password')
 const unknown=join(root,'unknown.json'),prior=JSON.parse(readFileSync(receipt,'utf8'));writeFileSync(unknown,JSON.stringify({...prior,state:'started'}))
 await expect(prepareRecoveredEnvironment(root,unknown,execute)).rejects.toThrow('Prior dependency preparation is started')
  expect(calls).toBe(1)
 })
test('private preparation copies only exact locked scoped packages and preserves unrelated cache files',async()=>{
 const root=mkdtempSync(join(tmpdir(),'recovery-preparation-')),cache=join(root,'source-cache'),slot=join(cache,'@scope','fixture@1.0.0@@@1')
 mkdirSync(slot,{recursive:true});writeFileSync(join(slot,'package.json'),JSON.stringify({name:'@scope/fixture',version:'1.0.0'}));writeFileSync(join(cache,'secret.txt'),'must stay outside')
 writeFileSync(join(root,'package.json'),'{}');writeFileSync(join(root,'bun.lock'),JSON.stringify({packages:{fixture:['@scope/fixture@1.0.0','',{},'sha512-'+Buffer.alloc(64).toString('base64')]}}))
 const prepared=await prepareRecoveredEnvironment(root,join(root,'receipt.json'),async()=>{mkdirSync(join(root,'node_modules'));return {exitCode:0}},cache)
 expect(prepared.cache.packages).toEqual(['@scope/fixture@1.0.0'])
 expect(existsSync(join(prepared.cache.directory,'@scope','fixture@1.0.0@@@1','package.json'))).toBe(true)
 expect(existsSync(join(prepared.cache.directory,'secret.txt'))).toBe(false)
 expect(readFileSync(join(cache,'secret.txt'),'utf8')).toBe('must stay outside')
})
test('private preparation blocks missing, mismatched, linked, sensitive and oversized cache packages before executing',async()=>{
 for(const kind of ['missing','mismatch','junction','ancestor','sensitive','oversized','depth','files','unsafe-lock','integrity','packages']){
  const root=mkdtempSync(join(tmpdir(),'recovery-preparation-')),cache=join(root,'cache'),slot=join(cache,'fixture@1.0.0@@@1'),receipt=join(root,'receipt.json')
  mkdirSync(slot,{recursive:true});writeFileSync(join(slot,'package.json'),JSON.stringify({name:kind==='mismatch'?'other':'fixture',version:'1.0.0'}))
  writeFileSync(join(root,'package.json'),'{}');writeFileSync(join(root,'bun.lock'),JSON.stringify({packages:{fixture:[kind==='unsafe-lock'?'../fixture@1.0.0':'fixture@1.0.0','',{},'sha512-'+Buffer.alloc(64).toString('base64')]}}))
  if(kind==='integrity')writeFileSync(join(root,'bun.lock'),JSON.stringify({packages:{fixture:['fixture@1.0.0','',{},'sha512-invalid']}}))
  if(kind==='packages')writeFileSync(join(root,'bun.lock'),JSON.stringify({packages:Object.fromEntries(Array.from({length:257},(_,n)=>['fixture'+n,['fixture'+n+'@1.0.0','',{},'sha512-'+Buffer.alloc(64).toString('base64')]]))}))
  if(kind==='missing')renameSync(slot,slot+'-preserved')
  if(kind==='junction'){const outside=join(root,'outside');mkdirSync(outside);writeFileSync(join(outside,'secret.txt'),'private');symlinkSync(outside,join(slot,'escape'),process.platform==='win32'?'junction':'dir')}
  if(kind==='ancestor'){renameSync(cache,cache+'-preserved');symlinkSync(cache+'-preserved',cache,process.platform==='win32'?'junction':'dir')}
  if(kind==='sensitive')writeFileSync(join(slot,'.env'),'private')
  if(kind==='oversized')writeFileSync(join(slot,'large.bin'),Buffer.alloc(32*1024*1024+1))
  if(kind==='depth')mkdirSync(join(slot,...Array(34).fill('nested')),{recursive:true})
  if(kind==='files')for(let n=0;n<10000;n++)writeFileSync(join(slot,n+'.js'),'')
  let calls=0;const execute=async()=>{calls++;return {exitCode:0}}
  await expect(prepareRecoveredEnvironment(root,receipt,execute,cache)).rejects.toThrow()
  await expect(prepareRecoveredEnvironment(root,receipt,execute,cache)).rejects.toThrow()
  expect(calls).toBe(0);expect(existsSync(join(root,'node_modules'))).toBe(false)
  if(kind!=='unsafe-lock'&&kind!=='integrity')expect(JSON.parse(readFileSync(receipt,'utf8')).state).toBe('blocked')
 }
},60000)
test('reads after recovery retain task contents while external skills and web stay independent',()=>{
 const f=fixture();f.hook('apply_patch',{command:'*** Begin Patch\n*** Add File: task.txt\n+task\n*** End Patch'})
 const binding=recoverWorkspace(f.store,f.repo,'contender');writeFileSync(join(binding.directory,'a.txt'),'task contents')
 for(const file_path of ['a.txt',join(f.repo,'a.txt')]){
  const result=f.hook('Read',{file_path})
  expect(readFileSync(result.hookSpecificOutput.updatedInput.file_path,'utf8')).toBe('task contents')
 }
 expect(f.hook('Grep',{pattern:'task'}).hookSpecificOutput.updatedInput.path).toBe(binding.directory)
 const sourceRead=f.hook('Bash',{command:"Get-Content -LiteralPath '"+join(f.repo,'a.txt')+"'"})
 expect(sourceRead.hookSpecificOutput.updatedInput.command).toContain('recovery-command.ts')
 const tickets=join(f.store.runtime,'codex','commands'),ticket=JSON.parse(readFileSync(join(tickets,readdirSync(tickets)[0]),'utf8'))
 expect(ticket.command).toContain(join(binding.directory,'a.txt'))
 expect(f.hook('Read',{file_path:join(f.root,'external-skill.md')})).toEqual({})
 expect(f.hook('Bash',{command:"Get-Content -LiteralPath 'C:/Users/Jk101/.agents/skills/windows-shell/SKILL.md'"})).toEqual({})
 expect(f.hook('WebSearch',{query:'test'})).toEqual({})
 expect(readFileSync(join(f.repo,'a.txt'),'utf8')).toBe('owner dirty work')
})
test('bounded read-only audits bypass ownership but not arbitrary shell syntax',()=>{
 const f=fixture()
 expect(f.hook('Bash',{command:'Get-Location'})).toEqual({})
 for(const command of ['git status --short','git rev-parse HEAD','git diff --stat'])expect(checkoutIndependent('Bash',{command})).toBe(false)
 for(const command of ['git -c alias.x=!evil x','git diff --ext-diff','git status --short | Invoke-Expression','Get-Location; Set-Content a.txt bad','git status --short > report'])expect(checkoutIndependent('Bash',{command})).toBe(false)
 expect(existsSync(join(f.repo,'.worktrees'))).toBe(false)
 expect(readFileSync(f.ownerFile,'utf8')).toBe(f.before)
})

async function packagedRecovery(){
 const f=fixture(),out=join(f.root,'installed-cache','scripts');mkdirSync(out,{recursive:true})
 const built=await Bun.build({entrypoints:[join(import.meta.dir,'../quest/codex/hook.ts'),join(import.meta.dir,'../quest/codex/recovery-command.ts')],target:'bun',outdir:out,naming:'[name].js'})
 expect(built.success).toBe(true)
 const input={session_id:'bundled',cwd:f.repo,hook_event_name:'PreToolUse',tool_name:'Bash',tool_use_id:'bundled-command',tool_input:{command:"Add-Content a.txt '-executed-once'; Get-Content a.txt"}}
 const invoke=()=>spawnSync(process.execPath,[join(out,'hook.js')],{input:JSON.stringify(input),encoding:'utf8',windowsHide:true,timeout:30000,env:{...process.env,OPENCODE_QUEST_ROOT:f.root}})
 const first=invoke();expect(first.status).toBe(0)
 const command=JSON.parse(first.stdout).hookSpecificOutput.updatedInput.command as string
 const state=JSON.parse(readFileSync(join(f.store.runtime,'codex',readdirSync(join(f.store.runtime,'codex')).find(name=>/^[a-f0-9]{64}\.json$/.test(name))!),'utf8'))
 return {...f,out,input,invoke,command,ticket:state.calls['bundled-command'].recoveryTicket as string,binding:state.recovery}
}
test('exact bundled hook stages immutable runner bytes and executes its retry in normal workspace-write sandbox',async()=>{
 const f=await packagedRecovery()
 const priorHome=process.env.CODEX_HOME;process.env.CODEX_HOME=join(f.root,'codex-home');mkdirSync(process.env.CODEX_HOME)
 try{
 expect(f.command).not.toContain(f.out)
 expect(f.command).toContain('--eval')
 expect(readFileSync(join(f.ticket,'..','recovery-command.js'))).toEqual(readFileSync(join(f.out,'recovery-command.js')))
 expect(JSON.parse(f.invoke().stdout).hookSpecificOutput.updatedInput.command).toBe(f.command)
 const result=await executeRecoveredCommand(f.repo,f.command,f.repo)
 expect(result.exitCode,result.stderr).toBe(0)
 expect(result.stdout).toContain('owner dirty work-executed-once')
 const after=readFileSync(join(f.binding.directory,'a.txt'),'utf8')
 const replay=await executeRecoveredCommand(f.repo,f.command,f.repo)
 expect(replay.exitCode,replay.stderr).toBe(0)
 expect(readFileSync(join(f.binding.directory,'a.txt'),'utf8')).toBe(after)
 expect(readFileSync(join(f.repo,'a.txt'),'utf8')).toBe('owner dirty work')
 expect(JSON.parse(readFileSync(f.ownerFile,'utf8')).participants.find((p:any)=>p.sessionID==='owner')).toEqual(JSON.parse(f.before).participants[0])
 expect(JSON.parse(readFileSync(f.ticket+'.claimed.result.json','utf8')).ticketHash).toMatch(/^[a-f0-9]{64}$/)
 console.log('Bundled sandbox recovery receipt: '+f.ticket+'.claimed.result.json')
 }finally{if(priorHome===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=priorHome}
},120000)
test('staged runner rejects helper/ticket tampering and junctions before any command claim',async()=>{
 const f=await packagedRecovery(),runner=join(f.ticket,'..','recovery-command.js'),original=readFileSync(runner),ticket=readFileSync(f.ticket)
 const invoke=()=>spawnSync('pwsh',['-NoProfile','-NonInteractive','-Command',f.command],{cwd:f.repo,encoding:'utf8',windowsHide:true,timeout:30000})
 writeFileSync(runner,"throw Error('tampered helper ran')")
 let result=invoke();expect(result.status).not.toBe(0);expect(result.stderr).toContain('helper digest mismatch');expect(result.stderr).not.toContain('tampered helper ran')
 writeFileSync(runner,original);writeFileSync(f.ticket,JSON.stringify({...JSON.parse(ticket.toString()),command:'tampered command'}))
 result=invoke();expect(result.status).not.toBe(0);expect(result.stderr).toContain('ticket digest mismatch')
 writeFileSync(f.ticket,ticket)
 const directory=join(f.ticket,'..');renameSync(directory,directory+'-preserved');symlinkSync(directory+'-preserved',directory,process.platform==='win32'?'junction':'dir')
 result=invoke();expect(result.status).not.toBe(0);expect(result.stderr).toContain('symlink/junction')
 expect(existsSync(f.ticket+'.claimed')).toBe(false)
 expect(readFileSync(join(f.repo,'a.txt'),'utf8')).toBe('owner dirty work')
},60000)
test('staging rejects a linked installed helper and unknown claimed commands never replay',async()=>{
 const f=await packagedRecovery(),linked=join(f.root,'linked');symlinkSync(f.out,linked,process.platform==='win32'?'junction':'dir')
 expect(()=>stagedRecoveryCommand(join(linked,'recovery-command.js'),{command:'unused',ticket:f.ticket})).toThrow('symlink/junction')
 writeFileSync(f.ticket+'.claimed',readFileSync(f.ticket),{flag:'wx'})
 const result=spawnSync('pwsh',['-NoProfile','-NonInteractive','-Command',f.command],{cwd:f.repo,encoding:'utf8',windowsHide:true,timeout:30000})
 expect(result.status).not.toBe(0);expect(result.stderr).toContain('completion is unknown')
 expect(existsSync(f.ticket+'.claimed.result.json')).toBe(false)
 expect(readFileSync(join(f.binding.directory,'a.txt'),'utf8')).toBe('owner dirty work')
},60000)

 test('clarification and agent status controls never acquire or mutate checkout ownership',()=>{
 const f=fixture();
 for(const tool of ['request_user_input_async','request_user_input','collaborationlist_agents','collaborationwait_agent','view_image']){
   expect(checkoutIndependent(tool,{})).toBe(true)
   expect(f.hook(tool,{})).toEqual({})
 }
 expect(readFileSync(f.ownerFile,'utf8')).toBe(f.before)
 expect(f.git('worktree','list','--porcelain').split('worktree ').length-1).toBe(1)
 for(const tool of ['collaborationspawn_agent_write','collaborationsend_message_write','mcp__untrusted__write','request_user_input_async_write'])expect(checkoutIndependent(tool,{})).toBe(false)
 })

test('goal lifecycle is checkout independent before and after recovery, including PostToolUse',()=>{
 const f=fixture()
 const names=['create_goal','get_goal','update_goal','functions.create_goal','functions.get_goal','functions.update_goal']
 for(const name of names){
  expect(f.hook(name,{objective:'fixture',status:'complete'})).toEqual({})
  expect(runHook({session_id:'contender',cwd:f.repo,hook_event_name:'PostToolUse',tool_name:name,tool_input:{}},f.store)).toEqual({})
 }
 expect(readFileSync(f.ownerFile,'utf8')).toBe(f.before)
 expect(existsSync(join(f.repo,'.worktrees'))).toBe(false)
 f.hook('Bash',{command:'Write-Output fixture'})
 const before=readFileSync(f.ownerFile,'utf8')
 for(const name of names)expect(f.hook(name,{})).toEqual({})
 expect(readFileSync(f.ownerFile,'utf8')).toBe(before)
 for(const name of ['mcp__evil__create_goal','create_goal_and_write','functions.exec'])expect(checkoutIndependent(name,{})).toBe(false)
})

test('same session accepts junction and physical cwd but rejects a different checkout',()=>{
 const f=fixture(),alias=join(f.root,'alias');symlinkSync(f.repo,alias,process.platform==='win32'?'junction':'dir')
 runHook({session_id:'alias-session',cwd:alias,hook_event_name:'SessionStart'},f.store)
 expect(runHook({session_id:'alias-session',cwd:f.repo,hook_event_name:'PreToolUse',tool_name:'get_goal',tool_input:{}},f.store)).toEqual({})
 expect(()=>runHook({session_id:'alias-session',cwd:f.root,hook_event_name:'PreToolUse',tool_name:'get_goal'},f.store)).toThrow('Session checkout changed')
 expect(readFileSync(f.ownerFile,'utf8')).toBe(f.before)
})
test('junction reconciliation releases only an ended owner with matching terminal evidence',()=>{
 const f=fixture(),alias=join(f.root,'alias'),store=new QuestStore(join(f.root,'alias-ledger'))
 symlinkSync(f.repo,alias,process.platform==='win32'?'junction':'dir')
 const transcript=join(f.root,'owner.jsonl'),rows:any[]=[{type:'session_meta',payload:{id:'alias-owner'}}]
 const flush=()=>writeFileSync(transcript,rows.map(r=>JSON.stringify(r)).join('\n'))
 const invoke=(event:string)=>runHook({session_id:'alias-owner',cwd:alias,hook_event_name:event,transcript_path:transcript,tool_name:'mcp__fixture__write',tool_use_id:'pending'},store)
 flush();invoke('SessionStart');invoke('PreToolUse');invoke('SessionEnd')
 const inspect=()=>coordination(store,{directory:f.repo,sessionID:'observer',host:'codex'})({action:'status'})
 runHook({session_id:'observer',cwd:f.repo,hook_event_name:'SessionStart'},store)
 expect(inspect().participants.some(p=>p.sessionID==='alias-owner')).toBe(true)
 rows.push({type:'event_msg',payload:{type:'item_completed',item:{id:'pending',type:'McpToolCall',status:'completed'}}});flush()
 runHook({session_id:'observer',cwd:f.repo,hook_event_name:'SessionStart'},store)
 expect(inspect().participants.some(p=>p.sessionID==='alias-owner')).toBe(false)
 expect(readFileSync(f.ownerFile,'utf8')).toBe(f.before)
})
test('native subagent dispatch is checkout independent but child writes still recover',()=>{
 const f=fixture()
 for(const name of ['spawn_agent','collaboration.spawn_agent','collaborationspawn_agent','collaboration.send_message','collaboration.followup_task','collaboration.interrupt_agent']){
  expect(f.hook(name,{task_name:'luna',message:'Perform bounded work',model:'gpt-5.6-luna'})).toEqual({})
 }
 expect(readFileSync(f.ownerFile,'utf8')).toBe(f.before)
 expect(existsSync(join(f.repo,'.worktrees'))).toBe(false)
 expect(checkoutIndependent('mcp__unknown__spawn_agent',{})).toBe(false)
 expect(checkoutIndependent('Agent',{})).toBe(false)
 const pre=f.hook('Bash',{command:"Set-Content a.txt 'child work'"},'luna-child')
 expect(pre.hookSpecificOutput.permissionDecision).toBe('allow')
 expect(pre.hookSpecificOutput.updatedInput.command).toContain('recovery-command')
 expect(readFileSync(join(f.repo,'a.txt'),'utf8')).toBe('owner dirty work')
 const ownerNow=JSON.parse(readFileSync(f.ownerFile,'utf8')).participants.find((p:any)=>p.sessionID==='owner')
 expect(ownerNow).toEqual(JSON.parse(f.before).participants[0])
})
