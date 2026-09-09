import { resolveHostExecutable } from '../project-router/executable.mjs'
/** Deterministic installed-host proof that agent permissions filter actual tools. No account inference. */
import {mkdirSync,writeFileSync,readFileSync,cpSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {parse} from 'json5'
const root=resolve(import.meta.dir,'..'),dir=join(root,'.visual-e2e','worker-tool-filter-'+Date.now());mkdirSync(dir,{recursive:true})
const source=parse(readFileSync(join(root,'opencode.jsonc'),'utf8')),receipts:any[]=[]
for(const deny of [true,false]){
 const cwd=join(dir,deny?'denied':'allowed');mkdirSync(cwd);let toolNames:string[]=[],skillAdvertised=false
 const server=Bun.serve({port:0,async fetch(request){const p=await request.json() as any;if(p.tools?.length){toolNames=p.tools.map((t:any)=>t.function.name);skillAdvertised=JSON.stringify(p.tools.find((t:any)=>t.function.name==='skill')).includes('help-i-cant-work-right')||JSON.stringify(p.messages).includes('help-i-cant-work-right')}
 return new Response('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:'model',choices:[{index:0,delta:{role:'assistant',content:'TOOLS_OBSERVED'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}})}})
 const astra=structuredClone(source.agents.astra);astra.model='tool-fixture/model';for(const rule of astra.permissions)if(['edit','write','patch','shell'].includes(rule.action))rule.effect=deny?'deny':'allow'
 cpSync(join(root,'skills/help-i-cant-work-right'),join(cwd,'skills/help-i-cant-work-right'),{recursive:true})
 writeFileSync(join(cwd,'opencode.jsonc'),JSON.stringify({agents:{astra},providers:{'tool-fixture':{package:'@opencode-ai/ai/providers/openai-compatible',env:[],settings:{baseURL:'http://127.0.0.1:'+server.port+'/v1',apiKey:'fixture-only'},models:{model:{limit:{context:128000,output:500}}}}}}))
 const proc=Bun.spawn([resolveHostExecutable(),'run','--standalone','--auto','--agent','astra','-m','tool-fixture/model','Report your observed tools.'],{cwd,env:{...process.env,OPENCODE_CONFIG_DIR:cwd,OPENCODE_CONFIG_PROJECT_DISABLE:'1',OPENCODE_DB:join(cwd,'host.db'),OPENCODE_DISABLE_AUTOUPDATE:'1'},windowsHide:true,stdin:'ignore',stdout:'pipe',stderr:'pipe'})
 const timer=setTimeout(()=>proc.kill(),30000)
 try{const [code,out,err]=await Promise.all([proc.exited,new Response(proc.stdout).text(),new Response(proc.stderr).text()]);receipts.push({deny,code,toolNames,skillAdvertised,out,err})}finally{clearTimeout(timer);server.stop(true)}
}
const checks={denied:receipts[0].code===0&&!receipts[0].toolNames.some((n:string)=>['patch','edit','write','shell'].includes(n)),allowed:receipts[1].code===0&&receipts[1].toolNames.some((n:string)=>['patch','edit','write'].includes(n))&&receipts[1].toolNames.includes('shell'),nonrecursive:receipts.every(r=>!r.toolNames.some((n:string)=>['task','subagent'].includes(n))),skill:receipts[1].skillAdvertised};const ok=Object.values(checks).every(Boolean);writeFileSync(join(dir,'report.json'),JSON.stringify({ok,checks,receipts},null,2));console.log(JSON.stringify({ok,checks,report:join(dir,'report.json')}));process.exitCode=ok?0:1
