import type { Quest } from "./types"
import { latestSessionAttempts } from "./session-lineage"
import { stageMissing } from "./stages"
import { applyGateMissing } from "../orchestration/apply-gate"
import { verifyLiveMissing } from "../orchestration/verify-live-gate"

export function completionMissing(q: Quest, lookup?: (id: string) => Quest | undefined): string[] {
  const out: string[] = []
  if (q.contractVersion === 2) {
    if (!q.stages.length) out.push("steps")
    for (const step of q.stages) if (step.status !== "done") out.push(`step ${step.id}`)
    if (latestSessionAttempts(q.sessions).some(s => ["planned", "executing", "waiting", "blocked"].includes(s.state))) out.push("active runs")
    return out
  }
  const p = q.completionPolicy
  if (q.deliverables.some((d) => d.status !== "done")) out.push("deliverables")
  // Steps are the unit Jk reads; acceptance text only gates a Quest that has no steps.
  if (!q.stages.length && q.acceptanceCriteria.some((a) => !a.satisfied)) out.push("acceptance criteria")
  for (const stage of q.stages) out.push(...stageMissing(stage))
  // "missing exact session link for call_X" is an orphaned completion echo
  // from a dispatch continuation whose callID was never registered as its
  // own session row (the tracked session for that work already reached a
  // terminal state under a different callID). It's a breadcrumb, not a
  // conflict — a genuine identity clash still records "conflicting exact
  // bind for call ..." and keeps blocking below.
  if (q.unresolvedWork.some((x) => !/^missing exact session link for /.test(x))) out.push("unresolved work")
  // Only live work blocks completion; a failed or missing attempt is history once its step is done.
  if (latestSessionAttempts(q.sessions).some((s) => ["planned", "executing", "waiting", "blocked"].includes(s.state))) out.push("active sessions")
  if (p.requireSessions && !q.sessions.length) out.push("session evidence")
  if (p.requireCommits && !q.evidence.commits.some((x) => x.verified)) out.push("verified commits")
  // A worker's "STEP <verify-id>: done — <evidence>" report is the test run
  // when no separate "TESTS:" line came through (tracker.ts's
  // applyWorkerReport backfills evidence.tests from a done Verify stage in
  // that case). Quests completed before that backfill existed have a done
  // Verify stage with a passed command proof but a permanently empty
  // evidence.tests array, since already-applied worker-report events are
  // never replayed. Re-derive the same equivalence lazily here so those
  // pre-existing completions stop blocking on "passing tests" forever.
  const testsSatisfied = q.evidence.tests.some((x) => x.result === "passed")
    || q.stages.some((stage) => stage.status === "done" && /^verif/i.test(stage.title) && stage.proofs.some((proof) => proof.kind === "command" && proof.result === "passed"))
  if (p.requireTests && !testsSatisfied) out.push("passing tests")
  if (p.requireReview && q.evidence.review?.verdict !== "CLEAN") out.push("CLEAN review")
  if (p.requireArtifacts && !q.evidence.artifacts.some((x) => x.verified)) out.push("verified artifact")
  if (p.requirePublish && !q.evidence.publish.some((x) => x.result === "succeeded" || x.result === "credentials-limitation")) out.push("publish evidence")
  if (p.requireWorktreeEquality && q.evidence.commits.some((x) => !x.verified || !x.worktreeHead || x.worktreeHead !== x.hash)) out.push("commit/worktree equality")
  for (const id of q.relationships.dependencies) {
    const dependency = lookup?.(id)
    if (!dependency || !["Complete", "Archived"].includes(dependency.state)) out.push(`dependency ${id}`)
  }
  if (q.claims.some((x) => x.state === "active")) out.push("active file claims")
  out.push(...applyGateMissing(q))
  out.push(...verifyLiveMissing(q))
  return [...new Set(out)].sort()
}

export function gatesReady(q: Quest, lookup?: (id: string) => Quest | undefined): boolean { return completionMissing(q, lookup).length === 0 }
