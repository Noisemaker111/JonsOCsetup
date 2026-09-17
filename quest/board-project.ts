import type {Quest} from "./types"
import {projectIdentity} from "./project"
export type BoardProject = {id?:string;root?:string;error?:string}
/** Storage never supplies a project. Unknown legacy ownership is visible only in All projects. */
export function boardProject(directory:unknown){if(typeof directory!=="string"||!directory)return {id:undefined,error:"Project location unavailable; select All projects to inspect the shared ledger"};try{return {...projectIdentity(directory),error:undefined}}catch(error){return {id:undefined,error:error instanceof Error?error.message:"Project identity unavailable"}}}
export function projectQuests(quests:Quest[],projectID:string|undefined,allProjects=false){return allProjects?quests:quests.filter(q=>projectID!==undefined&&q.project?.id===projectID)}
/** The host session location is authoritative, shared by board and compact chrome. */
export async function resolveBoardProject(context:any, sessionID?:string,returnDirectory?:string):Promise<BoardProject> {
  if(returnDirectory)return boardProject(returnDirectory)
  if (sessionID && typeof context?.client?.session?.get === "function") {
    try { const result=await context.client.session.get({sessionID});const row=result?.data??result;return boardProject(row?.id===sessionID?row.location?.directory:undefined) }
    catch { return {id:undefined,error:"Current session project could not be verified; select All projects"} }
  }
  return boardProject(context?.location?.directory??context?.state?.path?.directory)
}

/**
 * The project scope every surface applies, chosen once.
 *
 * The registered Quest Giver holds one conversation across every project, so its board, its footer
 * and its CLI reads are the whole shared ledger; any other session sees the project it is in. The
 * choice used to be re-decided in the board, in the composer footer and in the service, which is how
 * three surfaces counted three different backlogs from one ledger.
 */
export const allProjectsByDefault = (isUserGiver: unknown) => Boolean(isUserGiver)
/** The words every surface uses for the set it counted; the CLI returns the same string. */
export const scopeLabel = (allProjects: boolean, root?: string) =>
  allProjects ? "all projects" : "this project (" + (root?.split(/[\\/]/).filter(Boolean).at(-1) ?? "location unavailable") + ")"
