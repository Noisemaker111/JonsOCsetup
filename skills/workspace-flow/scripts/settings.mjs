/** One read-only settings lookup shared by the runtime and portable workspace preflight. */
import {existsSync,readFileSync} from 'node:fs'
import {join,isAbsolute,normalize,parse} from 'node:path'
import {homedir} from 'node:os'
const absolute=(value,name)=>{
 if(!isAbsolute(value)||(process.platform==='win32'&&parse(normalize(value)).root==='\\'))throw Error(name+' must be an absolute path independent of the project directory')
 return normalize(value)
}
export function workspaceSettingsFile(env=process.env){
 const explicit=(env.OPENCODE_QUEST_SETTINGS??'').trim()
 if(explicit)return absolute(explicit,'OPENCODE_QUEST_SETTINGS')
 const ledger=(env.OPENCODE_QUEST_ROOT??'').trim()
 if(ledger)return join(absolute(ledger,'OPENCODE_QUEST_ROOT'),'.opencode','quest-settings.json')
 // Keep the existing personal preference for ordinary, unpinned use. A dev/isolated
 // ledger owns its own settings, so personal shared mode never leaks into dev.
 return join(homedir(),'.config','opencode','quest-settings.json')
}
export function readWorkspaceSettings(file=workspaceSettingsFile()){
 if(!existsSync(file))return {version:1,workspaceMode:'worktree'}
 const value=JSON.parse(readFileSync(file,'utf8'))
 if(value.version!==1||!['worktree','shared'].includes(value.workspaceMode))throw Error('Invalid Quest workspace settings; preserve and repair the configuration')
 return value
}
