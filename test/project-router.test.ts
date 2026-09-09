import { expect, test, afterAll } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { emptySelection, verifyTarget, resolveTargets, revalidate } from '../project-router/resolution'
import { DiscoveryHost, runArgv } from '../project-router/host'
import { DestinationRouter } from '../project-router/routing'
import { Onboarding, repositoryURL } from '../project-router/onboarding'
import { appendLedger, readLedger, ledgerLockStatus, recordNotification } from '../orchestration/orchestration-ledger'
import { resolveDispatchSelector,dispatchReservationFile,reserveDispatch } from '../models/dispatch-planner'
import {RouteReservations} from '../models/route-reservations'
import routingFixture from './fixtures/routing-19h.json'
import { acquireLock } from '../quest/locking'
import { createHash } from 'node:crypto'
import {RouterMemory} from '../project-router/memory'
import {compactUsageTool} from '../usage/tool-projection'
import {toolSection} from '../quest/tool-projection'
import {installProjectRouter} from '../project-router/server'
import {QuestStore} from '../quest/store'
import {questsAPI} from '../quest/api'
import {projectIdentity} from '../quest/project'
const root=mkdtempSync(join(tmpdir(),'project-router-'))
afterAll(()=>rmSync(root,{recursive:true,force:true}))
const claim=(key:string)=>acquireLock(root,createHash('sha256').update(key).digest('hex'),{timeoutMs:0})
function dir(name:string){const path=join(root,name);mkdirSync(path,{recursive:true});return path}
test('explicit selectors override pins, ambiguity asks once, multiple targets stay distinct and metadata survives',()=>{
 const a=verifyTarget(dir('a/atlas')),b=verifyTarget(dir('b/atlas')),s=emptySelection();s.pin=b
 expect(resolveTargets(s,[a,b],{selectors:[a.directory]}).targets).toEqual([a])
 expect(resolveTargets(s,[a,b],{selectors:['atlas']}).state).toBe('clarify');s.asked=true
 expect(resolveTargets(s,[a,b],{selectors:['atlas']}).state).toBe('unresolved')
 expect(resolveTargets(s,[a,b],{selectors:[a.directory,b.directory]}).targets).toHaveLength(2)
 expect(resolveTargets(s,[a,b],{discussion:true}).targets).toHaveLength(0)
 expect(revalidate({...a,remote:'example.com/a/atlas',hostID:'host'})).toMatchObject({remote:'example.com/a/atlas',hostID:'host'})
 rmSync(b.directory,{recursive:true});expect(()=>revalidate(b)).toThrow('identity cannot be verified')
})
test('host adapter validates installed envelopes, multiword search, targeted excerpts and HTTP error bodies',async()=>{
 const paths:string[]=[]
 const host=new DiscoveryHost('fixture',async(_,args)=>{const path=args.at(-1)!;paths.push(path);return {code:0,stderr:'',stdout:JSON.stringify(path.includes('/message?')?{data:[{id:'m1',type:'user',content:[{type:'text',text:'hello token=SECRET'}]}],cursor:{next:null}}:path.startsWith('/api/session?')?{data:[{id:'ses_abc',title:'recent',location:{directory:root}}],cursor:{next:'next'}}:[{id:'host',canonical:root,sandboxes:[]}])}})
 expect(await host.projects()).toHaveLength(1)
 expect((await host.sessions({search:'project router'})).items).toHaveLength(1);expect(paths.at(-1)).toContain('project+router')
 expect((await host.messages('ses_abc')).items[0].excerpt).toBe('hello [redacted]')
 const bad=new DiscoveryHost('fixture',async()=>({code:0,stdout:'{"error":"not authorized"}',stderr:''}))
 await expect(bad.projects()).rejects.toThrow('root array')
})
// Check the raw output before serialization: stringify silently drops undefined properties.
function strictJSON(value:unknown):void {
 if(value===null||typeof value==='string'||typeof value==='boolean')return
 if(typeof value==='number'){expect(Number.isFinite(value)).toBe(true);return}
 expect(typeof value).toBe('object')
 for(const item of Object.values(value as object))strictJSON(item)
}
test('discovery raw tool outputs omit absent identifiers and preserve root/child and cursor semantics',async()=>{
 const ledger=dir('discovery-ledger'),remembered=verifyTarget(dir('remembered')),questOnly=dir('quest-only'),hostRoot=dir('host-root'),old=process.env.OPENCODE_QUEST_ROOT
 process.env.OPENCODE_QUEST_ROOT=ledger
 let dispose:(()=>void)|undefined
 try{
  questsAPI(new QuestStore(ledger),{project:projectIdentity(questOnly),sessionID:'ses_fixture',requestID:'seed'},async()=>{throw new Error('No launch')}).create({title:'Discovery seed',description:'Metadata only',steps:[{title:'Pending'}]})
  const data=new Map<string,any>([['known',[remembered]]]),tools=new Map<string,any>()
  const storage={get:async(k:string)=>structuredClone(data.get(k)),set:async(k:string,v:any)=>{strictJSON(v);data.set(k,structuredClone(v))}}
  const host=new DiscoveryHost('fixture',async(_,args)=>({code:0,stderr:'',stdout:JSON.stringify(args.at(-1)!.startsWith('/api/session?')?{data:[{id:'ses_root',location:{directory:hostRoot}},{id:'ses_null',parentID:null,location:{directory:hostRoot}},{id:'ses_child',parentID:'ses_root',location:{directory:hostRoot}}],cursor:{next:'cursor-next'}}:[{id:'host-id',canonical:hostRoot,sandboxes:[]}])}))
  const page=await host.sessions();strictJSON(page);expect(page.items[0]).not.toHaveProperty('parentID');expect(page.items[1]).not.toHaveProperty('parentID');expect(page.items[2].parentID).toBe('ses_root');expect(page.next).toBe('cursor-next')
  dispose=await installProjectRouter({storage,tool:{transform:async(fn:any)=>fn({add:(tool:any)=>tools.set(tool.name,tool)})},session:{get:async()=>({location:{directory:ledger}}),create:async()=>{throw new Error('No launch')},prompt:async()=>{throw new Error('No prompt')}}},host)
  const discover=async(input:any)=>{const result=await tools.get('project_discover').execute(input,{sessionID:'ses_hub',id:'discovery'});strictJSON(result.output);expect(JSON.parse(result.content)).toEqual(result.output);return result.output}
  const sessions=await discover({source:'sessions'});expect(sessions.items.map((s:any)=>s.id)).toEqual(['ses_root','ses_null']);expect(sessions.next).toBe('cursor-next')
  const projects=await discover({source:'projects',limit:30});expect(projects.items).toHaveLength(3)
  expect(projects.items.find((t:any)=>t.directory===remembered.directory)).not.toHaveProperty('hostID')
  expect(projects.items.find((t:any)=>t.directory===verifyTarget(questOnly).directory)).not.toHaveProperty('hostID')
  expect(projects.items.find((t:any)=>t.directory===verifyTarget(hostRoot).directory).hostID).toBe('host-id');expect(projects.nextOffset).toBeNull()
  const first=await discover({source:'projects',limit:1});expect(first.items).toHaveLength(1);expect(first.nextOffset).toBe(1)
  const invalid=new DiscoveryHost('fixture',async()=>({code:0,stderr:'',stdout:JSON.stringify({data:[{id:'ses_bad',parentID:42,location:{directory:ledger}}],cursor:{next:null}})}))
  await expect(invalid.sessions()).rejects.toThrow('optional string parent IDs')
 }finally{dispose?.();if(old===undefined)delete process.env.OPENCODE_QUEST_ROOT;else process.env.OPENCODE_QUEST_ROOT=old}
})
test('large telemetry is compact by default and targeted Quest evidence roundtrips through bounded pages',()=>{
 const snapshot={accounts:[],telemetry:{requests:1000,requestHistory:Array.from({length:1000},()=>({text:'x'.repeat(1000)})),timeline:{points:Array(1000).fill({large:'x'.repeat(1000)})}}}
 expect(JSON.stringify(compactUsageTool(snapshot)).length).toBeLessThan(1000)
 const evidence={log:'line\n'.repeat(10000)};let offset=0,joined=''
 for(;;){const page=toolSection(evidence,'artifacts',offset,1000);expect(page.text.length).toBeLessThanOrEqual(1000);joined+=page.text;if(page.nextOffset===null)break;offset=page.nextOffset}
 expect(JSON.parse(joined)).toEqual(evidence)
})
test('destination binding preserves source model and prevents competing-instance duplicate prompts',async()=>{
 const target=verifyTarget(dir('route')),data=new Map(),storage={get:async(k:string)=>data.get(k),set:async(k:string,v:any)=>{data.set(k,structuredClone(v))}}
 let creates=0,prompts=0,release:()=>void=()=>{};const wait=new Promise<void>(r=>release=r)
 const model={providerID:'openai',id:'gpt-6-astra',variant:'medium'}
 const host={create:async(i:any)=>{creates++;expect(i.model).toEqual(model);await wait;return {id:'ses_destination'}},get:async()=>({agent:'astra',model,location:{directory:target.directory}}),prompt:async()=>{prompts++}}
 const a=new DestinationRouter(storage,host,()=>false,async()=>1,claim),b=new DestinationRouter(storage,host,()=>false,async()=>1,claim)
 const input={hubSessionID:'ses_hub',requestKey:'one',text:'fix it',target,revision:1}
 const pending=a.route(input);await new Promise(r=>setTimeout(r,20))
 await expect(b.route(input)).rejects.toThrow('Another process owns');release();expect((await pending).state).toBe('delivered')
 expect((await b.route(input)).state).toBe('delivered');expect(creates).toBe(1);expect(prompts).toBe(1)
 expect((await b.route({...input,requestKey:'followup',text:'Now fix the failing check'})).destinationSessionID).toBe('ses_destination');expect(creates).toBe(1);expect(prompts).toBe(2)
})
test('persistent aliases and merged metadata survive fresh hubs; concurrent memory mutations do not reuse revisions',async()=>{
 const data=new Map(),storage={get:async(k:string)=>structuredClone(data.get(k)),set:async(k:string,v:any)=>{data.set(k,structuredClone(v))}},a=new RouterMemory(storage,claim),b=new RouterMemory(storage,claim),target={...verifyTarget(dir('memory-project')),remote:'example.invalid/o/repo',hostID:'host'}
 await a.register([target]);await b.register([{...target,remote:undefined,hostID:undefined}]);await a.alias('frontend',target)
 expect((await b.known())[0]).toMatchObject({remote:target.remote,hostID:'host'});expect(resolveTargets(await b.selection('fresh-hub'),await b.known(),{selectors:['frontend']}).targets[0].id).toBe(target.id)
 expect(resolveTargets(await b.selection('fresh-hub'),await b.known(),{selectors:['https://example.invalid/o/repo.git']}).targets[0].id).toBe(target.id)
 let release=()=>{};const wait=new Promise<void>(r=>release=r)
 const first=a.selectionChange('hub',async()=>{const s=await a.selection('hub');await wait;s.revision++;await storage.set('selection/hub',s)})
 await expect(b.selectionChange('hub',async()=>{})).rejects.toThrow('Another process');release();await first
 await b.selectionChange('hub',async()=>{const s=await b.selection('hub');s.revision++;await storage.set('selection/hub',s)});expect((await a.selection('hub')).revision).toBe(2)
 const results=await Promise.allSettled([a.register([verifyTarget(dir('memory-two'))]),b.register([verifyTarget(dir('memory-three'))])]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1)
 await b.register([verifyTarget(dir('memory-three'))]);expect((await a.known()).length).toBeGreaterThanOrEqual(2)
 await a.alias('frontend');expect((await b.selection('newer-hub')).aliases.frontend).toBeUndefined()
})
test('correction during create prevents prompt; unknown prompt never retries',async()=>{
 const target=verifyTarget(dir('correct')),data=new Map(),storage={get:async(k:string)=>data.get(k),set:async(k:string,v:any)=>{data.set(k,structuredClone(v))}};let revision=1,prompts=0
 const model={providerID:'openai',id:'gpt-6-astra',variant:'medium'},host={get:async()=>({agent:'astra',model,location:{directory:target.directory}}),create:async()=>{revision=2;return {id:'ses_dest'}},prompt:async()=>{prompts++;throw new Error('lost response')}}
 const router=new DestinationRouter(storage,host,()=>false,async()=>revision,claim)
 expect((await router.route({hubSessionID:'ses_hub2',requestKey:'correction',text:'fix',target,revision:1})).state).toBe('cancelled');expect(prompts).toBe(0)
 host.create=async()=>({id:'ses_dest'});const input={hubSessionID:'ses_hub2',requestKey:'unknown',text:'fix',target,revision:2}
 expect((await router.route(input)).state).toBe('unknown');expect((await router.route(input)).state).toBe('unknown');expect(prompts).toBe(1)
})
test('unknown/live orchestration locks preserve durable pending events promptly and idempotent completion',()=>{
 const file=join(dir('ledger'),'journal');mkdirSync(file+'.lock');const start=Date.now()
 expect(ledgerLockStatus(file).state).toBe('unknown-owner');expect(appendLedger({kind:'terminal',parentID:'p',callID:'c',childID:'s',state:'completed'},file).state).toBe('pending')
 expect(Date.now()-start).toBeLessThan(500);expect(readLedger(file)).toHaveLength(1);expect(existsSync(file+'.lock')).toBe(true)
 writeFileSync(join(file+'.lock','owner.json'),JSON.stringify({pid:process.pid}));expect(ledgerLockStatus(file).state).toBe('live-owner')
 expect(appendLedger({kind:'spawn',parentID:'p',callID:'other'},file).state).toBe('pending');expect(readLedger(file)).toHaveLength(2)
 rmSync(file+'.lock',{recursive:true});recordNotification('p','c','s','completed','result',file);recordNotification('p','c','s','completed','result',file)
 expect(readLedger(file).filter(e=>e.kind==='notification')).toHaveLength(1)
})
test('concurrent real processes preserve all accepted ledger writes',async()=>{
 const file=join(dir('concurrent'),'journal'),module=join(import.meta.dir,'../orchestration/orchestration-ledger.ts').replaceAll('\\','/')
 const results=await Promise.all(Array.from({length:4},(_,i)=>runArgv(process.execPath,['-e',`import {appendLedger} from ${JSON.stringify(module)};for(let n=0;n<15;n++)appendLedger({kind:'spawn',parentID:'p',callID:'${i}-'+n},${JSON.stringify(file)})`],{timeout:30000})))
 expect(results.map(r=>r.code)).toEqual([0,0,0,0]);expect(new Set(readLedger(file).map(r=>r.callID)).size).toBe(60)
})
test('exact route feedback agrees on unavailable/missing reasoning/ambiguous account and executable route selector',()=>{
 const route={id:'a',providerID:'openai',modelID:'gpt-6-astra',reasoning:'medium',accountID:'one',serviceTier:'default'},policy:any={routes:[route,{...route,id:'b',accountID:'two'}],request:{allowedRouteIDs:['a','b']}}
 expect(resolveDispatchSelector(policy,'openai/spark').code).toBe('AUTHORIZED_ROUTE_UNAVAILABLE')
 expect(resolveDispatchSelector(policy,'openai/gpt-6-astra').code).toBe('REASONING_REQUIRED')
 expect(resolveDispatchSelector(policy,'openai/gpt-6-astra#medium#high').code).toBe('INVALID_ROUTE_SELECTOR')
 expect(resolveDispatchSelector(policy,'openai/gpt-6-astra#medium').code).toBe('AMBIGUOUS_ACCOUNT_SERVICE_ROUTE')
 expect(resolveDispatchSelector(policy,'route:b').route?.accountID).toBe('two')
})
test('exact selector accepts one coalesced account but rejects ambiguous transport and missing account',async()=>{
 const input=structuredClone(routingFixture) as any,route=input.routes[0],account=input.accounts.find((a:any)=>a.id===route.accountID),folder=dir('exact-account'),policyFile=join(folder,'policy.json')
 input.request.allowedRouteIDs=[route.id];input.request.reserveFraction=0
 writeFileSync(policyFile,JSON.stringify({version:1,request:input.request,routes:[route],billing:{[account.id]:'subscription'}}))
 const selected={id:account.id,state:'available',observedAt:account.observedAt,connections:[{routeProviders:[route.providerID],modelPrefix:null}],plan:{name:'fixture'},windows:account.windows.map((w:any)=>({id:w.id,scope:'shared',state:'available',remainingPercent:w.remaining,resetAt:w.resetAt}))}
 selected.connections.push(structuredClone(selected.connections[0]))
 const snapshot:any={accounts:[selected]}
 const run=(runID:string)=>reserveDispatch({runID,model:'route:'+route.id,policyFile,reservationFile:join(folder,runID+'.json'),now:Date.parse(input.request.now)},async()=>snapshot)
 expect((await run('selected')).route.accountID).toBe(account.id)
 snapshot.accounts.push({...structuredClone(selected),id:'another-account'});await expect(run('ambiguous')).rejects.toThrow('unverified')
 snapshot.accounts.shift();await expect(run('missing')).rejects.toThrow('unverified')
})
test('isolated Quest roots can share one atomic account admission without changing concurrency policy',()=>{
 const prior=process.env.OPENCODE_ROUTE_RESERVATIONS,pin=join(dir('shared-admission'),'reservations.json')
  try{process.env.OPENCODE_ROUTE_RESERVATIONS=pin;const a=new RouteReservations(dispatchReservationFile(dir('store-a'))),b=new RouteReservations(dispatchReservationFile(dir('store-b'))),input=structuredClone(routingFixture) as any,route=input.routes[0];route.admission='configured-choice';route.quotaPerTask={};input.request.allowedRouteIDs=[route.id];input.request.explicitRouteID=route.id;input.request.reserveFraction=0
 expect(a.reserve('one',input).reservation).not.toBeNull();expect(b.reserve('two',input).reservation).toBeNull();expect(a.get('one')?.state).toBe('active')
 }finally{if(prior===undefined)delete process.env.OPENCODE_ROUTE_RESERVATIONS;else process.env.OPENCODE_ROUTE_RESERVATIONS=prior}
})
test('real isolated local Git clone materializes once and preserves collisions',async()=>{
 const source=dir('git-source'),parent=dir('projects')
 const git=async(args:string[])=>{const r=await runArgv('git',args,{timeout:10000});if(r.code!==0)throw new Error(r.stderr);return r}
 await git(['init',source]);writeFileSync(join(source,'AGENTS.md'),'Fixture instructions\n');writeFileSync(join(source,'file.txt'),'content\n');await git(['-C',source,'add','AGENTS.md','file.txt']);await git(['-C',source,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','fixture'])
 const transport:typeof runArgv=async(executable,args,options)=>{
  const mapped=args.map(x=>x==='protocol.file.allow=never'?'protocol.file.allow=always':x==='https://example.invalid/owner/repo.git'?source:x)
  const result=await runArgv(executable,mapped,options)
  if(args.includes('clone')&&result.code===0)await git(['-C',args.at(-1)!,'remote','set-url','origin','https://example.invalid/owner/repo.git'])
  return result
 }
 const onboarding=new Onboarding(parent,transport),input={url:'https://example.invalid/owner/repo',authorized:true,requestID:'clone',known:[]}
 const first=await onboarding.clone(input);expect(first.state).toBe('verified');expect(readFileSync(join(first.target!.directory,'file.txt'),'utf8')).toBe('content\n')
 expect((await onboarding.clone({...input,retry:true})).state).toBe('verified')
 await expect(onboarding.clone({...input,requestID:'other',url:'https://example.invalid/other/repo'})).rejects.toThrow('already exists')
 expect(()=>repositoryURL('https://secret@example.invalid/owner/repo')).toThrow('Credential')
 expect(()=>repositoryURL('file:///repo')).toThrow();expect(repositoryURL('git@example.invalid:owner/repo.git').identity).toBe('example.invalid/owner/repo')
})
test('clone failures/cancellation preserve explicit attempts without automatic retry or credential diagnostics',async()=>{
 let calls=0
 const auth=new Onboarding(dir('auth-failure'),async()=>{calls++;return {code:128,stdout:'',stderr:'fatal: Authentication failed password=NEVER_RETURN'}})
 const input={url:'https://example.invalid/o/repo',authorized:true,requestID:'auth',known:[]}
 const failed=await auth.clone(input);expect(failed.state).toBe('auth-required');expect(JSON.stringify(failed)).not.toContain('NEVER_RETURN')
 expect((await auth.clone({...input,retry:true})).state).toBe('auth-required');expect(calls).toBe(1)
 const signal=new AbortController();signal.abort()
 const cancelled=new Onboarding(dir('cancelled'),async(exe,args,options)=>runArgv(exe,args.map(x=>x==='https://example.invalid/o/repo.git'?join(root,'nonexistent-source'):x),options))
 expect((await cancelled.clone({...input,requestID:'cancel',signal:signal.signal})).state).toBe('cancelled')
 const missing=new Onboarding(dir('missing-source'),async(exe,args,options)=>runArgv(exe,args.map(x=>x==='protocol.file.allow=never'?'protocol.file.allow=always':x==='https://example.invalid/o/repo.git'?join(root,'nonexistent-source'):x),options))
 expect((await missing.clone({...input,requestID:'missing'})).state).toBe('failed')
})
