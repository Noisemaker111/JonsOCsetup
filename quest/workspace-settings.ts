import {existsSync,readFileSync,mkdirSync,writeFileSync,renameSync} from 'node:fs'
import {join,dirname,resolve} from 'node:path'
import {homedir,tmpdir} from 'node:os'
import {createHash} from 'node:crypto'
import {acquireLock} from './locking'
export type WorkspaceMode='worktree'|'shared'
export const workspaceSettingsFile=()=>process.env.OPENCODE_QUEST_SETTINGS??join(process.env.OPENCODE_CONFIG_DIR??join(homedir(),'.config','opencode'),'quest-settings.json')
export function workspaceSettings(file=workspaceSettingsFile()):{version:1;workspaceMode:WorkspaceMode} {
 if(!existsSync(file))return {version:1,workspaceMode:'worktree'}
 const value=JSON.parse(readFileSync(file,'utf8'))
 if(value.version!==1||!['worktree','shared'].includes(value.workspaceMode))throw new Error('Invalid Quest workspace settings; preserve and repair the configuration')
 return value
}
export function setWorkspaceMode(mode:WorkspaceMode,file=workspaceSettingsFile()) {
 if(!['worktree','shared'].includes(mode))throw new Error('Workspace mode must be worktree or shared')
 // Dev keeps an isolated ledger and rejects shared checkout writes at dispatch. Accepting
 // the mode here only defers that failure until a worker has already been planned.
 if(mode==='shared'&&process.env.OPENCODE_RELEASE_CHANNEL==='dev')throw new Error('Dev sessions require isolated worktrees; shared checkout mode is unavailable on this channel')
 const lock=acquireLock(join(tmpdir(),'opencode-settings'),createHash('sha256').update(resolve(file)).digest('hex'))
 try {const value={...workspaceSettings(file),workspaceMode:mode};mkdirSync(dirname(file),{recursive:true});const temp=file+'.'+process.pid+'.tmp';writeFileSync(temp,JSON.stringify(value,null,2)+'\n');renameSync(temp,file);return {...value,appliesTo:'future runs; existing workspaces stay in place'}}finally{lock.release()}
}
