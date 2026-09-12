/** Project-router integration: selecting work never creates a destination giver. */
import {QuestStore} from './store'
import {questRoot} from './root'
import {releaseUserGiver} from './giver-registry.mjs'
import {ensureUserGiver,selectUserGiverProject,userGiverID} from './user-giver'
export async function singleUserGiver(host:any,sessionID:string){return ensureUserGiver(new QuestStore(questRoot()),host,sessionID)}
export function selectGiverProject(sessionID:string,targets:{directory:string}[],revision:number){return selectUserGiverProject(new QuestStore(questRoot()),sessionID,targets,revision)}
export function canonicalGiverSession(){return userGiverID()}

/** Release the binding so the next session becomes the giver. History and Quests are untouched. */
export function succeedUserGiver(){return releaseUserGiver(new QuestStore(questRoot()).runtime)}
