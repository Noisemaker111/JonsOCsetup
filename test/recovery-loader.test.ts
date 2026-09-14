/** @core-prevents recovery rewriting from exposing inline executable payloads or running tampered staged helpers
 * @core-observed The installed recovery hook rewrote ordinary commands into a verbose Base64 Bun --eval wrapper rejected by approval review. */
import {test,expect} from 'bun:test'
import {mkdtempSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {stagedRecoveryCommand} from '../quest/codex/runtime'

test('named loader verifies staged bytes before executing through PowerShell',async()=>{
 const root=mkdtempSync(join(tmpdir(),'recovery-loader-'))
 const runner=join(root,'recovery-command.js'),ticket=join(root,randomUUID()+'.json')
 const built=await Bun.build({entrypoints:[join(import.meta.dir,'../quest/codex/recovery-loader.ts')],target:'bun',outdir:root,naming:'[name].js'})
 expect(built.success).toBe(true)
 writeFileSync(runner,"export async function runRecoveryTicket(ticket,hash){console.log('VERIFIED '+hash)}")
 writeFileSync(ticket,'{}')
 const staged=stagedRecoveryCommand(runner,{command:'unused',ticket})
 expect(staged.command).not.toContain('--eval')
 expect(staged.command).not.toContain('Buffer.from')
 const run=()=>spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',staged.command],{encoding:'utf8',windowsHide:true})
 const good=run();expect(good.status).toBe(0);expect(good.stdout).toContain('VERIFIED ')
 writeFileSync(join(staged.ticket,'..','recovery-command.js'),"throw Error('UNVERIFIED EXECUTION')")
 const bad=run();expect(bad.status).not.toBe(0);expect(bad.stderr).toContain('Recovery helper digest mismatch');expect(bad.stderr).not.toContain('UNVERIFIED EXECUTION')
})
