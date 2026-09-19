import {mkdirSync,writeFileSync,renameSync} from 'node:fs'
import {join,dirname,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {createHash} from 'node:crypto'
import {acquireLock} from './locking'
export type WorkspaceMode='worktree'|'shared'
export {workspaceSettingsFile} from './workspace-settings-lib.mjs'
import {workspaceSettingsFile,readWorkspaceSettings} from './workspace-settings-lib.mjs'
export function workspaceSettings(file=workspaceSettingsFile()):{version:1;workspaceMode:WorkspaceMode} {return readWorkspaceSettings(file)}
export function setWorkspaceMode(mode:WorkspaceMode,file=workspaceSettingsFile()) {
 if(!['worktree','shared'].includes(mode))throw new Error('Workspace mode must be worktree or shared')
 // Dev keeps an isolated ledger and rejects shared checkout writes at dispatch. Accepting
 // the mode here only defers that failure until a worker has already been planned.
 if(mode==='shared'&&process.env.OPENCODE_RELEASE_CHANNEL==='dev')throw new Error('Dev sessions require isolated worktrees; shared checkout mode is unavailable on this channel')
 const lock=acquireLock(join(tmpdir(),'opencode-settings'),createHash('sha256').update(resolve(file)).digest('hex'))
 try {const value={...workspaceSettings(file),workspaceMode:mode};mkdirSync(dirname(file),{recursive:true});const temp=file+'.'+process.pid+'.tmp';writeFileSync(temp,JSON.stringify(value,null,2)+'\n');renameSync(temp,file);return {...value,appliesTo:'future runs; existing workspaces stay in place'}}finally{lock.release()}
}
