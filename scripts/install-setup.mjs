/** Install tracked setup files; preserve independent local edits and keep a receipt. */
import {readFileSync,writeFileSync,mkdirSync,existsSync,realpathSync,copyFileSync,renameSync,lstatSync} from 'node:fs'
import {resolve,join,dirname,relative,isAbsolute} from 'node:path'
import {fileURLToPath} from 'node:url'
import {homedir} from 'node:os'
import {createHash} from 'node:crypto'
const source=resolve(dirname(fileURLToPath(import.meta.url)),'..'),args=process.argv.slice(2)
const root=resolve(args.includes('--root')?args[args.indexOf('--root')+1]:homedir()),apply=args.includes('--apply')
const manifest=JSON.parse(readFileSync(join(source,'setup/manifest.json'),'utf8'))
const receiptPath=join(root,'.local/state/JonsOCsetup/install.json'),prior=existsSync(receiptPath)?JSON.parse(readFileSync(receiptPath,'utf8')):{files:[]}
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex')
function inside(base,path){const r=relative(base,path);if(r==='..'||r.startsWith('..'+(process.platform==='win32'?'\\':'/'))||isAbsolute(r))throw Error('Path escapes setup root: '+path)}
function targetPath(path){const target=resolve(root,path);inside(root,target);let parent=target;while(!existsSync(parent))parent=dirname(parent);inside(realpathSync(root),realpathSync(parent));return target}
if(!existsSync(root)){if(!apply)throw Error('Preview root must exist');mkdirSync(root,{recursive:true})}
const plan=manifest.entries.map(entry=>{
 const entrySource=entry.source??'setup/files/'+entry.target
 const from=resolve(source,entrySource);inside(realpathSync(source),realpathSync(from));const sha256=hash(from)
 if(sha256!==entry.sha256)throw Error('Manifest/source drift: '+entrySource)
 const target=targetPath(entry.target),current=existsSync(target)?hash(target):null,old=prior.files.find(f=>f.target===entry.target)
 // A target that is a link to this very source needs no installing and must never be written: the
 // write below replaces the path rather than its contents, which would turn the link back into the
 // copy it was made to remove, silently and without changing a byte of content.
 const linked=existsSync(target)&&lstatSync(target).isSymbolicLink()&&realpathSync(target)===realpathSync(from)
 if(linked)return {...entry,from,targetPath:target,state:'linked'}
 return {...entry,from,targetPath:target,state:current===sha256?'current':current===null?'missing':current===old?.sha256?'update':'conflict'}
})
if(plan.some(e=>e.state==='conflict')){console.log(JSON.stringify({applied:false,conflicts:plan.filter(e=>e.state==='conflict').map(e=>e.target)},null,2));process.exit(2)}
if(apply){
 const backup=join(root,'.local/state/JonsOCsetup/backups',String(Date.now()))
 for(const e of plan){if(e.state==='current'||e.state==='linked')continue;mkdirSync(dirname(e.targetPath),{recursive:true});if(existsSync(e.targetPath)){const b=join(backup,e.target);mkdirSync(dirname(b),{recursive:true});copyFileSync(e.targetPath,b)}const tmp=e.targetPath+'.jonsocsetup-'+process.pid+'.tmp';writeFileSync(tmp,readFileSync(e.from));renameSync(tmp,e.targetPath)}
 mkdirSync(dirname(receiptPath),{recursive:true});writeFileSync(receiptPath,JSON.stringify({schema:1,name:manifest.name,source,installedAt:new Date().toISOString(),files:plan.map(({target,sha256})=>({target,sha256}))},null,2)+'\n')
}
console.log(JSON.stringify({applied:apply,root,total:plan.length,current:plan.filter(e=>e.state==='current').length,linked:plan.filter(e=>e.state==='linked').length,missing:plan.filter(e=>e.state==='missing').length,updates:plan.filter(e=>e.state==='update').length,receipt:apply?receiptPath:undefined},null,2))
