import {test,expect} from 'bun:test'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {spawnSync} from 'node:child_process'
import {workspaceBootstrap} from '../quest/workspace-bootstrap'
import {QuestWorkspaces} from '../quest/workspaces'
test('declared Bun workspace bootstraps its owned snapshot with the unchanged lockfile',()=>{
 const root=mkdtempSync(join(tmpdir(),'bootstrap-runtime-')),repo=join(root,'repo');mkdirSync(repo)
 try{
 writeFileSync(join(repo,'package.json'),JSON.stringify({name:'fixture',packageManager:'bun@1.3.14',workspaces:['packages/*']}));mkdirSync(join(repo,'packages','child'),{recursive:true});writeFileSync(join(repo,'packages','child','package.json'),JSON.stringify({name:'fixture-child',version:'1.0.0'}));writeFileSync(join(repo,'.gitignore'),'node_modules/\n.claude/\n')
 const install=spawnSync(process.execPath,['install','--ignore-scripts'],{cwd:repo,windowsHide:true,encoding:'utf8'});expect(install.status).toBe(0)
 for(const args of [['init'],['add','package.json','bun.lock','packages','.gitignore'],['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','Fixture']])expect(spawnSync('git',args,{cwd:repo,windowsHide:true}).status).toBe(0)
 const lock=readFileSync(join(repo,'bun.lock'),'utf8'),manager=new QuestWorkspaces(join(root,'runtime')),w=manager.create({runID:'prepared',questID:'q',directory:repo})
 expect(w.bootstrapComplete).toBe(true);expect(w.path).not.toBe(repo);expect(readFileSync(join(w.path,'bun.lock'),'utf8')).toBe(lock);expect(readFileSync(join(repo,'bun.lock'),'utf8')).toBe(lock)
 }finally{rmSync(root,{recursive:true,force:true})}
},60000)
test('explicit recipes win and ambiguous dependency projects still need a recipe',()=>{
 const root=mkdtempSync(join(tmpdir(),'bootstrap-runtime-'))
 try{writeFileSync(join(root,'package.json'),JSON.stringify({dependencies:{example:'1.0.0'}}));expect(workspaceBootstrap(root,['custom','setup'])).toEqual(['custom','setup']);expect(()=>workspaceBootstrap(root)).toThrow('no supported declared package manager');writeFileSync(join(root,'package.json'),JSON.stringify({name:'docs-only'}));expect(workspaceBootstrap(root)).toBeUndefined()}finally{rmSync(root,{recursive:true,force:true})}
})

test('untracked or ignored Bun lockfiles cannot authorize inferred bootstrap',()=>{
 const root=mkdtempSync(join(tmpdir(),'bootstrap-runtime-'))
 try{
  writeFileSync(join(root,'package.json'),JSON.stringify({name:'fixture',packageManager:'bun@1.3.14',dependencies:{fixture:'1.0.0'}}));writeFileSync(join(root,'bun.lock'),'{}')
  for(const args of [['init'],['add','package.json'],['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','manifest']])expect(spawnSync('git',args,{cwd:root,windowsHide:true}).status).toBe(0)
  expect(()=>workspaceBootstrap(root)).toThrow('committed lockfile')
  writeFileSync(join(root,'.gitignore'),'bun.lock\n');expect(()=>workspaceBootstrap(root)).toThrow('committed lockfile')
  expect(workspaceBootstrap(root,['custom','install'])).toEqual(['custom','install'])
 }finally{rmSync(root,{recursive:true,force:true})}
})
