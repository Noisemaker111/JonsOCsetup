import {QuestError} from './api'
import type {QuestSession} from './types'
/** The dispatch receipt authorizes one exact identity, including later turns. */
export function assertWorkerIdentity(run:QuestSession|undefined,actual:{agent?:string;model?:{providerID?:string;id?:string;variant?:string}}) {
 if(!run?.providerID||!run.modelID||!run.reasoningEffort)return
 if(actual.agent===run.agentRole&&actual.model?.providerID===run.providerID&&actual.model?.id===run.modelID&&actual.model?.variant===run.reasoningEffort)return
 throw new QuestError('WORKER_IDENTITY_CHANGED','Worker agent/model/reasoning differs from its authorized dispatch. No inference was sent. Return to your Quest Giver and inspect the existing worker; do not launch a replacement or substitute a model.')
}
