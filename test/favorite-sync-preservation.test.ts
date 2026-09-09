import {test,expect} from "bun:test"
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from "node:fs"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {syncFavoriteAgents} from "../models/favorite-agents"
test("inventory sync preserves legacy records, agent files, custom config and favorite state byte-for-byte",()=>{
 const dir=mkdtempSync(join(tmpdir(),"favorite-preservation-")),agentDirectory=join(dir,"agent"),configFile=join(dir,"opencode.jsonc"),stateFile=join(dir,"model.json");mkdirSync(agentDirectory)
 const files=new Map([[configFile,'{\n  "agents": {"model-personal": {"model":"provider/model","description":"user edited"}}\n}\n'],[stateFile,JSON.stringify({favorite:[{providerID:"provider",modelID:"model"}],recent:["keep"]})],[join(agentDirectory,"model-personal.md"),"User-edited worker"],...['TODO.md','TEAMWORK.md','DONE.md'].map(name=>[join(dir,name),"Preserve "+name] as [string,string])])
 try{for(const [file,content]of files)writeFileSync(file,content);const result=syncFavoriteAgents(false,{stateFiles:[stateFile],agentDirectory,configFile});expect(result.favs).toEqual([{providerID:"provider",modelID:"model"}]);expect(result.legacyAgentFiles).toEqual(["model-personal.md"]);expect(result.legacyConfiguredModels).toEqual(result.favs);for(const [file,content]of files)expect(readFileSync(file,"utf8")).toBe(content)}finally{rmSync(dir,{recursive:true,force:true})}
})
