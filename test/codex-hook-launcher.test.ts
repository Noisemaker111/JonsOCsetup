import {test,expect} from 'bun:test'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'
import {hookLauncherMain} from '../quest/codex/hook-launcher'
function probe(source:string|undefined,event='PostToolUse'){
 const root=mkdtempSync(join(tmpdir(),'hook-reporting-'));mkdirSync(join(root,'scripts'))
 if(source!==undefined)writeFileSync(join(root,'scripts/hook.js'),source)
 try{const r=spawnSync('node',['-e','('+hookLauncherMain.toString()+')()'],{windowsHide:true,encoding:'utf8',input:JSON.stringify({hook_event_name:event,session_id:'fixture',cwd:root}),env:{...process.env,PLUGIN_ROOT:root}});expect(r.status).toBe(0);return JSON.parse(r.stdout)}finally{rmSync(root,{recursive:true,force:true})}
}
test('crashed post hook reports failure without replacing the tool result with bounded redacted stderr',()=>{const r=probe("console.error('FAIL_SENTINEL token=secret-value '+ 'x'.repeat(4000));process.exit(1)");expect(r.decision).toBeUndefined();const message=r.hookSpecificOutput.additionalContext;expect(message).toContain('FAIL_SENTINEL');expect(message).not.toContain('secret-value');expect(message.length).toBeLessThan(2300)})
test('missing hook and invalid JSON are visible; pre-tool failure stays denied',()=>{expect(probe(undefined).hookSpecificOutput.additionalContext).toContain('failed');expect(probe("console.log('broken')").hookSpecificOutput.additionalContext).toContain('invalid JSON');expect(probe('process.exit(2)','PreToolUse').hookSpecificOutput.permissionDecision).toBe('deny')})
test('successful allow and deny outputs pass through without weakening decisions',()=>{for(const permissionDecision of ['allow','deny']){const r={hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision,permissionDecisionReason:'original'}};expect(probe('console.log('+JSON.stringify(JSON.stringify(r))+')','PreToolUse')).toEqual(r)}})
