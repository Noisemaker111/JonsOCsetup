import {test,expect} from 'bun:test'
import {RouteReturns} from '../project-router/returns'
const model={providerID:'fixture',id:'model',variant:'medium'}
function fixture(){
 const data=new Map<string,any>(),prompts:any[]=[],locks=new Set<string>();let now=0
 const storage={get:async(k:string)=>structuredClone(data.get(k)),set:async(k:string,v:any)=>{data.set(k,structuredClone(v))}}
 const claim=(k:string)=>{if(locks.has(k))throw Error('busy');locks.add(k);return {release(){locks.delete(k)}} as any}
 const host={get:async()=>({agent:'general',model}),create:async()=>({}),prompt:async(x:any)=>{prompts.push(x)}}
 const service=new RouteReturns(storage,host,async()=>({items:[{excerpt:'quest run: Cannot establish selected Git checkout. No worker started.'}]}),claim,()=>now)
 const receipt:any={key:'route/one',hubSessionID:'hub',destinationSessionID:'dest',target:{name:'hub project'},state:'bound'}
 return {data,storage,host,service,receipt,prompts,claim,advance(){now+=120001}}
}
test('failed launch report wakes origin once without another user message',async()=>{
 const f=fixture();await f.service.watch(f.receipt,{agent:'general',model});await f.service.event('dest','terminal','succeeded');await f.service.event('dest','terminal','succeeded')
 expect(f.prompts).toHaveLength(1);expect(f.prompts[0].sessionID).toBe('hub');expect(f.prompts[0].text).toContain('Cannot establish selected Git checkout');expect(f.prompts[0].metadata.projectRouterReturn).toBe(true)
 expect((await f.service.status('hub')).watches[0].notification).toBe('accepted')
})
test('silence timeout survives reload and does not relaunch destination',async()=>{
 const f=fixture();await f.service.watch(f.receipt,{agent:'general',model});await f.service.tick();expect(f.prompts).toHaveLength(0);f.advance();await f.service.tick();await f.service.tick();expect(f.prompts).toHaveLength(1);expect(f.prompts[0].text).toContain('unconfirmed')
 const restarted=new RouteReturns(f.storage,f.host,async()=>({}),f.claim,()=>999999);await restarted.tick();expect(f.prompts).toHaveLength(1)
})
test('unknown wakeup admission never duplicates and remains inspectable',async()=>{
 const f=fixture();f.host.prompt=async(x:any)=>{f.prompts.push(x);throw Error('connection lost')};await f.service.watch(f.receipt,{agent:'general',model});await f.service.event('dest','event','failed');await f.service.event('dest','event','failed');expect(f.prompts).toHaveLength(1);expect((await f.service.status('hub')).watches[0].notification).toBe('unknown')
})
test('amendment keeps one return address; worker evidence is forwarded',async()=>{
 const f=fixture();await f.service.watch(f.receipt,{agent:'general',model});await f.service.watch({...f.receipt,key:'route/two'},{agent:'general',model});await f.service.event('dest','worker-event','succeeded',{quest:'Tiny change',state:'completed'});expect(f.prompts).toHaveLength(1);expect(f.prompts[0].text).toContain('Tiny change')
})
test('changed originating model leaves pending evidence without substitution',async()=>{
 const f=fixture();await f.service.watch(f.receipt,{agent:'general',model});f.host.get=async()=>({agent:'general',model:{...model,id:'different'}});await f.service.event('dest','event','failed');expect(f.prompts).toHaveLength(0);expect((await f.service.status('hub')).watches[0].notification).toBe('pending')
})