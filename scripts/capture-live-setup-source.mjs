/** Save a bounded source-only snapshot of shared-checkout differences; never apply it. */
import {execFileSync} from 'node:child_process'
import {existsSync,readFileSync,writeFileSync,mkdirSync,lstatSync,realpathSync} from 'node:fs'
import {join,dirname,relative,isAbsolute} from 'node:path'
import {homedir} from 'node:os'
import {createHash} from 'node:crypto'
const live=join(homedir(),'.config/opencode'),root=process.cwd(),out=join(homedir(),'JonsOCsetup-private-recovery',String(Date.now()))
const git=args=>execFileSync('git',['-C',live,...args],{encoding:'utf8',maxBuffer:16*1024*1024}).trim()
const paths=[...new Set([...git(['diff','--name-only','-z','HEAD']).split('\0'),...git(['ls-files','--others','--exclude-standard','-z']).split('\0')])].filter(Boolean)
const skip=/^(?:\.worktrees|\.claude|\.channels|\.git|node_modules|generations|\.visual-e2e|\.candidates|run|tmp)(?:\/|$)/
const records=[],hash=b=>createHash('sha256').update(b).digest('hex')
for(const path of paths){
 if(skip.test(path)||['plugin-activation.json','plugin-health.json'].includes(path))continue
 const from=join(live,path)
 if(!existsSync(from)){records.push({path,state:'deleted-in-live-checkout'});continue}
 const stat=lstatSync(from),rel=relative(realpathSync(live),realpathSync(from))
 if(!stat.isFile()||stat.isSymbolicLink()||isAbsolute(rel)||rel.startsWith('..')||stat.size>2*1024*1024){records.push({path,state:'excluded',reason:'not a bounded local regular source file'});continue}
 const bytes=readFileSync(from)
 if(/(?:sk-(?:proj-)?[A-Za-z0-9_-]{30,}|gh[pousr]_[A-Za-z0-9]{25,}|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----)/.test(bytes.toString())){records.push({path,state:'excluded',reason:'credential-shaped content; private review required'});continue}
 if(!bytes.equals(readFileSync(from)))throw Error('Source changed while reading: '+path)
 if(existsSync(join(root,path))&&readFileSync(join(root,path)).equals(bytes)){records.push({path,state:'matches-dev-source',sha256:hash(bytes)});continue}
 const dest=join(out,'files',path+'.snapshot');mkdirSync(dirname(dest),{recursive:true});writeFileSync(dest,bytes)
 records.push({path,state:'preserved-not-integrated',sha256:hash(bytes),source:dest.replaceAll('\\','/')})
}
mkdirSync(out,{recursive:true});writeFileSync(join(out,'inventory.json'),JSON.stringify({capturedAt:new Date().toISOString(),base:git(['rev-parse','HEAD']),policy:'Per-file preservation only, not a coherent release snapshot. Never installed or integrated automatically. Live checkout/index/ownership untouched.',records},null,2)+'\n')
console.log(JSON.stringify(records.reduce((counts,r)=>(counts[r.state]=(counts[r.state]??0)+1,counts),{})))
