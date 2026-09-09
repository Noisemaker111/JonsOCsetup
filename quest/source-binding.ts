import { readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { physicalDirectory, projectIdentity, sourceCheckout, verifySourceBinding, type ProjectIdentity } from './project'
import type { QuestStore } from './store'
import { QuestWorkspaces } from './workspaces'

/** A reviewed dispatch-policy binding, never a path supplied by a worker or ledger. */
export function editingSource(context:{project:ProjectIdentity;directory:string},policyFile:string,files?:string[]) {
  verifySourceBinding(context,context.directory)
  try{return {...sourceCheckout(context.directory,context.project),files}}catch(error){if(!(error instanceof Error)||error.message!=='Cannot establish selected Git checkout')throw error}
  const policy=JSON.parse(readFileSync(policyFile,'utf8'))
  const binding=policy.sourceByProject?.[context.project.id]
  if(!binding)return {...sourceCheckout(context.directory,context.project),files}
  if(!isAbsolute(binding.directory)||!isAbsolute(binding.root)||physicalDirectory(binding.projectRoot)!==physicalDirectory(context.project.root))throw Error('Invalid configured source binding')
  const selected=sourceCheckout(binding.directory)
  // Pin both physical paths: retargeting a junction cannot silently choose a different checkout.
  const same=(a:string,b:string)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b
  if(!same(physicalDirectory(binding.directory),resolve(binding.directory))||!same(selected.project.root,resolve(binding.root)))throw Error('Configured source checkout identity changed')
  const status=spawnSync('git',['-C',selected.source,'status','--porcelain','--untracked-files=all'],{encoding:'utf8',windowsHide:true,timeout:15000})
  if(status.status!==0||status.stdout.trim())throw Error('Configured source checkout must be clean; existing work was preserved')
  const prefix=binding.scopePrefix
  if(typeof prefix!=='string'||!prefix||prefix.includes('..')||prefix.includes(String.fromCharCode(92))||prefix.startsWith('/'))throw Error('Invalid configured source scope prefix')
  const translated=(files??[prefix]).map(file=>{
    if(file===prefix)return '.'
    if(!file.startsWith(prefix+'/'))throw Error('Requested scope is outside the configured source binding')
    const path=file.slice(prefix.length+1)
    if(path.split('/').some(part=>part==='..'||!part)||isAbsolute(path)||path.includes(String.fromCharCode(92)))throw Error('Invalid mapped source scope')
    return path
  })
  return {...selected,files:translated}
}

/** Worker membership grants ledger access only at the runtime's verified owned checkout. */
export function workerLedgerProject(store:QuestStore,sessionID:string,directory:string,questID?:string):ProjectIdentity|undefined {
  if(!questID)return
  const quest=store.read(questID),run=quest?.sessions.findLast(row=>(row.sessionID??row.openCodeSessionId)===sessionID)
  if(!run?.runID||quest?.project?.id===projectIdentity(directory).id)return
  const workspaces=new QuestWorkspaces(store.runtime),workspace=workspaces.get(run.runID)
  if(!workspace||workspace.questID!==questID||physicalDirectory(directory)!==physicalDirectory(workspace.path))throw Error('Worker ledger checkout binding changed')
  workspaces.verify(workspace)
  return quest!.project
}
