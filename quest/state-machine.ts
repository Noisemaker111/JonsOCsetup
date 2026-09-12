import { nextStepAction } from "./steps"
import { completionMissing } from "./completion"
import { latestSessionAttempts, isSessionQuotaExhausted } from "./session-lineage"
import type { Quest, QuestState } from "./types"

/**
 * `reason` and `nextAction` written by the tool API (a blocked step, a
 * deferred backlog note) survive only while the derived state is unchanged.
 * Before this, a Quest that flipped to Needs attention kept showing its
 * creation-time "Ready for work to be assigned".
 */
function carried(q: Quest, state: QuestState): { reason: string; nextAction: string } {
  // Our own generated texts (step counts, session counts) must be recomputed every time.
  const generated = /^(\d+\/\d+ steps done|\d+ linked sessions? (?:is|are) executing|No linked sessions are executing|Step \d+\/\d+:|All steps done|Wait for linked execution evidence|Start or resume an exact linked session)/
  if (q.state !== state) return { reason: "", nextAction: "" }
  return { reason: generated.test(q.reason) ? "" : q.reason, nextAction: generated.test(q.nextAction) ? "" : q.nextAction }
}

export function deriveState(q: Quest, lookup?: (id: string) => Quest | undefined): { state: QuestState; reason: string; nextAction: string; missing: string[] } {
  if (q.contractVersion === 2) {
    const sessions=latestSessionAttempts(q.sessions),active=sessions.filter(s=>["planned","executing","waiting","blocked"].includes(s.state))
    const missing=completionMissing(q,lookup),done=q.stages.length>0&&q.stages.every(s=>s.status==="done")
    if(q.archive||q.state==="Archived")return {state:"Archived",reason:q.archive?.reason??"Archived",nextAction:"Reopen to resume",missing:[]}
    const unfinished=!active.length&&sessions.some(run=>['completed','cancelled'].includes(run.state)&&run.deliverables.some(id=>q.stages.some(step=>step.id===id&&step.status!=='done')))
    const state:QuestState=active.some(s=>s.state==="executing")?"Working":unfinished||q.stages.some(s=>s.status==="blocked")||!done&&sessions.some(s=>["failed","missing","stale"].includes(s.state))?"Needs attention":done&&!active.length?"Ready to complete":"Waiting"
    return {state,reason:unfinished?"Worker ended without saved completion of its assigned steps":q.stages.filter(s=>s.status==="done").length+"/"+q.stages.length+" steps done",nextAction:unfinished?"Inspect the worker result with your giver before resuming unfinished work":nextStepAction(q),missing}
  }
  if (q.state === "Archived") return { state: "Archived", reason: q.reason || "Archived", nextAction: q.nextAction || "Reopen to resume work", missing: q.missingRequirements }
  if (q.state === "Complete") return { state: "Complete", reason: q.reason || "Explicitly completed", nextAction: q.nextAction || "Archive when no longer active", missing: [] }
  const currentSessions = latestSessionAttempts(q.sessions)
  const executing = currentSessions.filter((x) => x.state === "executing").length
  const missing = completionMissing(q, lookup)
  // A session whose only terminal was a quota/model-failover notice ("Usage
  // reached ... Falling over") didn't fail the work — it failed to finish
  // its own turn. Once the Quest's completion gates are otherwise satisfied
  // (the work got done and evidenced, whether by a retry or by the giver
  // reconciling on-disk evidence), that stale terminal should stop blocking
  // the Quest from landing Ready. The flag is re-derived from stored evidence
  // here (not just read off the session), so sessions that failed before the
  // reducer learned to set `quotaExhausted` are backfilled on every read
  // instead of staying stuck forever.
  const failed = currentSessions.some((x) => {
    if (!["failed", "cancelled", "missing", "stale"].includes(x.state)) return false
    if (x.state === "failed" && isSessionQuotaExhausted(x) && !missing.length) return false
    return true
  })
  const blocked = currentSessions.some((x) => x.state === "blocked")
  const blockedStep = q.stages.find((stage) => stage.status === "blocked")
  const conflict = q.unresolvedWork.some((x) => /conflict|malformed|missing evidence/i.test(x))
  if (failed || blocked || blockedStep || conflict || q.evidence.review?.verdict === "BLOCK" || q.evidence.review?.verdict === "CONCERNS") {
    const kept = carried(q, "Needs attention")
    const why = blockedStep ? `Step ${blockedStep.id} is blocked` : failed ? "A worker session failed, was cancelled, or went missing" : blocked ? "A worker session is blocked on a dependency" : conflict ? "Unresolved work needs a decision" : "Review found blocking findings"
    const next = blockedStep ? `Unblock step ${blockedStep.id}: ${blockedStep.todos.find((todo) => todo.status === "blocked")?.title ?? "see step evidence"}` : "Resolve the first attention item"
    return { state: "Needs attention", reason: kept.reason || why, nextAction: kept.nextAction || next, missing }
  }
  if (executing > 0) {
    const kept = carried(q, "Working")
    return { state: "Working", reason: kept.reason || `${executing} linked session${executing === 1 ? " is" : "s are"} executing`, nextAction: kept.nextAction || "Wait for linked execution evidence", missing }
  }
  // Done-but-gated: every step is done and evidenced and no worker is
  // running — the ONLY open item is the live-host check. That is
  // verification debt, not active work: it belongs in the Verifying lane,
  // not assigned. The gate must be the sole remainder (a Quest whose steps
  // are merely marked done but still lacks proofs/sessions/tests stays
  // Waiting). Once the gate passes (or steps reopen) the Quest re-derives
  // to Ready/Waiting below instead of sticking here.
  const allStepsDone = q.stages.length > 0 && q.stages.every((stage) => stage.status === "done")
  const onlyLiveGate = missing.length > 0 && missing.every((m) => m.startsWith("VERIFY-LIVE"))
  if (allStepsDone && onlyLiveGate) {
    const kept = carried(q, "Verifying")
    return { state: "Verifying", reason: kept.reason || "All steps done; awaiting live-host verification", nextAction: kept.nextAction || "Run the changed surface on the live host and record the live check", missing }
  }
  if (!missing.length) return { state: "Ready to complete", reason: "All completion gates are verified", nextAction: "Turn in this Quest", missing }
  const kept = carried(q, "Waiting")
  const nextStep = q.stages.find((stage) => stage.status !== "done")
  return { state: "Waiting", reason: kept.reason || (q.stages.length ? `${q.stages.filter((stage) => stage.status === "done").length}/${q.stages.length} steps done; no session is executing` : "No linked sessions are executing"), nextAction: kept.nextAction || (nextStep ? `Step ${q.stages.indexOf(nextStep) + 1}/${q.stages.length}: ${nextStep.title}` : "Start or resume an exact linked session"), missing }
}

export function normalizeState(q: Quest, lookup?: (id: string) => Quest | undefined): Quest {
  q.executingCount = latestSessionAttempts(q.sessions).filter((x) => x.state === "executing").length
  const derived = deriveState(q, lookup)
  q.state = derived.state; q.reason = derived.reason; q.nextAction = derived.nextAction; q.missingRequirements = derived.missing
  return q
}
