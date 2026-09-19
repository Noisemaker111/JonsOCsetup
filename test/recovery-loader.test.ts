/** @core-prevents recovery rewriting from exposing inline executable payloads or running tampered staged helpers
 * @core-observed The installed recovery hook rewrote ordinary commands into a verbose Base64 Bun --eval wrapper rejected by approval review. */
import {test,expect} from 'bun:test'
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {codexHook,stagedRecoveryCommand} from '../quest/codex/runtime'
import {QuestStore} from '../quest/store'
import {buildCodexQuest} from '../scripts/build-codex-quest'

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
 const invalid=spawnSync('bun',[join(root,'recovery-loader.js'),runner,'invalid',ticket,'invalid'],{encoding:'utf8',windowsHide:true})
 expect(invalid.status).not.toBe(0);expect(invalid.stderr).toContain('Invalid recovery digest')
 writeFileSync(join(staged.ticket,'..','recovery-command.js'),"throw Error('UNVERIFIED EXECUTION')")
 const bad=run();expect(bad.status).not.toBe(0);expect(bad.stderr).toContain('Recovery helper digest mismatch');expect(bad.stderr).not.toContain('UNVERIFIED EXECUTION')
})

/** @core-observed On September 19 the bundled hook imported the loader's CLI main, so a stale recovery ticket made every PreToolUse event fail with "Invalid recovery digest" before the unrelated tool was inspected. */
test('the built hook leaves an unrelated tool usable beside stale recovery bookkeeping',async()=>{
 const root=mkdtempSync(join(tmpdir(),'recovery-hook-')),cwd=join(root,'project'),candidate=join(root,'candidate'),session='stale-recovery-session'
 mkdirSync(cwd)
 try{
  const store=new QuestStore(root)
  codexHook({session_id:session,cwd,hook_event_name:'SessionStart'},store)
  const journal=join(store.runtime,'codex',createHash('sha256').update(session).digest('hex')+'.json')
  const state=JSON.parse(readFileSync(journal,'utf8'))
  const staleTicket=join(root,randomUUID()+'.json')
  state.pending=['old-tool']
  state.calls={'old-tool':{tool:'Bash',fingerprint:'old',updatedInput:{command:"& bun 'recovery-loader.js' 'runner.js' 'invalid' 'ticket.json' 'invalid'"},recoveryTicket:staleTicket}}
  writeFileSync(journal,JSON.stringify(state))
  await buildCodexQuest(candidate)
  const input={session_id:session,cwd,hook_event_name:'PreToolUse',tool_name:'mcp__docs__search_docs',tool_use_id:'unrelated-tool',tool_input:{library:'x',query:'y'}}
  const run=spawnSync(process.execPath,[join(candidate,'scripts','hook.js')],{input:JSON.stringify(input),encoding:'utf8',windowsHide:true,env:{...process.env,OPENCODE_QUEST_ROOT:root}})
  expect(run.status).toBe(0)
  expect(run.stderr).not.toContain('Invalid recovery digest')
  expect(JSON.parse(run.stdout)).toEqual({})
  expect(JSON.parse(readFileSync(journal,'utf8')).calls['old-tool'].recoveryTicket).toBe(staleTicket)
 }finally{rmSync(root,{recursive:true,force:true})}
})
