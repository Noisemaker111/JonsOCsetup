import {readFileSync,realpathSync,statSync} from 'node:fs'
import {basename,dirname,isAbsolute,join,resolve} from 'node:path'
import {homedir} from 'node:os'
import {readAllQuests} from './index'
import {QuestWorkspaces} from './workspaces'
import {assertWorkerIdentity} from './worker-identity'
import {workerSessionID} from './worker-permissions'
import type {QuestStore} from './store'
const same=(a:string,b:string)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b
type SharedInstruction={installed:string;source:string}
const sharedInstructions=():SharedInstruction[]=>{
 const root=process.env.OPENCODE_CONFIG_DIR??resolve(import.meta.dir,'..')
 return [
  {installed:join(homedir(),'.agents','user-verification.md'),source:join(root,'docs','user-verification.md')},
  {installed:join(homedir(),'.agents','matt-pocock.md'),source:join(root,'setup','files','.agents','matt-pocock.md')},
 ]
}
/** Only actual root instruction files, never a directory listing or a symlink escaping that root. */
export function instructionReadPath(path:unknown,directory:string,roots:string[],giverDirectory?:string,shared:SharedInstruction[]=sharedInstructions()):string|undefined {
 if(typeof path!=='string')return
 const target=resolve(directory,path==='~'?homedir():path.startsWith('~/')||path.startsWith('~\\')?join(homedir(),path.slice(2)):path)
 // Installed personal instructions can be links outside the checkout. Match the exact path
 // and trusted bundled contents, never an arbitrary file referenced by repository text.
 for(const entry of shared)if(same(target,resolve(entry.installed)))try{
  if(statSync(target).isFile()&&readFileSync(target).equals(readFileSync(entry.source)))return target
 }catch{}
 if(!['AGENTS.md','MEMORY.md'].includes(basename(target)))return
 try{
  if(!statSync(target).isFile())return
  const physical=realpathSync.native(target)
  for(const root of [...roots,...(basename(target)==='AGENTS.md'&&giverDirectory?[giverDirectory]:[])]){
   if(!isAbsolute(root))continue
   const actual=realpathSync.native(root)
   if(same(dirname(target),resolve(root))&&same(physical,join(actual,basename(target))))return target
  }
 }catch{}
}
/** Scope the external-directory check to the lifetime and identity of one native read. */
export async function installWorkerInstructionReads(ctx:any,store:QuestStore) {
 if(!ctx.permission?.hook||!ctx.tool?.transform)return
 const calls=new Map<string,{path:string;questID:string;runID:string;sessionID:string}>()
 const key=(sessionID:string,source:any)=>JSON.stringify([sessionID,source?.messageID,source?.id])
 await ctx.permission.hook('evaluate',(event:any)=>{
  if(event.effect!=='ask'||event.action!=='external_directory'||event.source?.type!=='tool')return
  const call=calls.get(key(event.sessionID,event.source));if(!call)return
  const quest=store.read(call.questID),run=quest?.sessions.find(run=>run.runID===call.runID)
  if(!run||quest?.state==='Archived'||workerSessionID(run)!==call.sessionID||!['executing','waiting','blocked'].includes(run.state))return
  const resource=join(dirname(call.path),'*').replaceAll('\\','/')
  if(event.resources?.length===1&&same(event.resources[0],resource)){event.effect='allow';event.message='Read-only access to this assigned project instruction file.'}
 })
 await ctx.tool.transform((draft:any)=>{
  draft.update('read',(tool:any)=>{
   const original=tool.execute
   tool.execute=async(input:any,context:any)=>{
    const member=readAllQuests(store.projectRoot,{includeArchived:false}).flatMap(({quest})=>quest?quest.sessions.filter(run=>workerSessionID(run)===context.sessionID).map(run=>({quest,run})):[])[0]
    if(!member?.run.runID||!['executing','waiting','blocked'].includes(member.run.state))return original(input,context)
    const workspace=new QuestWorkspaces(store.runtime).get(member.run.runID)
    if(!workspace||workspace.removed||workspace.sharedReleased)return original(input,context)
    const path=instructionReadPath(input?.path,workspace.path,[workspace.source??workspace.root,workspace.root,workspace.path,member.quest.project?.root].filter((root):root is string=>typeof root==='string'),typeof member.run.scope?.giverInstructionDirectory==='string'?member.run.scope.giverInstructionDirectory:undefined)
    if(!path)return original(input,context)
    new QuestWorkspaces(store.runtime).verify(workspace)
    const actual=await ctx.session.get({sessionID:context.sessionID});assertWorkerIdentity(member.run,actual?.data??actual)
    const id=key(context.sessionID,context)
    calls.set(id,{path,questID:member.quest.id,runID:member.run.runID,sessionID:context.sessionID})
    try{return await original(input,context)}finally{calls.delete(id)}
   }
  })
 })
}
