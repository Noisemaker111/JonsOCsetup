/** One user-facing giver per isolated Quest runtime. Old sessions remain history. */
import {existsSync,readFileSync,writeFileSync,mkdirSync,renameSync} from 'node:fs'
import {join} from 'node:path'
export const giverFile=runtime=>join(runtime,'user-giver.json')
export function readUserGiver(runtime){const file=giverFile(runtime);if(!existsSync(file))return;const row=JSON.parse(readFileSync(file,'utf8'));if(row.version!==1||!['bound','launching','unknown'].includes(row.state)||row.state==='bound'&&!/^ses_[A-Za-z0-9_-]+$/.test(row.sessionID??''))throw Error('User giver registration is invalid; inspect it without creating another giver');return row}
export function saveUserGiver(runtime,row){mkdirSync(runtime,{recursive:true});const file=giverFile(runtime),tmp=file+'.'+process.pid+'.tmp';writeFileSync(tmp,JSON.stringify({...row,version:1,updatedAt:new Date().toISOString()}));renameSync(tmp,file)}
