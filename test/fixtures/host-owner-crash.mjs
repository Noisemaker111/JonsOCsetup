import {claimHost} from '../../scripts/host-ownership.mjs'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
const database=process.argv[2]
if(process.argv[3]==='child'){
  await claimHost({database});console.log('ready')
  process.stdin.resume();process.stdin.on('end',()=>process.exit(17))
}else{
  const child=spawn(process.execPath,[fileURLToPath(import.meta.url),database,'child'],{windowsHide:true,stdio:['pipe','pipe','inherit']})
  await once(child.stdout,'data')
  await assert.rejects(claimHost({database}),/already has a launcher/)
  const ended=once(child,'exit');child.stdin.end();assert.equal((await ended)[0],17)
  const recovered=await claimHost({database});await recovered.release()
  console.log('competing launch rejected; process exit released ownership; same database reopened')
}
