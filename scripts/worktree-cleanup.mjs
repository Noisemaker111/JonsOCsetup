/** Explicit task finish + event-driven retries. Branches, unknown work and sessions survive. */
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,readdirSync,realpathSync} from 'node:fs'
import {join,resolve,dirname} from 'node:path'
import {createHash} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import {git,integrationRef,removeIntegratedWorktree,registeredWorktrees,within,pathKey} from '../quest/cleanup-git.mjs'
const read=p=>JSON.parse(readFileSync(p,'utf8'))
const atomic=(p,v)=>{mkdirSync(dirname(p),{recursive:true});const t=p+'.'+process.pid+'.tmp';writeFileSync(t,JSON.stringify(v,null,2)+'\n');renameSync(t,p)}
function receiptRoot(root){return join(resolve(root,git(root,['rev-parse','--git-common-dir'])),'worktree-retirement')}
export function finishWorktree(root,path,ref){
 root=realpathSync(root);path=realpathSync(path)
 if(!within(join(root,'.worktrees'),path)||within(path,process.cwd())||pathKey(path)===pathKey(process.cwd()))throw Error('Finish from outside a task checkout inside the repository .worktrees directory')
 const entry=registeredWorktrees(root).find(r=>pathKey(r.worktree)===pathKey(path))
 if(!entry?.branch)throw Error('A registered task branch is required')
 const receipt={version:1,root,path,ref:ref??integrationRef(root),head:entry.HEAD,branch:entry.branch.slice(11),requestedAt:new Date().toISOString(),ownerFinished:true}
 const file=join(receiptRoot(root),createHash('sha256').update(pathKey(path)).digest('hex')+'.json')
 atomic(file,receipt);return retryFinishedWorktrees(root)
}
export function retryFinishedWorktrees(root){
 const dir=receiptRoot(root);if(!existsSync(dir))return []
 const results=[]
 for(const file of readdirSync(dir).filter(f=>f.endsWith('.json'))){
  const target=join(dir,file),receipt=read(target);if(receipt.result?.removed)continue
  if(receipt.version!==1||receipt.ownerFinished!==true||pathKey(receipt.root)!==pathKey(root)||!within(join(root,'.worktrees'),receipt.path))throw Error('Invalid task retirement receipt')
  let result
  try{result=removeIntegratedWorktree(receipt)}catch(error){result={removed:false,reason:String(error)}}
  atomic(target,{...receipt,result,checkedAt:new Date().toISOString()});results.push({path:receipt.path,...result})
 }
 return results
}
if(process.argv[1]&&pathKey(process.argv[1])===pathKey(fileURLToPath(import.meta.url))){
 const [action,...args]=process.argv.slice(2),opt=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1]}
 if(action==='--help'||!action)console.log('worktree-cleanup finish --repo <main checkout> --worktree <finished task> [--ref <integration ref>]; retry --repo <main checkout>. Finish asserts the task owner and its child processes have stopped; run outside that checkout. Dirty files, ignored files except node_modules, nested trees and unmerged commits are retained. No branch deletion.')
 else{const root=resolve(opt('--repo')??'.');console.log(JSON.stringify(action==='finish'?finishWorktree(root,resolve(opt('--worktree')??'.'),opt('--ref')):action==='retry'?retryFinishedWorktrees(root):(()=>{throw Error('Use finish or retry')})(),null,2))}
}
