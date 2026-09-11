/** Quest-owned, read-only identity/assignment facade for project-router. */
import { readAllQuests } from './index'
import { QuestStore } from './store'
import { questRoot } from './root'
import { acquireLock } from './locking'
import { createHash } from 'node:crypto'
export { physicalDirectory, projectIdentity } from './project'
export function claimRouterRequest(key: string) {
  return acquireLock(new QuestStore(questRoot()).runtime, 'project-router-' + createHash('sha256').update(key).digest('hex'), { timeoutMs: 0 })
}
export function routerQuestInventory() {
  return readAllQuests(questRoot(), { includeArchived: true }).flatMap(row => row.quest ? [{
    id: row.quest.id, title: row.quest.title, project: row.quest.project,
    workers: row.quest.sessions.flatMap(run => {
      const sessionID = run.openCodeSessionId ?? run.sessionID
      return sessionID ? [{ sessionID, runID: run.runID, stepIDs: run.deliverables, state: run.state }] : []
    }),
  }] : [])
}
export function routerWorker(sessionID: string) {
  return routerQuestInventory().flatMap(q => q.workers.filter(w => w.sessionID === sessionID).map(w => ({ questID: q.id, ...w })))
}

/** Worker terminal events retain the destination giver as the return address. */
export function routerReturnSources(sessionID:string){
 return readAllQuests(questRoot(),{includeArchived:false}).flatMap(row=>{
  const q=row.quest,run=q?.sessions.find(r=>r.sessionID===sessionID||r.openCodeSessionId===sessionID)
  return q&&run&&q.integrationOwner?[{sessionID:q.integrationOwner,detail:{quest:q.title,workerSessionID:sessionID,state:run.state,steps:q.stages.map(s=>({title:s.title,status:s.status})),result:run.result}}]:[]
 })
}