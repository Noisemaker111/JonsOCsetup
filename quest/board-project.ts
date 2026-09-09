import type {Quest} from "./types"
import {projectIdentity} from "./project"
export type BoardProject = {id?:string;root?:string;error?:string}
/** Storage never supplies a project. Unknown legacy ownership is visible only in All projects. */
export function boardProject(directory:unknown){if(typeof directory!=="string"||!directory)return {id:undefined,error:"Project location unavailable; select All projects to inspect the shared ledger"};try{return {...projectIdentity(directory),error:undefined}}catch(error){return {id:undefined,error:error instanceof Error?error.message:"Project identity unavailable"}}}
export function projectQuests(quests:Quest[],projectID:string|undefined,allProjects=false){return allProjects?quests:quests.filter(q=>projectID!==undefined&&q.project?.id===projectID)}
/** The host session location is authoritative, shared by board and compact chrome. */
export async function resolveBoardProject(context:any, sessionID?:string):Promise<BoardProject> {
  if (sessionID && typeof context?.client?.session?.get === "function") {
    try { const result=await context.client.session.get({sessionID});const row=result?.data??result;return boardProject(row?.id===sessionID?row.location?.directory:undefined) }
    catch { return {id:undefined,error:"Current session project could not be verified; select All projects"} }
  }
  return boardProject(context?.location?.directory??context?.state?.path?.directory)
}
