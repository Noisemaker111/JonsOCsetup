import {randomUUID} from "node:crypto"
import {typedQuestTool} from "./typed-tool"
import {QuestStore} from "./store"
import {questRoot} from "./root"
import {api as bridgeAPI} from "../harnesses/opencode-mcp-stdio.mjs"
/** JSON stdin has exactly the native tool shape; transport supplies invocation identity. */
export async function runTypedQuestCLI(input:unknown){const sessionID=process.env.OPENCODE_PARENT_SESSION_ID,localID="cli";if((input as any)?.action==="run"&&!sessionID)throw Error("Quest run requires the owning OpenCode session (OPENCODE_PARENT_SESSION_ID)");const host={get:async({sessionID:id}:any)=>!sessionID&&id===localID?{location:{directory:process.cwd()}}:bridgeAPI()("GET","/session/"+encodeURIComponent(id)),create:async(input:any)=>bridgeAPI()("POST","/session",input),prompt:async({sessionID,...input}:any)=>bridgeAPI()("POST","/session/"+encodeURIComponent(sessionID)+"/prompt",input)};const result=await typedQuestTool(new QuestStore(questRoot()),host).execute(input,{sessionID:sessionID??localID,id:process.env.OPENCODE_QUEST_REQUEST_ID??randomUUID()});return result.output}
