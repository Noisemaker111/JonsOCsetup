import {existsSync,readdirSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
import {createHash} from 'node:crypto'

/** Old live dev hosts must not schedule work admitted by a newer immutable generation. */
export function devQueueGeneration(){return process.env.OPENCODE_RELEASE_CHANNEL==='dev'?process.env.OPENCODE_PLUGIN_GENERATION:undefined}
export function runtimeQueuePath(runtime:string,name:string,generation=devQueueGeneration(),suffix=''){
 const key=generation?'-'+createHash('sha256').update(generation).digest('hex').slice(0,24):''
 return join(runtime,name+key+suffix)
}
export function continuationFiles(runtime:string){
 if(!existsSync(runtime))return []
 return readdirSync(runtime).filter(n=>/^continuations(?:-[a-f0-9]{24})?\.json$/.test(n)).map(n=>join(runtime,n))
}
/** Inspection and conflict detection see every generation; schedulers read only their own file. */
export function readContinuations(runtime:string):any[]{return continuationFiles(runtime).flatMap(file=>JSON.parse(readFileSync(file,'utf8')))}
