import {test,expect} from 'bun:test'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {resolveHostExecutable} from '../project-router/executable.mjs'
test('native resolution follows the installed shim even with both packages present',()=>{
 const root=mkdtempSync(join(tmpdir(),'host-choice-'));try{
  for(const ns of ['@opencode','@opencode-ai']){const bin=join(root,'npm/node_modules',ns,'cli/bin');mkdirSync(bin,{recursive:true});writeFileSync(join(bin,'opencode2.exe'),'fixture')}
  writeFileSync(join(root,'npm/opencode2.ps1'),'& "$basedir/node_modules/@opencode/cli/bin/opencode2.exe"')
  expect(resolveHostExecutable({APPDATA:root},'win32')).toBe(join(root,'npm/node_modules/@opencode/cli/bin/opencode2.exe'))
  writeFileSync(join(root,'npm/opencode2.ps1'),'& "$basedir/node_modules/@opencode-ai/cli/bin/opencode2.exe"')
  expect(resolveHostExecutable({APPDATA:root},'win32')).toBe(join(root,'npm/node_modules/@opencode-ai/cli/bin/opencode2.exe'))
  writeFileSync(join(root,'npm/opencode2.cmd'),'node_modules/@opencode/cli/bin/opencode2.exe')
  expect(()=>resolveHostExecutable({APPDATA:root},'win32')).toThrow('launchers disagree')
  writeFileSync(join(root,'npm/opencode2.ps1'),'unknown wrapper')
  expect(()=>resolveHostExecutable({APPDATA:root},'win32')).toThrow('Cannot resolve')
 }finally{rmSync(root,{recursive:true,force:true})}
})
test('explicit verified host is retained and conflicting overrides are explicit',()=>{
 expect(resolveHostExecutable({OPENCODE2_EXE:'verified.exe'},'win32')).toBe('verified.exe')
 expect(resolveHostExecutable({OPENCODE_PROJECT_ROUTER_CLI:'route.exe'},'win32')).toBe('route.exe')
 expect(()=>resolveHostExecutable({OPENCODE2_EXE:'one.exe',OPENCODE_PROJECT_ROUTER_CLI:'two.exe'},'win32')).toThrow('Conflicting')
 expect(resolveHostExecutable({},'linux')).toBe('opencode2')
})
