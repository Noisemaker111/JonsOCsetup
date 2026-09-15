/**
 * @core-prevents long active Codex conversations disappearing from measured usage, duplicate appended counters, and stale counters after replacement
 * @core-observed September 15 the collector skipped the current large Codex rollout at its file-byte cutoff.
 */
import {test,expect} from 'bun:test'
import {mkdtempSync,writeFileSync,appendFileSync,rmSync,renameSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {harvestCodexUsage} from '../usage/codex-harvest'

test('large rollouts, appended partial records and replaced files retain only reconciled counters',async()=>{
 const root=mkdtempSync(join(tmpdir(),'codex-stream-')),file=join(root,'rollout.jsonl'),now=Date.now(),start=now-60000
 const line=(type:string,payload:object,at=start)=>JSON.stringify({timestamp:new Date(at).toISOString(),type,payload})
 const header=(id:string)=>line('session_meta',{id,source:'cli'})+'\n'+line('turn_context',{model:'verification-model',effort:'high'})+'\n'
 const counter=(n:number)=>({input_tokens:100*n,cached_input_tokens:20*n,cache_write_input_tokens:0,output_tokens:10*n,reasoning_output_tokens:2*n,total_tokens:110*n})
 const point=(n:number)=>line('event_msg',{type:'token_count',info:{total_token_usage:counter(n),last_token_usage:counter(1)}},start+n)
 try{
  writeFileSync(file,header('first')+point(1)+'\n')
  const padding=line('response_item',{content:'ordinary transcript text '.repeat(4096)})+'\n'
  for(let i=0;i<750;i++)appendFileSync(file,padding)
  let turns=0;const timer=setInterval(()=>turns++,1)
  const initial=await harvestCodexUsage({root,from:start,to:now,now}).finally(()=>clearInterval(timer))
  expect(turns).toBeGreaterThan(0)
  expect(initial.parsedBytes).toBeGreaterThan(64*1024*1024)
  expect(initial.coverage.reconciledRequests).toBe(1)
  expect(initial.sessions[0].totals).toEqual({input:80,cacheRead:20,cacheWrite:0,output:8,reasoning:2})
  const second=point(2),split=Math.floor(second.length/2)
  appendFileSync(file,second.slice(0,split))
  const partial=await harvestCodexUsage({root,from:start,to:now,now})
  expect(partial.coverage.reconciledRequests).toBe(1)
  expect(partial.parsedBytes).toBe(Buffer.byteLength(second.slice(0,split)))
  expect(partial.diagnostics.some(d=>d.includes('unfinished trailing record'))).toBe(true)
  appendFileSync(file,second.slice(split)+'\n')
  const complete=await harvestCodexUsage({root,from:start,to:now,now})
  expect(complete.coverage.reconciledRequests).toBe(2)
  expect(complete.parsedBytes).toBe(Buffer.byteLength(second.slice(split)+'\n'))
  const [narrow,wide]=await Promise.all([harvestCodexUsage({root,from:start+2,to:now,now}),harvestCodexUsage({root,from:start,to:now,now})])
  expect(narrow.sessions[0].requests).toBe(1)
  expect(wide.sessions[0].requests).toBe(2)
  expect((await harvestCodexUsage({root,from:start+2,to:now,now})).sessions[0].requests).toBe(1)
  expect((await harvestCodexUsage({root,from:start,to:now,now})).sessions[0].requests).toBe(2)
  expect((await harvestCodexUsage({root,from:start,to:now,now})).parsedBytes).toBe(0)
  writeFileSync(file,header('truncated')+point(1)+'\n')
  expect((await harvestCodexUsage({root,from:start,to:now,now})).sessions[0].id).toBe('truncated')
  const replacement=join(root,'replacement');writeFileSync(replacement,header('replacement')+point(1)+'\n'+point(2)+'\n');renameSync(replacement,file)
  const replaced=await harvestCodexUsage({root,from:start,to:now,now})
  expect(replaced.sessions[0].id).toBe('replacement')
  expect(replaced.sessions[0].requests).toBe(2)
 }finally{rmSync(root,{recursive:true,force:true})}
})
