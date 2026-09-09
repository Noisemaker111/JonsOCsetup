import {createHash} from 'node:crypto'
import {test,expect,setDefaultTimeout} from 'bun:test'
setDefaultTimeout(30000)
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'
import {QuestStore} from '../quest/store'
import {codexHook} from '../quest/codex/runtime'
import {questMCP} from '../quest/mcp-server'
import {coordination} from '../quest/coordination'
function fixture(){const root=mkdtempSync(join(tmpdir(),'quest-codex-')),repo=join(root,'repo');mkdirSync(repo);const git=(...a:string[])=>{const r=spawnSync('git',['-C',repo,...a],{encoding:'utf8',windowsHide:true});if(r.status)throw Error(r.stderr)};git('init');writeFileSync(join(repo,'a.txt'),'before');git('add','a.txt');git('commit','-m','fixture');return {root,repo,store:new QuestStore(root)}}
function hook(f:ReturnType<typeof fixture>,event:string,extra:any={}){return codexHook({session_id:'test-session',cwd:f.repo,hook_event_name:event,...extra},f.store)}
test('host context, concise mutation, durable reload and explicit diagnostics',async()=>{const f=fixture(),dispatch=questMCP({store:f.store});hook(f,'SessionStart');let n=0;const call=async(args:any)=>{const id=String(++n),pre=hook(f,'PreToolUse',{tool_name:'mcp__quest__quest',tool_input:args,tool_use_id:id});const response=await dispatch({jsonrpc:'2.0',id,method:'tools/call',params:{name:'quest',arguments:pre.hookSpecificOutput.updatedInput}});hook(f,'PostToolUse',{tool_name:'mcp__quest__quest',tool_use_id:id,tool_response:response.result});return response.result};const created=await call({action:'create',create:{title:'Natural Quest',description:'Task',steps:[{id:'implement',title:'Implement'},{id:'verify',title:'Verify'},{id:'integrate',title:'Integrate'}]}});const q=JSON.parse(created.content[0].text);expect(created.structuredContent).toBeUndefined();expect(q.title).toBe('Natural Quest');expect(q.id).toMatch(/^[a-f0-9]{26}$/);expect(await call({action:'update',id:q.id,update:{steps:[{id:'implement',state:'done',note:'Changed file'}]}})).toEqual({content:[{type:'text',text:'{"ok":true}'}]});expect(new QuestStore(f.root).read(q.id)?.stages[0].status).toBe('done');expect((await call({action:'inspect',id:q.id})).content[0].text).toContain('ownership');hook(f,'SessionEnd');expect(coordination(f.store,{directory:f.repo,sessionID:'other',host:'codex'})({action:'join',title:'Next',scopes:['.']}).acquired).toBe(true)})
test('unsupported conflict tools and neither Stop nor elapsed time releases ownership',()=>{const f=fixture();coordination(f.store,{directory:f.repo,sessionID:'owner',host:'opencode'})({action:'join',title:'Other implementation',scopes:['.']});const deny=hook(f,'PreToolUse',{tool_name:'mcp__unbound__write',tool_use_id:'b',tool_input:{command:'edit'}});expect(deny.hookSpecificOutput.permissionDecision).toBe('deny');expect(deny.hookSpecificOutput.permissionDecisionReason).toContain('existing owner remains protected');hook(f,'Stop');expect(coordination(f.store,{directory:f.repo,sessionID:'later',host:'codex'},Date.now()+1e9)({action:'join',title:'Later',scopes:['.']}).acquired).toBe(false)})
test('missing or replayed host context fails closed',async()=>{const f=fixture(),dispatch=questMCP({store:f.store});const args={action:'list'};expect((await dispatch({id:1,method:'tools/call',params:{name:'quest',arguments:args}})).result.isError).toBe(true);const pre=hook(f,'PreToolUse',{tool_name:'mcp__quest__quest',tool_input:args,tool_use_id:'q'});const message={id:2,method:'tools/call',params:{name:'quest',arguments:pre.hookSpecificOutput.updatedInput}};expect((await dispatch(message)).result.isError).toBeUndefined();expect((await dispatch(message)).result.isError).toBe(true)})
test('uncertain background command retains checkout after session end',()=>{const f=fixture();hook(f,'PreToolUse',{tool_name:'Bash',tool_use_id:'background',tool_input:{command:'test'}});hook(f,'PostToolUse',{tool_name:'Bash',tool_use_id:'background',tool_response:{session_id:123}});hook(f,'SessionEnd');expect(coordination(f.store,{directory:f.repo,sessionID:'next',host:'codex'})({action:'join',title:'Next',scopes:['.']}).acquired).toBe(false)})

test('discovery exposes no coordination chores and rejects unsupported fields',async()=>{const f=fixture(),dispatch=questMCP({store:f.store});const list=await dispatch({id:1,method:'tools/list'});expect(list.result.tools.map((x:any)=>x.name)).toEqual(['quest']);expect(JSON.stringify(list.result.tools)).not.toContain('_questTicket');const response=await dispatch({id:2,method:'tools/call',params:{name:'quest',arguments:{action:'list',directory:f.repo}}});expect(response.result.isError).toBe(true);expect(response.result.content[0].text).toContain('INVALID_INPUT')})

test('non-Git sessions can save real Quests without claiming an implementation patch',async()=>{const root=mkdtempSync(join(tmpdir(),'quest-codex-nongit-')),store=new QuestStore(root),input={action:'create',create:{title:'Plain directory task',description:'Record the task',steps:[{title:'Work'}]}};const pre=codexHook({session_id:'plain',cwd:root,hook_event_name:'PreToolUse',tool_name:'mcp__quest__quest',tool_use_id:'one',tool_input:input},store);const reply=await questMCP({store})({id:1,method:'tools/call',params:{name:'quest',arguments:pre.hookSpecificOutput.updatedInput}});expect(reply.result.isError).toBeUndefined();const value=JSON.parse(reply.result.content[0].text);expect(store.read(value.id)?.title).toBe('Plain directory task');expect(store.read(value.id)?.evidence.artifacts).toEqual([])})

test('session end reconciles a uniquely correlated launch failure and terminal MCP failure',()=>{
 for(const failure of ['CreateProcessWithLogonW failed: 267','The directory name is invalid. (os error 267)']){
 const f=fixture(),transcript=join(f.root,'transcript.jsonl'),rows:any[]=[{type:'session_meta',payload:{id:'test-session'}},{type:'response_item',payload:{type:'custom_tool_call',call_id:'outer'}}]
 const flush=()=>writeFileSync(transcript,rows.map(r=>JSON.stringify(r).replace('CreateProcessWithLogonW failed: 267',failure)).join('\n'))
 flush();hook(f,'SessionStart',{transcript_path:transcript});hook(f,'PreToolUse',{tool_name:'Bash',tool_use_id:'launch'})
 rows.push({type:'response_item',payload:{type:'custom_tool_call_output',call_id:'outer',output:[{type:'input_text',text:'Script failed\nWall time 1 seconds\nOutput:\n'},{type:'input_text',text:'Earlier printed discovery output\nScript error:\nexec_command failed: CreateProcess { message: "Rejected(\\"Failed to create unified exec process: CreateProcessWithLogonW failed: 267\\")" }'}]}});flush()
 hook(f,'PreToolUse',{tool_name:'mcp__node_repl__js',tool_use_id:'mcp'})
 rows.push({type:'event_msg',payload:{type:'item_completed',item:{id:'mcp',type:'McpToolCall',status:'failed'}}});flush()
 hook(f,'SessionEnd');expect(coordination(f.store,{directory:f.repo,sessionID:'next',host:'codex'})({action:'join',title:'Next',scopes:['.']}).acquired).toBe(true)
 }
})
test('ambiguous launches and running calls cannot be released by an outer error',()=>{
 const f=fixture(),transcript=join(f.root,'transcript.jsonl'),rows:any[]=[{type:'session_meta',payload:{id:'test-session'}},{type:'response_item',payload:{type:'custom_tool_call',call_id:'outer'}}]
 const flush=()=>writeFileSync(transcript,rows.map(r=>JSON.stringify(r)).join('\n'));flush();hook(f,'SessionStart',{transcript_path:transcript})
 hook(f,'PreToolUse',{tool_name:'Bash',tool_use_id:'one'});hook(f,'PreToolUse',{tool_name:'Bash',tool_use_id:'two'});hook(f,'PostToolUse',{tool_name:'Bash',tool_use_id:'one',tool_response:{session_id:123}})
 rows.push({type:'response_item',payload:{type:'custom_tool_call_output',call_id:'outer',output:[{type:'input_text',text:'Script failed\nWall time 1 seconds\nOutput:\n'},{type:'input_text',text:'Earlier printed discovery output\nScript error:\nexec_command failed: CreateProcess { message: Failed to create unified exec process: CreateProcessWithLogonW failed: 267'}]}});flush();hook(f,'SessionEnd')
 expect(coordination(f.store,{directory:f.repo,sessionID:'next',host:'codex'})({action:'join',title:'Next',scopes:['.']}).acquired).toBe(false)
})


test('fresh session reconciles an ended owner only after terminal evidence arrives',()=>{
 const f=fixture(),transcript=join(f.root,'ended.jsonl'),rows:any[]=[{type:'session_meta',payload:{id:'test-session'}},{type:'response_item',payload:{type:'custom_tool_call',call_id:'outer'}}]
 const flush=()=>writeFileSync(transcript,rows.map(r=>JSON.stringify(r)).join('\n'));flush();hook(f,'SessionStart',{transcript_path:transcript});hook(f,'PreToolUse',{tool_name:'Bash',tool_use_id:'failed'})
 hook(f,'SessionEnd');expect(coordination(f.store,{directory:f.repo,sessionID:'other',host:'codex'})({action:'join',title:'Other',scopes:['.']}).acquired).toBe(false)
 rows.push({type:'response_item',payload:{type:'custom_tool_call_output',call_id:'outer',output:[{type:'input_text',text:'Script failed\nWall time 1 seconds\nOutput:\n'},{type:'input_text',text:'Printed output\nScript error:\nexec_command failed: CreateProcess { message: Failed to create unified exec process: The directory name is invalid. (os error 267)'}]}});flush()
 codexHook({session_id:'fresh',cwd:f.repo,hook_event_name:'SessionStart'},f.store)
 expect(coordination(f.store,{directory:f.repo,sessionID:'other',host:'codex'})({action:'join',title:'Other',scopes:['.']}).acquired).toBe(true)
})
test('terminal tool evidence alone does not release a session that has not ended',()=>{
 const f=fixture(),transcript=join(f.root,'live.jsonl')
 writeFileSync(transcript,JSON.stringify({type:'session_meta',payload:{id:'test-session'}})+'\n')
 hook(f,'SessionStart',{transcript_path:transcript});hook(f,'PreToolUse',{tool_name:'mcp__fixture__write',tool_use_id:'live-call'})
 writeFileSync(transcript,[{type:'session_meta',payload:{id:'test-session'}},{type:'event_msg',payload:{type:'item_completed',item:{id:'live-call',type:'McpToolCall',status:'completed'}}}].map(row=>JSON.stringify(row)).join('\n'))
 codexHook({session_id:'fresh',cwd:f.repo,hook_event_name:'SessionStart'},f.store)
 expect(coordination(f.store,{directory:f.repo,sessionID:'observer',host:'codex'},Date.now()+1e9)({action:'join',title:'Observer',scopes:['.']}).acquired).toBe(false)
 hook(f,'SessionEnd')
 expect(coordination(f.store,{directory:f.repo,sessionID:'observer',host:'codex'})({action:'join',title:'Observer',scopes:['.']}).acquired).toBe(true)
})

test('adapter keeps the production Quest contract and excludes manual coordination',async()=>{
 const f=fixture(),dispatch=questMCP({store:f.store})
 const discovered=await dispatch({id:1,method:'tools/list'})
 const schema=discovered.result.tools[0].inputSchema
 expect(schema.properties.action.enum).toEqual(['list','get','create','update','inspect'])
 expect(schema.properties.run).toBeUndefined()
 expect(schema.properties.update.properties.workspaceMode).toBeUndefined()
 expect(schema.properties.update.properties.handoff).toBeUndefined()
 expect(schema.properties.update.properties.steps.items.properties.note).toEqual({type:'string'})
 expect(schema.properties.update.properties.steps.items.properties.result).toBeUndefined()
 for(const action of ['join','release','recover','run']){
  const response=await dispatch({id:action,method:'tools/call',params:{name:'quest',arguments:{action}}})
  expect(response.result.isError).toBe(true)
 }
 const input={action:'create',create:{title:'Production contract',description:'Current API',steps:[{id:'verify',title:'Verify'}],reward:'Reviewed deliverable'}}
 const pre=hook(f,'PreToolUse',{tool_name:'mcp__quest__quest',tool_input:input})
 const created=await dispatch({id:'create-contract',method:'tools/call',params:{name:'quest',arguments:pre.hookSpecificOutput.updatedInput}})
 const id=JSON.parse(created.result.content[0].text).id
 const getPre=hook(f,'PreToolUse',{tool_name:'mcp__quest__quest',tool_input:{action:'get',id}})
 const reloaded=await questMCP({store:new QuestStore(f.root)})({id:'get-contract',method:'tools/call',params:{name:'quest',arguments:getPre.hookSpecificOutput.updatedInput}})
 expect(reloaded.result.isError).toBeUndefined()
 expect(JSON.parse(reloaded.result.content[0].text).reward).toBe('Reviewed deliverable')
})

test('broken optional Quest links cannot loop hook failures or lose completed tool receipts',()=>{
 const f=fixture();hook(f,'SessionStart')
 const file=join(f.store.runtime,'codex',createHash('sha256').update('test-session').digest('hex')+'.json')
 const state=JSON.parse(readFileSync(file,'utf8'));state.questID='missing-historical-quest';writeFileSync(file,JSON.stringify(state))
 const originalRead=f.store.read.bind(f.store)
 f.store.read=(id:string)=>{if(id==='missing-historical-quest')throw Error('Invalid Quest event at line 18; Journal preserved.');return originalRead(id)}
 const input={tool_name:'Bash',tool_use_id:'done-command',tool_input:{command:'echo checked'}}
 expect(()=>hook(f,'PreToolUse',input)).not.toThrow()
 const result=hook(f,'PostToolUse',{...input,tool_response:{exit_code:0,output:'checked'}})
 expect(result.hookSpecificOutput.additionalContext).toContain('tool completion is saved')
 let saved=JSON.parse(readFileSync(file,'utf8'));expect(saved.pending).toEqual([]);expect(saved.events.at(-1).result.exit_code).toBe(0);expect(saved.diagnostics.questRead).toContain('line 18');expect(saved.diagnostics.artifactLink).toBeDefined()
 const next={...input,tool_use_id:'next-command'};hook(f,'PreToolUse',next)
 expect(hook(f,'PostToolUse',{...next,tool_response:{exit_code:0}})).toEqual({})
 saved=JSON.parse(readFileSync(file,'utf8'));expect(saved.pending).toEqual([]);expect(saved.events.length).toBe(2)
 hook(f,'SessionEnd');expect(coordination(f.store,{directory:f.repo,sessionID:'next-owner',host:'codex'})({action:'join',title:'Next',scopes:['.']}).acquired).toBe(true)
})

test('MCP discovery stays compact while paginated evidence round trips after reload',async()=>{
 const f=fixture();let id=0
 const call=async(input:any)=>{const pre=hook(f,'PreToolUse',{tool_name:'mcp__quest__quest',tool_use_id:String(++id),tool_input:input});const result=(await questMCP({store:new QuestStore(f.root)})({id,method:'tools/call',params:{name:'quest',arguments:pre.hookSpecificOutput.updatedInput}})).result;expect(result.isError).toBeUndefined();return result.content[0].text}
 const description='Detailed source evidence. '.repeat(1800)
 const q=JSON.parse(await call({action:'create',create:{title:'Large record',description,steps:[{title:'Inspect'}]}}))
 expect((await call({action:'list'})).length).toBeLessThan(6000)
 expect((await call({action:'get',id:q.id})).length).toBeLessThan(10000)
 // Unrelated damaged continuation metadata must not prevent reading descriptions.
 writeFileSync(join(f.store.runtime,'continuations.json'),'{broken')
 let offset:number|null=0,full=''
 while(offset!==null){const part=JSON.parse(await call({action:'inspect',id:q.id,inspect:{section:'description',offset,limit:8000}}));expect(part.text.length).toBeLessThanOrEqual(8000);full+=part.text;offset=part.nextOffset}
 expect(JSON.parse(full)).toBe(description)
})
