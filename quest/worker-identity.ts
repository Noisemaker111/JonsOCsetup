import {QuestError} from './api'
import type {QuestSession} from './types'
/** The dispatch receipt authorizes one exact identity, including later turns. */
export function assertWorkerIdentity(run:QuestSession|undefined,actual:{agent?:string;model?:{providerID?:string;id?:string;variant?:string}}) {
 if(!run?.providerID||!run.modelID||!run.reasoningEffort)return
 if(actual.agent===run.agentRole&&actual.model?.providerID===run.providerID&&actual.model?.id===run.modelID&&actual.model?.variant===run.reasoningEffort)return
 throw new QuestError('WORKER_IDENTITY_CHANGED','Worker agent/model/reasoning differs from its authorized dispatch. No inference was sent. Return to your Quest Giver and inspect the existing worker; do not launch a replacement or substitute a model.')
}

/** Compaction is a host request role, not a change to the assigned worker. */
export function assertWorkerRequestIdentity(run:QuestSession,request:Parameters<typeof assertWorkerIdentity>[1],session?:Parameters<typeof assertWorkerIdentity>[1]) {
 if(request.agent!=='compaction')return assertWorkerIdentity(run,request)
 // Independently verify the saved worker and the outbound model. Recognizing the
 // host's compaction role must not authorize another model or a changed session.
 assertWorkerIdentity(run,session??{})
 assertWorkerIdentity(run,{agent:session?.agent,model:request.model})
}
