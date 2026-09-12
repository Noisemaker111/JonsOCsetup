/**
 * Install the one terminal command that opens OpenCode.
 *
 * There were five names for two things: `oca` and `ocd` both opened the activated dev release by two
 * different launch paths, `ocm` and `ocs` both opened stable, `ocb` opened a branch -- and `oc`
 * opened nothing at all, it changed directory. Jon had to remember which spelling belonged to which
 * path. Now `oc` is the launcher, a branch name is its argument, and `oh` keeps the directory job.
 */
import {existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, copyFileSync} from 'node:fs'
import {join} from 'node:path'
import {homedir} from 'node:os'
import {fileURLToPath} from 'node:url'
const home=homedir(), bin=join(home,'.local','bin')
const launcher=join(home,'.config','opencode','.channels','start.mjs')
if(!existsSync(launcher))throw Error('Prepare and activate the dev channel first')
const installed=join(home,'.config','opencode','.channels','direct')
mkdirSync(installed,{recursive:true})
for(const name of ['prepare-direct-channel.mjs','start-direct-channel.ps1','try-ref.mjs','channel-prepare.mjs','oc-source.mjs'])copyFileSync(fileURLToPath(new URL(name,import.meta.url)),join(installed,name))
const direct=join(installed,'start-direct-channel.ps1')
const marker='rem Managed OpenCode channel shortcut'
const command={path:join(bin,'oc.cmd'),body:['@echo off',marker,`powershell.exe -NoProfile -File "${direct}" %*`,'exit /b %errorlevel%',''].join('\r\n')}
if(existsSync(command.path)&&!readFileSync(command.path,'utf8').includes(marker))throw Error('Preserving existing command: '+command.path)
mkdirSync(bin,{recursive:true})
writeFileSync(command.path,command.body)
// Remove only the names this installer wrote. Anything without the marker is somebody else's.
const superseded=[]
for(const name of ['ocd','ocs','ocb','opencode-dev','opencode-stable']){
 const path=join(bin,name+'.cmd')
 if(existsSync(path)&&readFileSync(path,'utf8').includes(marker)){unlinkSync(path);superseded.push(name)}
}

/**
 * The profile's own launchers are superseded too, and leaving them would win: a PowerShell function
 * beats a command on PATH, so `oc` would keep changing directory. Each is removed by its exact
 * recorded text, so an edited one is preserved rather than guessed at, and the file is backed up
 * before anything changes.
 */
const profile=join(home,'Documents','PowerShell','Microsoft.PowerShell_profile.ps1')
const removedFromProfile=[]
if(existsSync(profile)){
 const before=readFileSync(profile,'utf8')
 let after=before
 const drop=(label,pattern)=>{const next=after.replace(pattern,'');if(next!==after){after=next;removedFromProfile.push(label)}}
 drop('oc (cd alias)',/^function oc \{ oh \}\r?\n/m)
 drop('oho',/^function oho \{ oh; & opencode2 @args \}\r?\n/m)
 drop('ocm',/^function ocm \{ Start-OcChannel -Channel stable -Rest \$args \}\r?\n?/m)
 drop('oca',/^function oca \{ Start-OcChannel -Channel dev -Rest \$args \}\r?\n?/m)
 drop('Start-OcChannel',/^function Start-OcChannel \{[\s\S]*?\n\}\r?\n/m)
 drop('Get-OcRuntimeScript',/^function Get-OcRuntimeScript \{[\s\S]*?\n\}\r?\n/m)
 after=after
  .replace('# oho / ohc / ohcc: cd here, then open opencode2 / Codex / Claude Code in this terminal','# ohc / ohcc: cd here, then open Codex / Claude Code in this terminal')
  .replace(/^# OpenCode launchers\. ocm is stable \(main\), oca is the agents integration release\.\r?\n(^#.*\r?\n)*/m,'# OpenCode itself is opened with `oc` (installed by install-channel-shortcuts.mjs), not from here.\n')
 if(after!==before){copyFileSync(profile,profile+'.before-channel-shortcuts-'+Date.now()+'.bak');writeFileSync(profile,after)}
}
console.log(JSON.stringify({installed:'oc',usage:['oc (latest merged agents)','oc <branch>','oc --gated','oc --default branch|gated','oc --stable','oc --here','oc <branch> --fresh|--model <route>'],superseded,removedFromProfile,note:'Open terminals keep the old profile functions until you start a new shell.'},null,2))
