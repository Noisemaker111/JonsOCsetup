/** Trusted recovery loader library. Staged bytes never become executable before
 * their digest is checked; import those exact bytes without reopening the file. */
import * as fs from 'node:fs'
import * as path from 'node:path'
import {createHash} from 'node:crypto'

export function checkRecoveryPath(p:string){
 for(let a=path.resolve(p);;a=path.dirname(a)){
  if(fs.lstatSync(a).isSymbolicLink()||fs.realpathSync(a)!==a)throw Error('Recovery path contains a symlink/junction')
  if(path.dirname(a)===a)break
 }
}
export function readRecoveryFile(p:string){
 p=path.resolve(p);checkRecoveryPath(p)
 const before=fs.lstatSync(p)
 if(!before.isFile()||before.nlink!==1||before.size>8*1024*1024)throw Error('Recovery file must be a bounded unlinked regular file')
 const fd=fs.openSync(p,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0))
 try{
  const opened=fs.fstatSync(fd)
  if(!opened.isFile()||opened.dev!==before.dev||opened.ino!==before.ino)throw Error('Recovery file replaced')
  const bytes=Buffer.alloc(before.size)
  let offset=0
  while(offset<bytes.length){const n=fs.readSync(fd,bytes,offset,bytes.length-offset,null);if(!n)throw Error('Recovery file shortened');offset+=n}
  const after=fs.fstatSync(fd);checkRecoveryPath(p)
  if(after.size!==before.size||after.mtimeMs!==before.mtimeMs)throw Error('Recovery file changed')
  return bytes
 }finally{fs.closeSync(fd)}
}
export async function loadRecovery(runner:string,hash:string,ticket:string,ticketHash:string){
 if(!/^[a-f0-9]{64}$/.test(hash)||!/^[a-f0-9]{64}$/.test(ticketHash))throw Error('Invalid recovery digest')
 const bytes=readRecoveryFile(runner)
 if(createHash('sha256').update(bytes).digest('hex')!==hash)throw Error('Recovery helper digest mismatch')
 const module=await import('data:text/javascript;base64,'+bytes.toString('base64'))
 await module.runRecoveryTicket(ticket,ticketHash)
}
