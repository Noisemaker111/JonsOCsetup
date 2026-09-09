/** @jsxImportSource @opentui/solid */
import {mkdirSync,writeFileSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {testRender} from '@opentui/solid'
import {Resvg} from '@resvg/resvg-js'
import {frameToSvg} from './opencode-visual-e2e'
const width=Number(process.argv[2]??100),light=process.argv[3]==='light'
const out=resolve('.visual-e2e/usage-evidence'),cache=join(out,'real-cache');mkdirSync(out,{recursive:true})
process.env.OPENCODE_ACCOUNT_DISCOVERY_ROOT=join(out,'no-auth')
process.env.OPENCODE_ACCOUNT_USAGE_FILE=join(cache,'account-usage.json')
process.env.OPENCODE_USAGE_CACHE_FILE=join(cache,'usage-cache.json')
process.env.OPENCODE_TELEMETRY_FILE=join(cache,'requests.jsonl')
process.env.OPENCODE_PASSIVE_LEDGER_FILE=join(cache,'missing.sqlite')
const {UsageDialog}=await import('../usage/tui-active/usage')
const context={renderer:{width,height:44},theme:{background:light?'#f4f7fb':'#07111b',text:light?'#172b4d':'#e6edf3',textMuted:light?'#526275':'#9ba9b9',primary:light?'#0050a4':'#79b8ff',warning:light?'#875000':'#ffcb6b'},ui:{dialog:{clear(){}}}}
const setup=await testRender(()=><UsageDialog context={context}/>,{width,height:44})
const captures:string[]=[]
async function capture(name:string){await setup.renderOnce();await Bun.sleep(80);await setup.renderOnce();const text=setup.captureCharFrame(),svg=frameToSvg(setup.captureSpans(),name),stem=join(out,`${light?'light':'dark'}-${width}-${name}`);writeFileSync(stem+'.txt',text);writeFileSync(stem+'.svg',svg);writeFileSync(stem+'.png',new Resvg(svg,{font:{loadSystemFonts:true}}).render().asPng());captures.push(stem+'.png');return text}
try{
 let text=await capture('summary');if(!text.includes('points remaining'))throw Error('Summary did not render')
 for(let n=0;n<8&&!text.includes('openai');n++){await setup.mockInput.pressKey('a');text=await capture('account')}
 await setup.mockInput.pressKey('v');text=await capture('history');if(!text.includes('Reset period'))throw Error('Keyboard view change failed')
 await setup.mockInput.pressKey('v');text=await capture('requests');if(!text.includes('Request counters'))throw Error('Requests not reachable')
 await setup.mockInput.pressKey('n');await capture('requests-next')
 console.log(JSON.stringify({ok:true,width,light,captures,source:'Actual UsageDialog; frozen copy of existing numeric account and native-request records. Passive ledger omitted, no external request attribution.'}))
}finally{setup.renderer.destroy()}
