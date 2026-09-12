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
for(const name of ['prepare-direct-channel.mjs','start-direct-channel.ps1','try-ref.mjs','channel-prepare.mjs'])copyFileSync(fileURLToPath(new URL(name,import.meta.url)),join(installed,name))
const direct=join(installed,'start-direct-channel.ps1')
const marker='rem Managed OpenCode channel shortcut'
const shortcut=lines=>['@echo off',marker,...lines,'exit /b %errorlevel%',''].join('\r\n')
// ocb tries a ref: it prepares or reuses a candidate for that branch and launches it without
// activating anything, so ocd keeps running the release that was actually accepted.
const entries=[
 {path:join(bin,'ocd.cmd'),body:shortcut([`powershell.exe -NoProfile -File "${direct}" dev %*`])},
 {path:join(bin,'ocs.cmd'),body:shortcut([`powershell.exe -NoProfile -File "${direct}" stable %*`])},
 {path:join(bin,'ocb.cmd'),body:shortcut(['if "%~1"=="" (','  echo Name the branch, tag or commit to try: ocb ^<ref^> [--model ^<exact-route^>] [--fresh]','  exit /b 2',')',`powershell.exe -NoProfile -File "${direct}" dev -Try %*`])},
]
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
console.log('Installed: ocd (activated dev), ocs (stable) and ocb <ref> (try a branch without activating it). Removed the old managed names and known oho profile helper. Existing terminals need a new shell to forget oho.')
