/** Shared filesystem boundary for Quest and development checkout retirement. */
import {existsSync,realpathSync,readdirSync,lstatSync,unlinkSync,rmdirSync} from 'node:fs'
import {resolve,relative,isAbsolute,join} from 'node:path'
import {spawnSync} from 'node:child_process'
export const pathKey=p=>resolve(p).replaceAll('\\','/').toLowerCase()
export const within=(root,path)=>{const rel=relative(resolve(root),resolve(path));return !!rel&&!rel.startsWith('..')&&!isAbsolute(rel)}
export function git(root,args){const r=spawnSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:16*1024*1024});if(r.status!==0)throw Error(r.stderr?.trim()||r.error?.message||'Git failed');return r.stdout.trim()}
export function integrationRef(root,source=root){
 const configured=spawnSync('git',['-C',root,'config','--get','quest.integrationRef'],{encoding:'utf8',windowsHide:true})
 if(configured.status===0&&configured.stdout.trim())return configured.stdout.trim()
 const upstream=spawnSync('git',['-C',source,'rev-parse','--symbolic-full-name','@{upstream}'],{encoding:'utf8',windowsHide:true})
 if(upstream.status===0)return upstream.stdout.trim()
 throw Error('Set the project integration ref with git config quest.integrationRef <reviewed-branch>; checkout HEAD is not integration proof')
}
export function registeredWorktrees(root){return git(root,['worktree','list','--porcelain','-z']).split('\0\0').filter(Boolean).map(block=>Object.fromEntries(block.split('\0').filter(Boolean).map(field=>{const i=field.indexOf(' ');return i<0?[field,true]:[field.slice(0,i),field.slice(i+1)]})))}
function bytes(root){let total=0;for(const e of readdirSync(root,{withFileTypes:true})){const p=join(root,e.name);if(e.isSymbolicLink())continue;if(e.isDirectory())total+=bytes(p);else total+=lstatSync(p).size}return total}
/** Git for Windows can leave only empty directories and dangling launch junctions.
 * Remove links themselves, never follow their targets; any ordinary file stops recovery. */
export function removeEmptyWorktreeShell(root){
 const plan=[]
 const inspect=directory=>{for(const e of readdirSync(directory,{withFileTypes:true})){const path=join(directory,e.name);if(!within(root,path))throw Error('Leftover path escapes retired checkout');const stat=lstatSync(path);if(stat.isSymbolicLink())plan.push({path,link:true});else if(stat.isDirectory()){inspect(path);plan.push({path,link:false})}else throw Error('Ordinary file remains after Git removal; preserved: '+path)}}
 if(pathKey(realpathSync(root))!==pathKey(root))throw Error('Retired checkout changed identity')
 inspect(root)
 for(const item of plan){const stat=lstatSync(item.path);if(item.link){if(!stat.isSymbolicLink())throw Error('Leftover link changed; preserved');unlinkSync(item.path)}else{if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Leftover directory changed; preserved');rmdirSync(item.path)}}
 rmdirSync(root)
}
export function removeIntegratedWorktree({root,path,ref,head,branch,allowedIgnored=['node_modules/'],beforeRemove=()=>{}}){
 const retained=reason=>({removed:false,reason})
 if(!isAbsolute(root)||!isAbsolute(path)||pathKey(root)===pathKey(path))return retained('The main checkout is never removed')
 if(!existsSync(path))return retained('Workspace missing; reconcile its registration and retained evidence')
 if(pathKey(realpathSync(path))!==pathKey(path))return retained('Workspace resolves through an alias; ownership is uncertain')
 const rows=registeredWorktrees(root),entry=rows.find(r=>pathKey(r.worktree)===pathKey(path))
 if(!entry||entry===rows[0]||entry.locked||entry.prunable)return retained('Worktree is unregistered, primary, locked or prunable')
 if(rows.some(r=>r!==entry&&within(path,r.worktree)))return retained('Nested worktrees are preserved')
 if(head&&entry.HEAD!==head||branch&&entry.branch!=='refs/heads/'+branch)return retained('Worktree head or branch changed')
 if(git(path,['status','--porcelain','--untracked-files=all']))return retained('Uncommitted or untracked work is preserved')
 const ignored=git(path,['ls-files','--others','--ignored','--exclude-standard','--directory','-z']).split('\0').filter(Boolean)
 const unknown=ignored.filter(p=>!allowedIgnored.some(a=>p===a||a.endsWith('/')&&p.startsWith(a)))
 if(unknown.length)return retained('Ignored files need preservation: '+unknown.slice(0,8).join(', '))
 const target=git(root,['rev-parse','--verify',ref+'^{commit}'])
 const merged=spawnSync('git',['-C',root,'merge-base','--is-ancestor',entry.HEAD,target],{windowsHide:true,timeout:30000})
 if(merged.status!==0)return retained('Commits are not integrated into '+ref)
 beforeRemove()
 if(git(path,['rev-parse','HEAD'])!==entry.HEAD||git(path,['status','--porcelain','--untracked-files=all']))return retained('Workspace changed during cleanup')
 const logicalBytes=bytes(path)
 git(root,['worktree','remove',path])
 if(existsSync(path))removeEmptyWorktreeShell(path)
 if(existsSync(path)||registeredWorktrees(root).some(r=>pathKey(r.worktree)===pathKey(path)))throw Error('Worktree removal did not complete')
 return {removed:true,reason:'Integrated checkout removed; branch and history retained',logicalBytes,workerHead:entry.HEAD,projectHead:target,ref}
}
