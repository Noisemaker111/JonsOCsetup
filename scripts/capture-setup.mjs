/** Capture explicit setup surfaces without touching live installations or runtime data. */
import {readFileSync,writeFileSync,readdirSync,statSync,mkdirSync,existsSync,realpathSync} from 'node:fs'
import {join,dirname,relative,resolve} from 'node:path'
import {homedir} from 'node:os'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
const root=process.cwd(),home=homedir(),hash=b=>createHash('sha256').update(b).digest('hex')
const tracked=new Set(execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0'))
const entries=[],dependencies=[],omitted=[]
// A target already mapped to a repository file keeps that file as its source while the bytes still
// agree. Without this a capture silently forks a second copy under setup/files as soon as the
// installed file stops being a link into the checkout, and the two then drift apart unnoticed --
// which is how `.agents/user-verification.md` came to have both `docs/` and a setup/files twin.
const previous=new Map(existsSync(join(root,'setup/manifest.json'))
 ?JSON.parse(readFileSync(join(root,'setup/manifest.json'),'utf8')).entries.map(e=>[e.target.replaceAll('\\','/'),e.source])
 :[])
function file(target){
 const from=join(home,target);if(!existsSync(from))return
 const bytes=readFileSync(from)
 if(bytes.length>2*1024*1024)throw Error('Review oversized setup file: '+target)
 if(/(?:sk-(?:proj-)?[A-Za-z0-9_-]{30,}|gh[pousr]_[A-Za-z0-9]{25,}|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----)/.test(bytes.toString()))throw Error('Credential-shaped content requires review: '+target)
 if(!bytes.equals(readFileSync(from)))throw Error('Setup input changed during capture: '+target)
 // The checkout this capture writes into, not a fixed path: an installed file that is a link
 // into this tree already IS the tracked file, and reading it as a separate copy made twins.
 const canonical=realpathSync(from).replaceAll('\\','/'),repo=realpathSync(root).replaceAll('\\','/')+'/'
 const existing=canonical.startsWith(repo)?canonical.slice(repo.length):null
 const prior=previous.get(target.replaceAll('\\','/'))
 const usable=path=>path&&!path.startsWith('setup/files/')&&tracked.has(path)&&existsSync(join(root,path))&&hash(readFileSync(join(root,path)))===hash(bytes)
 let source
 if(usable(existing))source=existing
 else if(usable(prior))source=prior
 else{source='setup/files/'+target.replaceAll('\\','/');mkdirSync(dirname(join(root,source)),{recursive:true});writeFileSync(join(root,source),bytes)}
 entries.push({source,target:target.replaceAll('\\','/'),sha256:hash(bytes),importedFrom:target.replaceAll('\\','/')})
}
function tree(target){if(!existsSync(join(home,target)))return;for(const e of readdirSync(join(home,target),{withFileTypes:true})){if(['node_modules','.git','__pycache__'].includes(e.name))continue;const path=join(target,e.name);if(e.isDirectory())tree(path);else if(e.isSymbolicLink()){if(existsSync(join(home,path))&&statSync(join(home,path)).isDirectory())omitted.push({path,reason:'directory link requires explicit mapping'});else file(path)}else file(path)}}
// .agents/quest.mjs and its filing alias are the shared Quest board's entry point for every
// harness; untracked they would exist only on this machine, which is how quest-draft.mjs lived.
// Every harness that reads instructions on this machine is listed here, because a file that is only
// installed is a file that gets corrected repeatedly and lost every time: the dev-workflow skill was
// reworded away from "dev release" twice before the wording reached this tree.
for(const path of ['Projects/opencode-hub/AGENTS.md','Projects/opencode-hub/CLAUDE.md','Projects/opencode-hub/MEMORY.md','.agents/matt-pocock.md','.agents/user-verification.md','.agents/.skill-lock.json','.agents/plugins/marketplace.json','.agents/quest.mjs','.agents/quest-draft.mjs','.agents/quest-api.mjs','.codex/AGENTS.md','.codex/config.toml','.claude/CLAUDE.md','.claude/settings.json'])file(path)
for(const path of ['.agents/scripts','.agents/docs','.codex/skills/convex-deploy-guard','.codex/rules'])tree(path)
for(const e of readdirSync(join(home,'.agents/skills'),{withFileTypes:true})){const p='.agents/skills/'+e.name;if(statSync(join(home,p)).isDirectory())tree(p);else file(p)}
// Disabled skills stay disabled but remain reproducible source, including their licenses.
tree('.agents/skills-disabled')
const cache=join(home,'.codex/plugins/cache')
if(existsSync(cache))for(const publisher of readdirSync(cache,{withFileTypes:true}).filter(e=>e.isDirectory()))for(const plugin of readdirSync(join(cache,publisher.name),{withFileTypes:true}).filter(e=>e.isDirectory())){
 const versions=readdirSync(join(cache,publisher.name,plugin.name),{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>e.name)
 dependencies.push({publisher:publisher.name,plugin:plugin.name,installedVersions:versions,ownership:publisher.name==='personal'?'local-source':'external-dependency'})
}
// Claude Code skills are a mix of Jon's own and upstream checkouts. Copying an upstream project into
// this tree would republish someone else's repository under its own licence and bury real config
// under hundreds of vendored files, so those are pinned by origin and commit and the rest is source.
const claudeSkills=join(home,'.claude/skills')
if(existsSync(claudeSkills))for(const e of readdirSync(claudeSkills,{withFileTypes:true}).filter(e=>e.isDirectory())){
 const path='.claude/skills/'+e.name
 let origin,commit
 try{
  origin=execFileSync('git',['-C',join(home,path),'remote','get-url','origin'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim()
  commit=execFileSync('git',['-C',join(home,path),'rev-parse','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim()
 }catch{}
 if(origin)dependencies.push({skill:e.name,target:path,origin,commit,ownership:'external-dependency'})
 else tree(path)
}
writeFileSync('setup/manifest.json',JSON.stringify({schema:1,name:'JonsOCsetup',entries,dependencies,omitted,excluded:['credentials and account tokens','session databases and logs','Quest runtime journals','generated plugin generations and caches','upstream host binaries and source checkouts']},null,2)+'\n')
console.log(JSON.stringify({mappedFiles:entries.length,bytes:entries.reduce((n,e)=>n+statSync(join(root,e.source)).size,0),dependencies:dependencies.length,omitted}))
