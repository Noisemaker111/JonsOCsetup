import {closeSync,openSync,readSync,realpathSync,statSync} from 'node:fs'
import {extname,isAbsolute,relative,resolve,sep} from 'node:path'
import {pathToFileURL} from 'node:url'
import {redact} from './privacy'
import type {QuestArtifact} from './artifacts'

/** Bounded, read-only previews of recorded artifacts inside their recorded workspaces. */
export function artifactPreview(artifact:QuestArtifact,roots:string[],relativeBase?:string):{kind:string;lines:string[];uri?:string}{
 if(!artifact.path)return {kind:'Link',lines:[artifact.label??artifact.uri??'No file recorded'],uri:artifact.uri}
 const allowed=roots.flatMap(root=>{try{return [realpathSync(root)]}catch{return []}})
 const candidates=isAbsolute(artifact.path)?[artifact.path]:[...roots,...relativeBase?[relativeBase]:[]].map(root=>resolve(root,artifact.path!))
 for(const candidate of candidates){
  let file:string
  try{file=realpathSync(candidate)}catch{continue}
  if(!allowed.some(root=>{const r=relative(root,file);return r!==''&&!r.startsWith('..'+sep)&&r!=='..'&&!isAbsolute(r)}))continue
  if(/(^|[\\/])(?:\.env(?:\.[^\\/]*)?|auth\.json|credentials[^\\/]*|\.git)([\\/]|$)/i.test(file))return {kind:'File',lines:['Preview unavailable']}
  try{
   if(!statSync(file).isFile())continue
   const fd=openSync(file,'r'),bytes=Buffer.alloc(4096);let n:number
   try{n=readSync(fd,bytes,0,bytes.length,0)}finally{closeSync(fd)}
   const data=bytes.subarray(0,n),uri=pathToFileURL(file).href,extension=extname(file).toLowerCase()
   if(extension==='.png'&&data.length>=24&&data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return {kind:'Image',lines:['PNG '+data.readUInt32BE(16)+' × '+data.readUInt32BE(20),'Open image to view'],uri}
   if(!/\.(txt|md|log|diff|patch|ts|tsx|js|jsx|mjs|cjs|css|html|json|ya?ml|ps1|toml|xml|csv)$/.test(extension)||data.includes(0))return {kind:'File',lines:['Open recorded artifact'],uri}
   const lines=data.toString('utf8').split(/\r?\n/).filter(line=>line.trim()).slice(0,4).map(line=>redact(line,100))
   return {kind:'Text',lines:lines.length?lines:['Empty file'],uri}
  }catch{return {kind:'File',lines:['File unavailable']}}
 }
 return {kind:'File',lines:['File unavailable in recorded workspace']}
}
