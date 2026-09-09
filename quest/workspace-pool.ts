import { spawn } from 'node:child_process'
import { join } from 'node:path'
const scheduled = new Map<string, number>()
/** No model call and no synchronous Git/bootstrap work in the host event loop. */
export function prepareWorkspaceLater(runtime:string,directory:string,policyFile:string) {
 const key=runtime+'\0'+directory, now=Date.now()
 if(now-(scheduled.get(key)??0)<30000)return
 scheduled.set(key,now)
 const child=spawn('bun',[join(import.meta.dir,'workspace-preparer.ts'),runtime,directory,policyFile],{windowsHide:true,stdio:'ignore'})
 child.on('error',error=>console.error('[quests] workspace preparation unavailable',error.message))
 child.unref()
}
