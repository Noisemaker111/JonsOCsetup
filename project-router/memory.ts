import {basename} from 'node:path'
import { claimRouterRequest } from '../quest/router-public'
import {giverProjectSelection,selectGiverProject} from '../quest/giver-public'
import { emptySelection, targetKey, type Selection, type Target } from './resolution'
import { RouterError } from './host'
export type Storage={get(key:string):Promise<any>;set(key:string,value:any):Promise<void>}
export class RouterMemory {
 constructor(readonly storage:Storage,readonly claim=claimRouterRequest){}
 private async locked<T>(key:string,action:()=>Promise<T>){let lock:ReturnType<typeof claimRouterRequest>;try{lock=this.claim('memory:'+key)}catch{throw new RouterError('MEMORY_BUSY','Another process is updating project memory; retry this prelaunch operation after it completes')}try{return await action()}finally{lock.release()}}
 async selection(id:string):Promise<Selection>{
  const saved=giverProjectSelection(id),aliases=await this.storage.get('aliases')??{}
  if(!saved.current)return {...emptySelection(),aliases}
  const current=saved.selection
  // Import only once. Once the giver record has v2, plugin storage is never a selection owner.
  const legacy=current?.version===2?undefined:await this.storage.get('selection/'+id)
  const compatible=legacy&&(!current||legacy.revision===current.revision)?legacy:undefined
  const source=current??compatible
  const state:Selection={revision:source?.revision??0,targets:(source?.targets??[]).map((t:any)=>{const {project,...target}=t;return {...target,id:project?.id??t.id,root:project?.root??t.root,name:t.name??basename(t.directory)}}),aliases,asked:source?.asked??compatible?.asked??false,...(source?.pending?{pending:source.pending}:{})}
  const pin=current?.version===2?current.pin:compatible?.pin?.directory
  if(pin)state.pin=state.targets.find(t=>targetKey(t)===targetKey({directory:pin} as Target))
  if(source&&current?.version!==2)this.saveSelection(id,state,current?.revision??0)
  return state
 }
 isCurrent(id:string){return giverProjectSelection(id).current}
 saveSelection(id:string,selection:Selection,expectedRevision?:number){return selectGiverProject(id,selection.targets,selection.revision,{pin:selection.pin?.directory,asked:selection.asked,pending:selection.pending,expectedRevision})}
 selectionChange<T>(id:string,action:()=>Promise<T>){return this.locked('selection:'+id,action)}
 async register(targets:Target[]){return this.locked('registry',async()=>{const rows=[...await this.known(),...targets],merged=new Map<string,Target>();for(const row of rows)merged.set(targetKey(row),{...merged.get(targetKey(row)),...Object.fromEntries(Object.entries(row).filter(([,v])=>v!==undefined))} as Target);await this.storage.set('known',[...merged.values()].slice(-500))})}
 async known():Promise<Target[]>{return await this.storage.get('known')??[]}
 async alias(name:string,target?:Target){return this.locked('registry',async()=>{const aliases=await this.storage.get('aliases')??{};if(target)aliases[name.toLowerCase()]=target;else delete aliases[name.toLowerCase()];await this.storage.set('aliases',aliases)})}
}
