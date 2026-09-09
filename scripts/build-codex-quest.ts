/** Build a standalone Codex adapter candidate; never install, activate, publish or migrate. */
import {mkdirSync,existsSync,writeFileSync,copyFileSync,readFileSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {createHash} from 'node:crypto'
import {hookLauncherCommand} from '../quest/codex/hook-launcher'
export async function buildCodexQuest(output:string){
 const root=resolve(import.meta.dir,'..');output=resolve(output)
 if(existsSync(output))throw new Error('Candidate output already exists')
 mkdirSync(join(output,'scripts'),{recursive:true});mkdirSync(join(output,'.codex-plugin'));mkdirSync(join(output,'skills','quest'),{recursive:true});mkdirSync(join(output,'hooks'))
 const result=await Bun.build({entrypoints:[join(root,'quest/mcp-server.ts'),join(root,'quest/codex/hook.ts'),join(root,'quest/codex/recovery-command.ts')],target:'bun',outdir:join(output,'scripts'),naming:'[name].js'})
 if(!result.success)throw new AggregateError(result.logs,'Codex adapter build failed')
 const json=(file:string,value:unknown)=>writeFileSync(join(output,file),JSON.stringify(value,null,2)+'\n')
 json('.codex-plugin/plugin.json',{name:'opencode-quests',version:'0.0.0',description:'Shared Quests with runtime checkout coordination for Codex.',skills:'./skills/',mcpServers:'./.mcp.json',author:{name:'Noisemaker111'},interface:{displayName:'Quest',shortDescription:'Shared Quests in Codex',longDescription:'Create and resume shared Quests with runtime checkout coordination.',developerName:'Noisemaker111',category:'Productivity',capabilities:['Read','Write'],defaultPrompt:['Show my current Quests.']}})
 json('.mcp.json',{mcpServers:{quest:{type:'stdio',command:'bun',cwd:'.',args:['scripts/mcp-server.js']}}})
 const handler={type:"command",command:hookLauncherCommand(),command_windows:hookLauncherCommand()}
 json('hooks/hooks.json',{hooks:Object.fromEntries(['SessionStart','PreToolUse','PostToolUse','SessionEnd'].map(event=>[event,[{hooks:[{...handler,timeout:event==='SessionEnd'?3:30}]}]]))})
 copyFileSync(join(root,'quest/codex/SKILL.md'),join(output,'skills/quest/SKILL.md'));copyFileSync(join(root,'LICENSE'),join(output,'LICENSE'))
 json('package.json',{name:'opencode-quests',version:'0.0.0',private:true,type:'module'})
 const files=['scripts/mcp-server.js','scripts/hook.js','scripts/recovery-command.js','.codex-plugin/plugin.json','.mcp.json','hooks/hooks.json','skills/quest/SKILL.md']
 json('receipt.json',{builtAt:new Date().toISOString(),files:files.map(path=>({path,sha256:createHash('sha256').update(readFileSync(join(output,path))).digest('hex')})),policy:'Candidate only. No installed files or shared records changed by this build.'})
 return output
}
if(import.meta.main)console.log(await buildCodexQuest(process.argv[2]??'.candidates/codex-quest'))
