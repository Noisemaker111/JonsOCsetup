/** Connect the hub's editing surface to the public source checkout, preserving runtime state. */
import {existsSync, lstatSync, realpathSync, symlinkSync} from 'node:fs'
import {join} from 'node:path'
import {homedir} from 'node:os'
import {execFileSync} from 'node:child_process'

const home=homedir(),source=join(home,'Projects','JonsOCsetup'),hub=join(home,'Projects','opencode-hub'),link=join(hub,'source')
const origin=execFileSync('git',['-C',source,'remote','get-url','origin'],{encoding:'utf8',windowsHide:true}).trim()
if(!/Noisemaker111[\/]JonsOCsetup(?:\.git)?$/i.test(origin))throw Error('Hub source is not the configured JonsOCsetup repository')
const expected=realpathSync(source)
if(existsSync(link)){
  if(!lstatSync(link).isSymbolicLink()||realpathSync(link).toLowerCase()!==expected.toLowerCase())throw Error('Hub source already exists elsewhere; preserved for inspection')
}else symlinkSync(expected,link,'junction')
console.log(JSON.stringify({source:expected,hubSource:link,runtime:join(home,'.config','opencode')}))
