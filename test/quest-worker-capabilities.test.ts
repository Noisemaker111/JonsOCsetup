import {test,expect} from 'bun:test'
import {mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {QuestStore} from '../quest/store'
import {installWorkerCapabilities} from '../quest/worker-capabilities'
test('missing worker execution capability fails before inference; observations retain names only',async()=>{
 const root=mkdtempSync(join(tmpdir(),'worker-capabilities-')),store=new QuestStore(root),hooks=new Map<string,any>(),runID='a12345678901234567890123456'
 try{const q=store.create({id:'01j00000000000000000000880',title:'Capabilities',objective:'Check',stages:[]});store.apply(q.id,'session-planned',{callID:runID,runID,role:'worker'},'test');store.apply(q.id,'session-claimed',{callID:runID,runID,sessionID:'ses_worker',scope:{readOnly:true}},'test');await installWorkerCapabilities({session:{hook:async(name:string,fn:any)=>hooks.set(name,fn)}},store);expect(()=>hooks.get('context')({sessionID:'ses_worker',tools:{read:{}}})).toThrow('neither Code Mode execute nor quest');const event={sessionID:'ses_worker',tools:{read:{},execute:{description:'Native Code Mode'},question:{},shell:{},patch:{}}};hooks.get('context')(event);expect(Object.keys(event.tools)).toEqual(['read','execute']);expect(event.tools.execute.description).toContain('inside execute');await hooks.get('http.request')({sessionID:'ses_worker',request:new Request('http://localhost',{method:'POST',headers:{authorization:'SECRET'},body:JSON.stringify({input:'PRIVATE',tools:[{type:'function',name:'execute'},{type:'function',function:{name:'read'}}]})})});const saved=readFileSync(join(store.runtime,'worker-capabilities',runID+'.json'),'utf8');expect(JSON.parse(saved).outboundTools).toEqual(['execute','read']);expect(saved).not.toMatch(/SECRET|PRIVATE|authorization/)}finally{rmSync(root,{recursive:true,force:true})}
})
