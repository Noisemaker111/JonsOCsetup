/** Read-only portable preflight. Does not reserve a checkout or claim tool capabilities. */
import { spawnSync } from 'node:child_process'
import { resolve,join } from 'node:path'
import { existsSync,readFileSync } from 'node:fs'
import {homedir} from 'node:os'
const cwd=resolve(process.argv[2]??process.cwd())
const git=(args)=>{const r=spawnSync('git',['-C',cwd,...args],{encoding:'utf8',windowsHide:true,timeout:5000,maxBuffer:1024*1024});if(r.status!==0)throw Error(r.stderr?.trim()||r.error?.message||'Git failed');return r.stdout.trim()}
try {
 const settingsFile=process.env.OPENCODE_QUEST_SETTINGS??join(process.env.OPENCODE_CONFIG_DIR??join(homedir(),'.config','opencode'),'quest-settings.json')
 const settings=existsSync(settingsFile)?JSON.parse(readFileSync(settingsFile,'utf8')):{version:1,workspaceMode:'worktree'}
 if(settings.version!==1||!['shared','worktree'].includes(settings.workspaceMode))throw Error('Invalid Quest workspace settings')
 const root=git(['rev-parse','--show-toplevel']),head=git(['rev-parse','HEAD']),branch=git(['branch','--show-current'])
 const dir=git(['rev-parse','--absolute-git-dir'])
 const operations=['MERGE_HEAD','CHERRY_PICK_HEAD','REVERT_HEAD','rebase-merge','rebase-apply','index.lock'].filter(n=>existsSync(join(dir,n)))
 const changes=git(['status','--porcelain','--untracked-files=all','--','.',':(exclude,glob)**/.claude/worktrees/**']).split('\n').filter(Boolean)
 console.log(JSON.stringify({workspaceMode:settings.workspaceMode,workspace:root,head:head.slice(0,12),branch:branch||null,dirtyFiles:changes.length,operations,ownership:'check host reservation',next:operations.length?'reconcile existing Git operation':'reuse if assigned and owned; preserve other changes'}))
 process.exitCode=operations.length?2:0
} catch(error) {console.log(JSON.stringify({workspace:cwd,error:String(error),next:'resolve workspace identity before editing'}));process.exitCode=1}
