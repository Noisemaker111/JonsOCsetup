import { stagesFromSteps, nextQuestStep, questProgress } from "./steps"
import { latestSessionAttempts } from "./session-lineage"
import type { Quest, QuestStage } from "./types"

/** Pure migration preview. Ownership must come from trusted project discovery. */
export function migrateQuestContract(input: Quest): Quest {
  if (input.contractVersion === 2) return structuredClone(input)
  const q = structuredClone(input)
  const historical = q.state === "Archived" || q.state === "Complete"
  const existing = new Set(q.stages.map(s => s.title.trim().toLowerCase()))
  const taken = new Set(q.stages.map(s => s.id))
  const add = (title: string, status: QuestStage["status"] = "pending") => {
    if (!title.trim() || existing.has(title.trim().toLowerCase())) return
    const stage = stagesFromSteps([{ title, status }])[0]
    const base = stage.id
    let n = 2
    while (taken.has(stage.id)) stage.id = base + "-" + n++
    taken.add(stage.id); existing.add(title.trim().toLowerCase()); q.stages.push(stage)
  }
  for (const d of q.deliverables) add(d.title, d.status)
  for (const stage of [...q.stages]) for (const todo of stage.todos) {
    if (todo.status !== "done") add(todo.title, todo.status)
  }
  const verification = q.stages.find(s => s.status !== "done" && /test|verif|accept/i.test(s.title))
  const acceptance = q.acceptanceCriteria.filter(a => !a.satisfied).map(a => a.text)
  if (acceptance.length) {
    if (verification) verification.detail = [verification.detail, ...acceptance].filter(Boolean).join("\n")
    else for (const text of acceptance) add(text)
  }
  for (const text of q.unresolvedWork) if (!/^missing exact session link for /.test(text)) add(text, "blocked")
  if (!historical) {
    const p = q.completionPolicy
    if (p.requireTests && !q.evidence.tests.some(t => t.result === "passed") && !q.stages.some(s => /test|verif/i.test(s.title))) add("Run the relevant verification and record the result")
    if (p.requireCommits && !q.evidence.commits.some(c => c.verified)) add("Integrate and commit the changes")
    if (p.requireReview && q.evidence.review?.verdict !== "CLEAN") add("Review the changes and resolve findings")
    if (p.requireArtifacts && !q.evidence.artifacts.some(a => a.verified)) add("Capture the requested artifacts")
    if (p.requirePublish && !q.evidence.publish.some(p => p.result === "succeeded")) add("Perform the requested rollout with the required authorization")
    if (p.requireWorktreeEquality && !q.stages.some(s => /integrat/i.test(s.title))) add("Verify integration of the worker changes")
  }
  q.contractVersion = 2
  q.description = q.description ?? q.objective
  q.reward = q.reward ?? q.usageInstructions.join("\n\n")
  if (q.state === "Archived") q.archive = { at: q.updatedAt, reason: q.reason, accepted: false }
  // Legacy fields remain recovery data; v2 progress and completion do not read them.
  return q
}

/** Public contract: legacy lifecycle/proof fields are deliberately not projected. */
export function questView(q: Quest) {
  const next = nextQuestStep(q)
  return {
    id: q.id, title: q.title, description: q.description ?? q.objective,
    project: q.project ?? null,
    steps: q.stages.map(s => ({ id: s.id, title: s.title, commandID: s.commandID, detail: s.detail, state: s.status, needs: s.needs, note: s.note })),
    progress: questProgress(q), nextStepID: next?.id ?? null,
    runs: latestSessionAttempts(q.sessions).map(s => ({ id: s.runID ?? s.callID, kind: s.agentRole === "command" ? "command" : "agent", sessionID: s.openCodeSessionId ?? s.sessionID, state: s.state, model: s.model, reasoning: s.reasoningEffort ?? null, fast: s.fast ?? null, attempt: s.attempt, routingNote:s.routingNote, result: s.result, updatedAt: s.updatedAt, history: q.sessions.filter(a => (a.resumeRoot ?? a.resumedFrom ?? a.callID) === (s.resumeRoot ?? s.resumedFrom ?? s.callID)).map(a => ({ id: a.runID ?? a.callID, state: a.state, result: a.result, model: a.model, attempt: a.attempt })) })),
    artifacts: q.evidence.artifacts, reward: q.reward ?? q.usageInstructions.join("\n\n"),
    archive: q.archive ?? (q.state === "Archived" ? { at: q.updatedAt, reason: q.reason, accepted: false } : null),
  }
}
