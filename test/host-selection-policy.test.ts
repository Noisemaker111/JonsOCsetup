import {test,expect} from 'bun:test'
import {readdirSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
test('maintained launch and verification sources never hardcode a parallel host installation',()=>{
 const bad:string[]=[]
 const smoke=readFileSync(join(import.meta.dir,'..','smoke-test.ps1'),'utf8')
 expect(smoke).toContain('scripts/host-status.mjs')
 expect(smoke).not.toContain('node_modules')
 for(const dir of ['scripts','test'])for(const file of readdirSync(join(import.meta.dir,'..',dir))){
  if(!/\.(ts|mjs|ps1)$/.test(file)||file==='host-executable.test.ts')continue
  const text=readFileSync(join(import.meta.dir,'..',dir,file),'utf8')
  if(/@opencode(?:-ai)?[\\/]+cli[\\/]+bin[\\/]+opencode2\.exe/.test(text)||/['"]@opencode(?:-ai)?['"]\s*,\s*['"]cli['"]/.test(text))bad.push(dir+'/'+file)
 }
 expect(bad).toEqual([])
})
