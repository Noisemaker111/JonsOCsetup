/** Interactive input and captures from the installed OpenCode2 PTY; no scenarios or expected outputs. */
import {EmbeddedTerminalRenderable,KeyEvent} from '@opentui/core'
import {createTestRenderer} from '@opentui/core/testing'
import {Resvg} from '@resvg/resvg-js'
import {frameToSvg,HOST_PALETTE} from '../ui-lab/frame-html'
import {spawn} from 'node:child_process'
import {mkdirSync,readFileSync,writeFileSync,appendFileSync,existsSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {freePort} from './plugin-deploy'
import {driveEnvironment} from './drive-isolation'

const option=(name:string)=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1]}
if(process.argv.includes('--help')){
 console.log('bun run runtime:drive -- --config-root <prepared release> --cwd <project> --model <exact route> --out <new evidence directory> [--agent quest-giver] [--auto] [--live]')
 console.log('Append one JSON command per line to commands.jsonl: paste {text}; key {name,ctrl?,shift?,meta?}; click {x,y,button?}; scroll {x,y,direction}; capture {name}; stop. Coordinates are 1-based terminal cells. Paste does not submit; send key name=return separately. Captures render actual terminal output, never app source.')
 process.exit(0)
}
for(const key of ['--config-root','--cwd','--model','--out'])if(!option(key))throw Error('Required: '+key)
const root=resolve(option('--config-root')!),cwd=resolve(option('--cwd')!),out=resolve(option('--out')!),model=option('--model')!
if(existsSync(out))throw Error('Choose a new evidence directory; existing sessions and captures are preserved')
const cols=Number(option('--cols')??140),rows=Number(option('--rows')??48)
if(!Number.isInteger(cols)||!Number.isInteger(rows)||cols<40||cols>300||rows<10||rows>150)throw Error('Invalid terminal dimensions')
mkdirSync(out,{recursive:true})
const queue=join(out,'commands.jsonl');writeFileSync(queue,'')
// This library API supplies an offscreen terminal canvas; it runs no tests.
const canvas=await createTestRenderer({width:cols,height:rows})
const terminal=new EmbeddedTerminalRenderable(canvas.renderer,{id:'host',width:cols,height:rows,cols,rows,maxScrollback:100000})
canvas.renderer.root.add(terminal);terminal.focus()
// Isolated by default: a drive is usually a check, and a check must not write into the real session
// database, quest ledger or orchestration log. --live is the opposite case -- another harness asking
// the Quest Giver to do actual work -- so it keeps the host's real homes and only captures frames
// into the evidence directory. It still starts its own session, so it never types into a
// conversation someone already has open. See scripts/drive-isolation.ts for the table.
const env=driveEnvironment({base:process.env,root,out,live:process.argv.includes('--live'),bridgePort:await freePort()})
const child=spawn('node',[join(root,'scripts/opencode-runtime.mjs'),'--config-root',root,'--json',...(process.argv.includes('--auto')?['--auto']:[]),'--cwd',cwd,'--model',model,'--agent',option('--agent')??'quest-giver','--cols',String(cols),'--rows',String(rows)],{cwd:root,env,windowsHide:true,stdio:['pipe','pipe','pipe']})
const send=(data:string)=>child.stdin.write(JSON.stringify({type:'write',data:Buffer.from(data).toString('base64')})+'\n')
terminal.onData=data=>send(Buffer.from(data).toString())
let buffer='',seen=0,busy=false,done=false,stopping=false
const events:any[]=[]
child.stdout.on('data',part=>{buffer+=part;for(;;){const n=buffer.indexOf('\n');if(n<0)break;const line=buffer.slice(0,n);buffer=buffer.slice(n+1);try{const event=JSON.parse(line);if(event.type==='data'){const raw=Buffer.from(event.data,'base64').toString();terminal.write(raw);appendFileSync(join(out,'terminal.ansi'),raw)}else{events.push(event);console.log(JSON.stringify(event));writeFileSync(join(out,'events.json'),JSON.stringify(events,null,2))}}catch{appendFileSync(join(out,'errors.txt'),line+'\n')}}})
child.stderr.on('data',part=>appendFileSync(join(out,'errors.txt'),part))
child.on('error',error=>{console.error(String(error));finish(1)})
function finish(code:number){if(done)return;done=true;clearInterval(timer);terminal.onData=undefined;terminal.destroy();canvas.renderer.destroy();console.log(JSON.stringify({exit:code,out}));process.exit(code)}
child.on('exit',code=>finish(code??1))
const sequences:Record<string,string>={return:'\r',escape:'\x1b',tab:'\t',backspace:'\x7f',up:'\x1b[A',down:'\x1b[B',right:'\x1b[C',left:'\x1b[D',home:'\x1b[H',end:'\x1b[F',pageup:'\x1b[5~',pagedown:'\x1b[6~',delete:'\x1b[3~'}
async function command(c:any){
 if(stopping)throw Error('The owned session is stopping')
 if(c.action==='paste'){if(typeof c.text!=='string')throw Error('paste requires text');send(Buffer.from(terminal.encodePaste(new TextEncoder().encode(c.text))).toString())}
 else if(c.action==='key'){
  if(typeof c.name!=='string'||(!sequences[c.name]&&c.name.length!==1))throw Error('Unsupported key')
  const sequence=sequences[c.name]??c.name
  send(Buffer.from(terminal.encodeKey(new KeyEvent({name:c.name,sequence,raw:sequence,ctrl:c.ctrl===true,shift:c.shift===true,meta:c.meta===true,option:false,number:false,eventType:'press',source:'raw'}))).toString())
 }else if(c.action==='click'||c.action==='scroll'){
  if(!Number.isInteger(c.x)||!Number.isInteger(c.y)||c.x<1||c.x>cols||c.y<1||c.y>rows)throw Error('Coordinates outside terminal')
  const button=c.action==='scroll'?(c.direction==='up'?64:c.direction==='down'?65:-1):(c.button??0)
  if(![0,1,2,64,65].includes(button))throw Error('Invalid mouse button or scroll direction')
  send(`\x1b[<${button};${c.x};${c.y}M`);if(c.action==='click')send(`\x1b[<${button};${c.x};${c.y}m`)
 }else if(c.action==='capture'){
  if(typeof c.name!=='string'||! /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(c.name))throw Error('Use a simple unique capture name')
  const path=join(out,c.name);if(existsSync(path+'.png')||existsSync(path+'.txt'))throw Error('Capture already exists')
  await canvas.renderOnce();writeFileSync(path+'.txt',terminal.screen().text)
  writeFileSync(path+'.png',new Resvg(frameToSvg(canvas.captureSpans(),c.name,HOST_PALETTE),{font:{loadSystemFonts:true}}).render().asPng())
  console.log(JSON.stringify({capture:path+'.png',screen:path+'.txt'}))
 }else if(c.action==='stop'){stopping=true;child.stdin.write(JSON.stringify({type:'stop'})+'\n')}
 else throw Error('Unknown terminal action')
}
const timer=setInterval(async()=>{if(busy||done)return;busy=true;try{const lines=readFileSync(queue,'utf8').split('\n');lines.pop();while(seen<lines.length){const line=lines[seen++];if(!line.trim())continue;try{await command(JSON.parse(line));appendFileSync(join(out,'actions.jsonl'),JSON.stringify({line:seen,ok:true,at:new Date().toISOString()})+'\n')}catch(error){const result={line:seen,ok:false,error:String(error)};console.error(JSON.stringify(result));appendFileSync(join(out,'actions.jsonl'),JSON.stringify(result)+'\n');break}}}finally{busy=false}},250)
console.log(JSON.stringify({commands:queue,out,root,cwd,model,cols,rows}))
