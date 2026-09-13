import { QuestError } from './api'
import type { Quest } from './types'

export type QuestWorkflow = {
  readOnly?: boolean
  task?: 'coding' | 'review' | 'planning' | 'utility'
  model?: string
  maxConcurrent?: number
  delivery?: 'project' | 'quest-pr' | 'step-pr' | 'none'
}

/** User choices live on the Quest; absence delegates to the existing project/router policy. */
export function parseWorkflow(value: unknown): QuestWorkflow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new QuestError('INVALID_INPUT', 'workflow must be an object')
  const input = value as Record<string, unknown>
  if (Object.keys(input).some(key => !['readOnly', 'task', 'model', 'maxConcurrent', 'delivery'].includes(key))) throw new QuestError('INVALID_INPUT', 'Unknown workflow setting')
  if (input.readOnly !== undefined && typeof input.readOnly !== 'boolean') throw new QuestError('INVALID_INPUT', 'workflow.readOnly must be a boolean')
  if (input.task !== undefined && !['coding', 'review', 'planning', 'utility'].includes(String(input.task))) throw new QuestError('INVALID_INPUT', 'Unknown workflow task')
  if (input.model !== undefined && (typeof input.model !== 'string' || !input.model.trim())) throw new QuestError('INVALID_INPUT', 'workflow.model must be an exact route')
  if (input.maxConcurrent !== undefined && (!Number.isSafeInteger(input.maxConcurrent) || Number(input.maxConcurrent) < 1)) throw new QuestError('INVALID_INPUT', 'workflow.maxConcurrent must be a positive integer')
  if (input.delivery !== undefined && !['project', 'quest-pr', 'step-pr', 'none'].includes(String(input.delivery))) throw new QuestError('INVALID_INPUT', 'Unknown workflow delivery')
  return { ...input } as QuestWorkflow
}

export const questWorkflow = (quest: Quest): QuestWorkflow => parseWorkflow(quest.extensions.workflow ?? {})

export function deliveryInstructions(quest: Quest): string {
  switch (questWorkflow(quest).delivery ?? 'project') {
    case 'none': return 'Deliver the requested result and evidence in your step notes. This Quest requests no pull request.'
    case 'step-pr': return 'Deliver a focused pull request for your assigned step when it changes repository code. Follow the project conventions and existing publishing authorization; save its URL and verification in the step notes.'
    case 'quest-pr': return 'This Quest requests one pull request for the whole Quest. Save your changes and verification in the assigned step; the Quest Giver combines the completed steps and delivers that pull request under the project conventions and existing authorization.'
    case 'project': return 'Deliver according to the project conventions and existing authorization. Record the concrete result, verification and any pull request URL in the assigned step.'
  }
}
