import { redactSensitive } from './privacy'
import type { Quest, QuestSession, QuestStage } from './types'

const line = (value: unknown, fallback = '') => {
  const lines = typeof value === 'string' ? value.split(/\r?\n/).map(part => part.trim()).filter(Boolean) : []
  const first = lines.find(part => !/^#{1,6}\s/.test(part)) ?? lines[0]
  return redactSensitive(first || fallback).replace(/\s+/g, ' ').trim()
}

const returnedStep = (quest: Quest, stepIDs: string[]): QuestStage | undefined => {
  const assigned = stepIDs.flatMap(id => quest.stages.find(step => step.id === id) ?? [])
  return assigned.findLast(step => step.status === 'done') ?? assigned.at(-1)
    ?? quest.stages.findLast(step => step.status === 'done') ?? quest.stages.at(-1)
}

const latestStepRun = (quest: Quest, stepID?: string): QuestSession | undefined =>
  stepID ? quest.sessions.findLast(run => run.deliverables.includes(stepID)) : undefined

/** The unsolicited return is only a routing summary. Complete worker notes stay on the Quest. */
export function questCompletionReturn(input: {
  quest: Quest
  label: 'Automatic Quest worker update' | 'Quest ready for review'
  stepIDs?: string[]
  run?: QuestSession
}) {
  const step = returnedStep(input.quest, input.stepIDs ?? [])
  const run = input.run ?? latestStepRun(input.quest, step?.id)
  const state = line(input.quest.state, run?.state ?? 'unknown')
  const unsuccessful = run && ['failed', 'cancelled'].includes(run.state)
  const outcome = unsuccessful ? line(run.result, `Worker ${run.state}`)
    : line(step?.note, line(run?.result, `${step?.title ?? 'Worker'}: ${state}`))
  const payload = {
    questID: line(input.quest.id),
    title: line(input.quest.title),
    state,
    ...(run ? { runState: run.state } : {}),
    finishedStep: step ? { id: line(step.id), title: line(step.title), state: line(step.status) } : null,
    outcome,
    notes: 'quests.get({id: questID}) or quests.inspect({id: questID, section: "steps"})',
  }
  return input.label + '.\n' + JSON.stringify(payload) + '\nSaved outcome is not independent verification; full notes remain on the Quest and are read only when needed.'
}
