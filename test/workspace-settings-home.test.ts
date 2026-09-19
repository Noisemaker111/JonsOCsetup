/**
 * @core-prevents temporary launch directories resetting workspace preferences and isolated dev settings overwriting the personal shared-checkout preference
 * @core-observed workspaceSettingsFile and the portable preflight independently used OPENCODE_CONFIG_DIR, which the managed and native launchers replace for every launch; the existing personal setting is shared while dev requires worktree (2026-09-12).
 */
import {test,expect} from 'bun:test'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir,homedir} from 'node:os'
import {workspaceSettingsFile,workspaceSettings,setWorkspaceMode} from '../quest/workspace-settings'
import {readWorkspaceSettings} from '../quest/workspace-settings-lib.mjs'

test('preferences follow the persistent ledger and explicit override, not each launch config',()=>{
 const root=mkdtempSync(join(tmpdir(),'workspace-settings-')),keys=['OPENCODE_QUEST_ROOT','OPENCODE_QUEST_SETTINGS','OPENCODE_CONFIG_DIR','OPENCODE_RELEASE_CHANNEL'] as const
 const before=Object.fromEntries(keys.map(key=>[key,process.env[key]]))
 try{
  delete process.env.OPENCODE_QUEST_SETTINGS
  process.env.OPENCODE_QUEST_ROOT=root;process.env.OPENCODE_RELEASE_CHANNEL='stable'
  const launch=join(root,'launch-one');mkdirSync(launch);writeFileSync(join(launch,'quest-settings.json'),JSON.stringify({version:1,workspaceMode:'worktree'}))
  process.env.OPENCODE_CONFIG_DIR=launch
  const persistent=workspaceSettingsFile();expect(persistent).toBe(join(root,'.opencode','quest-settings.json'))
  setWorkspaceMode('shared')
  process.env.OPENCODE_CONFIG_DIR=join(root,'launch-two')
  expect(workspaceSettings().workspaceMode).toBe('shared')
  expect(readWorkspaceSettings().workspaceMode).toBe('shared')
  expect(JSON.parse(readFileSync(join(launch,'quest-settings.json'),'utf8')).workspaceMode).toBe('worktree')
  process.env.OPENCODE_RELEASE_CHANNEL='dev'
  expect(()=>setWorkspaceMode('shared')).toThrow('Dev sessions require isolated worktrees')
  expect(workspaceSettings().workspaceMode).toBe('shared')
  setWorkspaceMode('worktree');expect(readWorkspaceSettings().workspaceMode).toBe('worktree')
  process.env.OPENCODE_QUEST_SETTINGS=join(root,'explicit.json')
  expect(workspaceSettingsFile()).toBe(join(root,'explicit.json'))
  setWorkspaceMode('worktree');expect(JSON.parse(readFileSync(join(root,'explicit.json'),'utf8')).workspaceMode).toBe('worktree')
  delete process.env.OPENCODE_QUEST_SETTINGS;delete process.env.OPENCODE_QUEST_ROOT
  expect(workspaceSettingsFile()).toBe(join(homedir(),'.config','opencode','quest-settings.json'))
 }finally{for(const key of keys){if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key]}rmSync(root,{recursive:true,force:true})}
})
