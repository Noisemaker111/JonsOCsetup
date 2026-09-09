import {existsSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'
/** Explicit recipes win. A declared Bun project already specifies its installer;
 * run it only in the owned snapshot, never in the source checkout. */
export function workspaceBootstrap(directory:string,configured?:string[]):string[]|undefined {
 if(configured?.length)return configured
 const manifest=join(directory,'package.json')
 if(!existsSync(manifest))return undefined
 const pkg=JSON.parse(readFileSync(manifest,'utf8'))
 const dependencies=Object.keys({...pkg.dependencies,...pkg.devDependencies,...pkg.optionalDependencies}).length>0||!!pkg.workspaces
 if(!dependencies)return undefined
 if(typeof pkg.packageManager==='string'&&/^bun@\d/.test(pkg.packageManager)){
  const locked=['bun.lock','bun.lockb'].some(name=>existsSync(join(directory,name))&&spawnSync('git',['-C',directory,'cat-file','-e','HEAD:'+name],{windowsHide:true,timeout:15000,stdio:'ignore'}).status===0)
  if(locked)return ['bun','install','--frozen-lockfile']
 }
 throw Error("Configure this project's bootstrap command before creating an editing worker: no supported declared package manager with a committed lockfile")
}
