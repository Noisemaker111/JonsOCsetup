import {test,expect} from 'bun:test'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {reviewedAgentConfig} from '../scripts/runtime-contract.mjs'
test('managed host uses reviewed agent permissions without copying live dirty configuration',()=>{
 const root=mkdtempSync(join(tmpdir(),'reviewed-agent-'));try{mkdirSync(join(root,'generations/g'),{recursive:true});writeFileSync(join(root,'generations/g/plugin-set.json'),'{}');writeFileSync(join(root,'generations/g/opencode.jsonc'),JSON.stringify({default_agent:'quest-giver',agents:{'quest-giver':{permissions:[{action:'project_discover',effect:'allow',resource:'*'}]}}}));writeFileSync(join(root,'opencode.jsonc'),'dirty unreviewed content');expect(JSON.parse(reviewedAgentConfig(root,'g')).agents['quest-giver'].permissions[0].action).toBe('project_discover');expect(()=>reviewedAgentConfig(root,'missing')).toThrow('missing')}finally{rmSync(root,{recursive:true,force:true})}
})
