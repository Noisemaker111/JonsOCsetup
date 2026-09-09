import {expect,test} from "bun:test"
import {configuredCommand,runKnownCommand} from "../quest/command-runtime"
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from "node:fs"
import {join} from "node:path"
import {tmpdir} from "node:os"
test("command watcher observes timeout and output without a model or arbitrary interpolation",async()=>{const dir=mkdtempSync(join(tmpdir(),"quest-command-"));try{const result=await runKnownCommand({description:"Wait",argv:[process.execPath,"-e","console.log('ready');setInterval(()=>{},1000)"],timeoutMilliseconds:1000},dir,join(dir,"output.log"));expect(result.timedOut).toBe(true);expect(readFileSync(result.logFile,"utf8")).toContain("ready");const policy=join(dir,"policy.json");writeFileSync(policy,JSON.stringify({version:1,commandsByProject:{}}));expect(()=>configuredCommand(policy,"project","arbitrary-command")).toThrow("not configured")}finally{rmSync(dir,{recursive:true,force:true})}})
