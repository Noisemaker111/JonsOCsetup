import { createHash } from 'node:crypto'
import { RouterError } from './host'
import type { RouteReturns } from './returns'
import { revalidate, instructions, targetKey, type Target } from './resolution'
import { claimRouterRequest } from '../quest/router-public'

export type Storage = { get(key: string): Promise<any>; set(key: string, value: any): Promise<void> }
export type SessionHost = { create(input: any): Promise<any>; get(input: any): Promise<any>; prompt(input: any): Promise<any> }
export type RouteReceipt = { key: string; target: Target; hubSessionID: string; destinationSessionID?: string; state: 'preparing' | 'bound' | 'delivered' | 'unknown' | 'cancelled'; revision: number; reason?: string }
const unwrap = (x: any) => x?.data ?? x
/** Only host-supplied callers enter this boundary; destination IDs never come from tool input. */
export class DestinationRouter {
  private inflight = new Map<string, Promise<RouteReceipt>>()
  constructor(readonly storage: Storage, readonly host: SessionHost, readonly isWorker: (sessionID: string) => boolean, readonly revision: (sessionID: string) => Promise<number>, readonly claim = claimRouterRequest, readonly returns?:RouteReturns) {}
  private associationKey(hubSessionID:string,target:Target){return 'destination/'+createHash('sha256').update(hubSessionID+':'+targetKey(target)).digest('hex')}
  async destination(hubSessionID:string,target:Target){
    const association=await this.storage.get(this.associationKey(hubSessionID,target))
    if(!association?.sessionID)return {state:association?.state??'not-routed'}
    const actual=unwrap(await this.host.get({sessionID:association.sessionID}))
    if(this.isWorker(association.sessionID)||targetKey(revalidate({...target,directory:actual.location?.directory}))!==targetKey(target))throw new RouterError('DESTINATION_MISMATCH','Recorded destination binding changed')
    return {...association,target}
  }
  async route(input: { hubSessionID: string; requestKey: string; text: string; target: Target; revision: number; authorizedTargets?:string[] }) {
    if (this.isWorker(input.hubSessionID)) throw new RouterError('WORKER_DELEGATION_DENIED', 'Workers report assigned work; only givers route conversations')
    if (await this.revision(input.hubSessionID) !== input.revision) throw new RouterError('SELECTION_CHANGED', 'Use the revision returned by project_select; no request was admitted')
    const request='request/'+createHash('sha256').update(input.hubSessionID+':'+input.requestKey).digest('hex')
    let requestClaim:ReturnType<typeof claimRouterRequest>;try{requestClaim=this.claim(request)}catch{throw new RouterError('ROUTE_CLAIM_BUSY','Another process is authorizing this request; inspect before retry')}
    try{const prior=await this.storage.get(request),authorization={revision:input.revision,targets:input.authorizedTargets??[targetKey(input.target)],textHash:createHash('sha256').update(input.text).digest('hex')};if(prior&&JSON.stringify(prior)!==JSON.stringify(authorization))throw new RouterError('REQUEST_CHANGED','This request was already authorized for another selection/text. Inspect prior work and use a new explicitly authorized request key after correction');if(!prior)await this.storage.set(request,authorization)}finally{requestClaim.release()}
    const key = 'route/' + createHash('sha256').update(input.hubSessionID + ':' + input.requestKey + ':' + targetKey(input.target)).digest('hex')
    const pending = this.inflight.get(key); if (pending) return pending
    let claim: ReturnType<typeof claimRouterRequest>
    try { claim = this.claim('destination:'+input.hubSessionID+':'+targetKey(input.target)) } catch { throw new RouterError('ROUTE_CLAIM_BUSY', 'Another process owns this route admission; inspect its receipt, do not launch again') }
    const run = this.admit(key, input); this.inflight.set(key, run)
    try { return await run } finally { this.inflight.delete(key); claim.release() }
  }
  private async admit(key: string, input: { hubSessionID: string; requestKey: string; text: string; target: Target; revision: number }): Promise<RouteReceipt> {
    const prior = await this.storage.get(key)
    if (prior) return { ...prior, state: ['preparing','bound'].includes(prior.state) ? 'unknown' : prior.state, reason: prior.state === 'bound' ? 'Process stopped around prompt admission; inspect destination messages before explicit recovery' : prior.reason }
    const checkRevision = async () => {
      if (await this.revision(input.hubSessionID) !== input.revision) throw new RouterError('SELECTION_CHANGED', 'User correction invalidated this route; select again')
    }
    await checkRevision()
    const target = revalidate(input.target), receipt: RouteReceipt = { key, target, hubSessionID: input.hubSessionID, revision: input.revision, state: 'preparing' }
    const instructionFiles = instructions(target)
    await this.storage.set(key, receipt)
    let attempted = false, creating = false
    const associationKey=this.associationKey(input.hubSessionID,target)
    try {
      const source = unwrap(await this.host.get({ sessionID: input.hubSessionID }))
      if (!source.agent || !source.model?.providerID || !source.model?.id || !source.model?.variant) throw new RouterError('SOURCE_ROUTE_INCOMPLETE', 'The giver must have an explicit installed agent/model/reasoning selection before routing')
      const association=await this.storage.get(associationKey)
      if(association?.state==='unknown')throw new RouterError('UNKNOWN_PRIOR_DELIVERY','A previous delivery to this destination is unknown; inspect it before another prompt')
      const reused=association?.sessionID
      if(!reused){creating=true;await this.storage.set(associationKey,{state:'unknown',receipt:key})}
      const created = reused?{id:reused}:unwrap(await this.host.create({ title: `Project: ${target.name}`, agent: source.agent, model: source.model, location: { directory: target.directory }, metadata: { projectRouter: { hub: input.hubSessionID, key } } }))
      if (typeof created?.id !== 'string') throw new RouterError('UNKNOWN_SESSION', 'Host returned no destination identity; inspect before retry')
      receipt.destinationSessionID = created.id
      const bound = unwrap(await this.host.get({ sessionID: created.id }))
      if (this.isWorker(created.id) || bound.agent !== source.agent || bound.model?.providerID !== source.model.providerID || bound.model?.id !== source.model.id || bound.model?.variant !== source.model.variant || targetKey(revalidate({ ...target, directory: bound.location?.directory })) !== targetKey(target)) throw new RouterError('DESTINATION_MISMATCH', 'Host session is not bound to the selected giver/model/worktree')
      receipt.state = 'bound'; await this.storage.set(key, receipt)
      await this.storage.set('observed/'+created.id,{directory:target.directory})
      await checkRevision(); revalidate(target)
      await this.returns?.watch(receipt,source)
      attempted = true
      await this.host.prompt({ sessionID: created.id, id: 'msg_' + createHash('sha256').update(key).digest('hex').slice(0, 26), text: `User explicitly selected ${target.directory} (canonical project ${target.root}). Read and follow destination instructions before work. This is a destination-bound giver conversation; use project-owned Quest tools here. Return hub session: ${input.hubSessionID}.\nApplicable instruction paths: ${instructionFiles.map(x => x.path).join(', ') || '(none)'}\n\nOriginal user request:\n${input.text}` })
      receipt.state = 'delivered'
      await this.storage.set(associationKey,{sessionID:created.id,state:'bound',target,sourceAgent:source.agent,sourceModel:source.model})
    } catch (error) {
      receipt.state = attempted || creating&&!receipt.destinationSessionID ? 'unknown' : 'cancelled'
      receipt.reason = error instanceof RouterError ? error.message : 'Host operation failed; inspect the recorded destination before retry'
      if(attempted)await this.storage.set(associationKey,{sessionID:receipt.destinationSessionID,state:'unknown',receipt:key})
      else if(receipt.destinationSessionID)await this.storage.set(associationKey,{sessionID:receipt.destinationSessionID,state:'bound',target})
    }
    await this.storage.set(key, receipt); return receipt
  }
}
