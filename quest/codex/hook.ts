import {codexHook} from "./runtime"
let raw="";for await(const part of process.stdin)raw+=part;try{console.log(JSON.stringify(codexHook(JSON.parse(raw))))}catch(error){console.error("Quest runtime: "+(error instanceof Error?error.message:String(error)));process.exitCode=2}
