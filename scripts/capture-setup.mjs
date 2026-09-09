/** Capture explicit setup surfaces without touching live installations or runtime data. */
import {readFileSync,writeFileSync,readdirSync,statSync,mkdirSync,existsSync,realpathSync} from 'node:fs'
import {join,dirname,relative,resolve} from 'node:path'
import {homedir} from 'node:os'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
const root=process.cwd(),home=homedir(),hash=b=>createHash('sha256').update(b).digest('hex')
const tracked=new Set(execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0'))
const entries=[],dependencies=[],omitted=[]
function file(target){
 const from=join(home,target);if(!existsSync(from))return
 const bytes=readFileSync(from)
 if(bytes.length>2*1024*1024)throw Error('Review oversized setup file: '+target)
 if(/(?:sk-(?:proj-)?[A-Za-z0-9_-]{30,}|gh[pousr]_[A-Za-z0-9]{25,}|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----)/.test(bytes.toString()))throw Error('Credential-shaped content requires review: '+target)
 if(!bytes.equals(readFileSync(from)))throw Error('Setup input changed during capture: '+target)
 const canonical=realpathSync(from).replaceAll('\\','/'),repo=join(home,'.config/opencode').replaceAll('\\','/')+'/'
 const existing=canonical.startsWith(repo)?canonical.slice(repo.length):null
 let source
 if(existing&&tracked.has(existing)&&existsSync(join(root,existing))&&hash(readFileSync(join(root,existing)))===hash(bytes))source=existing
 else{source='setup/files/'+target.replaceAll('\\','/');mkdirSync(dirname(join(root,source)),{recursive:true});writeFileSync(join(root,source),bytes)}
 entries.push({source,target:target.replaceAll('\\','/'),sha256:hash(bytes),importedFrom:target.replaceAll('\\','/')})
}
function tree(target){if(!existsSync(join(home,target)))return;for(const e of readdirSync(join(home,target),{withFileTypes:true})){if(['node_modules','.git','__pycache__'].includes(e.name))continue;const path=join(target,e.name);if(e.isDirectory())tree(path);else if(e.isSymbolicLink()){omitted.push({path,reason:'nested link requires explicit mapping'})}else file(path)}}
for(const path of ['Projects/opencode-hub/AGENTS.md','Projects/opencode-hub/CLAUDE.md','.agents/matt-pocock.md','.agents/.skill-lock.json','.agents/plugins/marketplace.json','.codex/AGENTS.md'])file(path)
for(const path of ['.agents/scripts','.agents/docs','.codex/skills/convex-deploy-guard'])tree(path)
for(const e of readdirSync(join(home,'.agents/skills'),{withFileTypes:true})){const p='.agents/skills/'+e.name;if(statSync(join(home,p)).isDirectory())tree(p);else file(p)}
// Disabled skills stay disabled but remain reproducible source, including their licenses.
tree('.agents/skills-disabled')
const cache=join(home,'.codex/plugins/cache')
if(existsSync(cache))for(const publisher of readdirSync(cache,{withFileTypes:true}).filter(e=>e.isDirectory()))for(const plugin of readdirSync(join(cache,publisher.name),{withFileTypes:true}).filter(e=>e.isDirectory())){
 const versions=readdirSync(join(cache,publisher.name,plugin.name),{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>e.name)
 dependencies.push({publisher:publisher.name,plugin:plugin.name,installedVersions:versions,ownership:publisher.name==='personal'?'local-source':'external-dependency'})
}
writeFileSync('setup/manifest.json',JSON.stringify({schema:1,name:'JonsOCsetup',entries,dependencies,omitted,excluded:['credentials and account tokens','session databases and logs','Quest runtime journals','generated plugin generations and caches','upstream host binaries and source checkouts']},null,2)+'\n')
console.log(JSON.stringify({mappedFiles:entries.length,bytes:entries.reduce((n,e)=>n+statSync(join(root,e.source)).size,0),dependencies:dependencies.length,omitted}))
