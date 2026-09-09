/** Explicit, preview-first permission repair; never changes plugin activation or session ownership. */
import JSON5 from 'json5'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {generationRoot} from './runtime-contract.mjs'
const tools = ['project_discover','project_resolve','project_select','project_route','project_result','project_clone','project_route_status','project_verify','project_goal']
export function permissionRepair(text:string, selected:any) {
 const config=JSON5.parse(text), permissions=config.agents?.['quest-giver']?.permissions
 if(!Array.isArray(permissions))throw Error('Quest Giver has no explicit permission list; inspect before repair')
 const grants=tools.map(action=>{
  if(!selected.agents?.['quest-giver']?.permissions?.some((p:any)=>p.action===action&&p.resource==='*'&&p.effect==='allow'))throw Error('Selected generation does not authorize '+action)
  return {action,resource:'*',effect:'allow'}
 })
 if(JSON.stringify(permissions.slice(-grants.length))===JSON.stringify(grants))return {text,changed:false,grants}
 const matches=[...text.matchAll(/"permissions"\s*:\s*(\[[\s\S]*?\])/g)].filter(m=>{try{return JSON.stringify(JSON5.parse(m[1]))===JSON.stringify(permissions)}catch{return false}})
 if(matches.length!==1)throw Error('Permission block is ambiguous; no file changed')
 const match=matches[0],start=match.index!+match[0].indexOf('['), replacement=JSON.stringify([...permissions,...grants],null,2).replace(/\n/g,'\n      ')
 const next=text.slice(0,start)+replacement+text.slice(start+match[1].length)
 const check=JSON5.parse(next);check.agents['quest-giver'].permissions=permissions
 if(JSON.stringify(check)!==JSON.stringify(config))throw Error('Repair changed unrelated configuration; no file changed')
 return {text:next,changed:true,grants}
}
if(import.meta.main){
 const arg=(name:string)=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1]}
 const root=arg('--root');if(!root)throw Error('Specify --root for the owning config repository; default is preview')
 const file=join(resolve(root),'opencode.jsonc'),before=readFileSync(file,'utf8'),sha=createHash('sha256').update(before).digest('hex')
 const pointer=JSON.parse(readFileSync(join(root,'plugin-activation.json'),'utf8'));if(pointer.evidence?.ok!==true)throw Error('Selected generation has no successful activation evidence')
 const selected=JSON5.parse(readFileSync(join(generationRoot(root,pointer.activeGeneration),'opencode.jsonc'),'utf8')),plan=permissionRepair(before,selected)
 if(process.argv.includes('--apply')&&plan.changed){
  if(arg('--expected-sha')!==sha)throw Error('Preview digest is missing or stale; preview the current file again')
  const backup=join(root,'run','permission-repair',String(Date.now()));mkdirSync(backup,{recursive:true});writeFileSync(join(backup,'opencode.jsonc.before'),before)
  if(readFileSync(file,'utf8')!==before)throw Error('Configuration changed during repair; preserved current file')
  writeFileSync(file,plan.text);if(readFileSync(file,'utf8')!==plan.text)throw Error('Permission repair readback failed')
 }
 console.log(JSON.stringify({file,generation:pointer.activeGeneration,expectedSHA:sha,changed:plan.changed,applied:process.argv.includes('--apply')&&plan.changed,grants:plan.grants.map(p=>p.action),restart:false,pluginActivationChanged:false},null,2))
}
