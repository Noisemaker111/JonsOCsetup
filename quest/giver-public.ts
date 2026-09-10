/** Project-router integration: selecting work never creates a destination giver. */
import {QuestStore} from './store'
import {questRoot} from './root'
import {ensureUserGiver,selectUserGiverProject,userGiverID} from './user-giver'
export async function singleUserGiver(host:any,sessionID:string){return ensureUserGiver(new QuestStore(questRoot()),host,sessionID)}
export function selectGiverProject(sessionID:string,targets:{directory:string}[],revision:number){return selectUserGiverProject(new QuestStore(questRoot()),sessionID,targets,revision)}
export function canonicalGiverSession(){return userGiverID()}
