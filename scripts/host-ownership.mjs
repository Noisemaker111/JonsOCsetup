import {existsSync, mkdirSync, readFileSync, readdirSync, realpathSync} from 'node:fs'
import {dirname, join, resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {createServer} from 'node:net'
import {spawn} from 'node:child_process'
import {tmpdir} from 'node:os'
import {pathToFileURL} from 'node:url'

function alive(pid) {
  if(!Number.isSafeInteger(pid)||pid<1)throw Error('Host receipt has an invalid process identity')
  try {process.kill(pid,0);return true} catch(error){if(error.code==='ESRCH')return false;throw error}
}
function liveHost(questRoot) {
  if(!questRoot)return
  const registry=join(questRoot,'.opencode','.quest-runtime','quest-api')
  if(!existsSync(registry))return
  for(const name of readdirSync(registry).filter(name=>name.endsWith('.json'))){
    const row=JSON.parse(readFileSync(join(registry,name),'utf8'))
    if(alive(row.pid))return row.pid
  }
}
/** Windows pipes and Linux abstract sockets expire with their owning process. */
export async function claimHost({database,questRoot}) {
  if(!database)return {release:async()=>{}}
  const requested=resolve(database);mkdirSync(dirname(requested),{recursive:true})
  const canonical=join(realpathSync(dirname(requested)),requested.slice(dirname(requested).length+1))
  const key=createHash('sha256').update(process.platform==='win32'?canonical.toLowerCase():canonical).digest('hex')
  const address=process.platform==='win32'?`\\\\.\\pipe\\opencode-database-${key}`:process.platform==='linux'?`\0opencode-database-${key}`:join(tmpdir(),`opencode-database-${key}.sock`)
  const server=createServer(socket=>socket.end())
  await new Promise((done,reject)=>{server.once('error',error=>reject(error.code==='EADDRINUSE'?Error('This OpenCode database already has a launcher. Continue in its terminal or use its managed restart; a second standalone host was not started.'):error));server.listen(address,done)})
  const release=()=>new Promise((done,reject)=>server.close(error=>error?reject(error):done()))
  try {
    // Preserve older launchers too. A health timeout is not evidence of exit.
    const legacy=liveHost(questRoot)
    if(legacy)throw Error(`This OpenCode database already has a live host (process ${legacy}). Continue in its terminal or use its managed restart; a second standalone host was not started.`)
    return {release}
  }catch(error){await release();throw error}
}
export async function waitForHostExit(questRoot,timeoutMs=8000) {
  const deadline=Date.now()+timeoutMs
  for(;;){const pid=liveHost(questRoot);if(!pid)return;if(Date.now()>=deadline)throw Error(`The prior native backend ${pid} has not exited; no replacement host was started`);await new Promise(done=>setTimeout(done,50))}
}
async function run() {
  const at=process.argv.indexOf('--'),[executable,...args]=process.argv.slice(at+1)
  if(at<0||!executable)throw Error('Use host-ownership -- <native executable> <arguments>')
  const lease=await claimHost({database:process.env.OPENCODE_DB,questRoot:process.env.OPENCODE_QUEST_ROOT})
  try {
    const child=spawn(executable,args,{stdio:'inherit',windowsHide:false})
    const interrupt=()=>{};process.on('SIGINT',interrupt)
    try {process.exitCode=await new Promise((done,reject)=>{child.once('error',reject);child.once('exit',code=>done(code??1))})}
    finally {process.off('SIGINT',interrupt)}
  }finally {await lease.release()}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await run()
