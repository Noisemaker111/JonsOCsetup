/** Install normal terminal commands for the already-selected channel runtime. */
import {existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, copyFileSync} from 'node:fs'
import {join} from 'node:path'
import {homedir} from 'node:os'
import {fileURLToPath} from 'node:url'
const home=homedir(), bin=join(home,'.local','bin')
const launcher=join(home,'.config','opencode','.channels','start.mjs')
if(!existsSync(launcher))throw Error('Prepare and activate the dev channel first')
const installed=join(home,'.config','opencode','.channels','direct')
mkdirSync(installed,{recursive:true})
for(const name of ['prepare-direct-channel.mjs','start-direct-channel.ps1'])copyFileSync(fileURLToPath(new URL(name,import.meta.url)),join(installed,name))
const direct=join(installed,'start-direct-channel.ps1')
const marker='rem Managed OpenCode channel shortcut'
const entries=[['ocd','dev'],['ocs','stable']].map(([name,channel])=>({path:join(bin,`${name}.cmd`),body:`@echo off\r\n${marker}\r\npowershell.exe -NoProfile -File "${direct}" ${channel} %*\r\nexit /b %errorlevel%\r\n`}))
for(const {path} of entries)if(existsSync(path)&&!readFileSync(path,'utf8').includes(marker))throw Error('Preserving existing command: '+path)
mkdirSync(bin,{recursive:true})
for(const {path,body} of entries)writeFileSync(path,body)
for(const name of ['opencode-dev','opencode-stable']){const path=join(bin,name+'.cmd');if(existsSync(path)&&readFileSync(path,'utf8').includes(marker))unlinkSync(path)}
// Remove only the known obsolete helper, preserving other profile contents.
const profile=join(home,'Documents','PowerShell','Microsoft.PowerShell_profile.ps1')
if(existsSync(profile)){
 const before=readFileSync(profile,'utf8')
 const after=before.replace(/^function oho \{ oh; & opencode2 @args \}\r?\n/m,'').replace('# oho / ohc / ohcc: cd here, then open opencode2 / Codex / Claude Code in this terminal','# ohc / ohcc: cd here, then open Codex / Claude Code in this terminal')
 if(after!==before){copyFileSync(profile,profile+'.before-channel-shortcuts-'+Date.now()+'.bak');writeFileSync(profile,after)}
}
console.log('Installed: ocd (dev) and ocs (stable). Removed the old managed names and known oho profile helper. Existing terminals need a new shell to forget oho.')
