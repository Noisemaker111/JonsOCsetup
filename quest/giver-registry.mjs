/** One user-facing giver per isolated Quest runtime. Old sessions remain history. */
import {existsSync,readFileSync,writeFileSync,mkdirSync,renameSync} from 'node:fs'
import {join} from 'node:path'
export const giverFile=runtime=>join(runtime,'user-giver.json')
export function readUserGiver(runtime){const file=giverFile(runtime);if(!existsSync(file))return;const row=JSON.parse(readFileSync(file,'utf8'));if(row.version!==1||!['bound','launching','unknown'].includes(row.state)||row.state==='bound'&&!/^ses_[A-Za-z0-9_-]+$/.test(row.sessionID??''))throw Error('User giver registration is invalid; inspect it without creating another giver');return row}
export function saveUserGiver(runtime,row){mkdirSync(runtime,{recursive:true});const file=giverFile(runtime),tmp=file+'.'+process.pid+'.tmp';writeFileSync(tmp,JSON.stringify({...row,version:1,updatedAt:new Date().toISOString()}));renameSync(tmp,file)}
/**
 * Release the binding so the next request establishes a new giver.
 *
 * One persistent giver is the point: every project reports to the same conversation. But the
 * binding had no way out, so a giver whose context had grown past usefulness could not be
 * succeeded without editing state by hand. The old session and its Quests are untouched -- this
 * only stops the router from insisting on it. Returns the released session id, or undefined when
 * nothing was bound.
 */
export function releaseUserGiver(runtime){
 const file=giverFile(runtime)
 if(!existsSync(file))return
 const row=JSON.parse(readFileSync(file,'utf8'))
 const previous=file+'.released-'+Date.now()+'.json'
 renameSync(file,previous)
 return row?.sessionID
}
