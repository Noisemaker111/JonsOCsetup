import { questLane } from "./board"
import { requiredProofKinds } from "./stages"
import { nextQuestStep, nextStepAction } from "./steps"
import type { Quest } from "./types"

const ACTIVE_SESSION_STATES = new Set(["planned", "executing", "waiting", "blocked"])

function clip(value: string, max: number): string {
  const text = value.replace(/\s+/g, " ").trim()
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

function clipped(values: string[], count: number, max: number): string[] {
  return values.slice(0, count).map((value) => clip(value, max))
}

const currentStage = nextQuestStep

export function compactQuestSummary(q: Quest) {
  const stage = currentStage(q)
  const stageIndex = stage ? q.stages.indexOf(stage) + 1 : q.stages.length
  return {
    id: q.id,
    title: clip(q.title, 120),
    state: q.state,
    lane: questLane(q),
    stage: q.stages.length ? `${stageIndex}/${q.stages.length}` : undefined,
    nextAction: clip(nextStepAction(q), 180),
    running: q.executingCount,
    updatedAt: q.updatedAt,
  }
}

/** Agent-facing detail is an executable slice, not a second copy of the ledger. */
export function compactQuestDetail(q: Quest) {
  const stage = currentStage(q)
  const latestSetback = stage ? q.setbacks.findLast((item) => item.stageID === stage.id) : q.setbacks.at(-1)
  const pending = q.acceptanceCriteria.filter((item) => !item.satisfied)
  const fallback = q.deliverables.filter((item) => item.status !== "done").slice(0, 8).map((item) => ({ id: item.id, title: clip(item.title, 180), status: item.status }))
  return {
    ...compactQuestSummary(q),
    objective: clip(q.objective, 500),
    scope: stage ? { repos: clipped(stage.claim.repos, 4, 160), include: clipped(stage.claim.include, 10, 140), exclude: clipped(stage.claim.exclude, 6, 140) }
      : { repos: clipped(q.scope.repos, 4, 160), include: clipped(q.scope.include, 10, 140), exclude: clipped(q.scope.exclude, 6, 140) },
    currentStage: stage ? {
      id: stage.id,
      title: clip(stage.title, 160),
      status: stage.status,
      attempt: stage.attempt,
      needs: stage.needs,
      todos: stage.todos.filter((todo) => todo.status !== "done").slice(0, 8).map((todo) => ({ id: todo.id, title: clip(todo.title, 140), status: todo.status })),
      proofRequired: requiredProofKinds(stage),
    } : undefined,
    pendingDeliverables: stage ? undefined : fallback,
    acceptance: pending.slice(0, 6).map((item) => ({ id: item.id, text: clip(item.text, 180) })),
    acceptanceRemaining: pending.length,
    steps: q.stages.slice(0, 12).map((step) => ({ id: step.id, title: clip(step.title, 100), status: step.status })),
    stepsRemaining: Math.max(0, q.stages.length - 12),
    payout: { provided: q.usageInstructions.length > 0, count: q.usageInstructions.length },
    abandoned: q.abandoned || undefined,
    latestSetback: latestSetback ? { stageID: latestSetback.stageID, attempt: latestSetback.attempt, reason: clip(latestSetback.reason, 300), rewindTo: latestSetback.rewindTo } : undefined,
    integrationOwner: q.integrationOwner,
    sessions: q.sessions.filter((session) => ACTIVE_SESSION_STATES.has(session.state)).slice(0, 12).map((session) => ({
      sessionID: session.openCodeSessionId ?? session.sessionID,
      role: session.role,
      state: session.state,
      model: session.model,
      task: session.task ? clip(session.task, 160) : undefined,
    })),
    review: q.evidence.review ? { verdict: q.evidence.review.verdict, at: q.evidence.review.at } : undefined,
    artifacts: q.evidence.artifacts.slice(-12).map((artifact) => ({
      name: artifact.name,
      path: artifact.path ?? artifact.uri,
      label: artifact.label,
      revision: artifact.revision,
      at: artifact.at,
    })),
    artifactsCount: q.evidence.artifacts.length,
  }
}

/** Bounded worker prompt derived from the ledger. History and extensions never enter it. */
export function compactQuestDispatch(q: Quest, task: string): string {
  if (q.contractVersion === 2) {
    const step = nextQuestStep(q)
    return [
      `Quest ${q.id}: ${clip(q.title, 120)}`,
      `Description: ${clip(q.description ?? q.objective, 800)}`,
      `Task: ${clip(task, 800)}`,
      step && `Step [${step.id}]: ${step.title}`,
      step?.detail, step?.note && `Latest note: ${step.note}`,
      "Report only actual outcomes. Update assigned steps with an explicit pending, working, blocked, or done state and a short result or blocker. Never invent passing tests. Keep incomplete work unfinished.",
      "If the Quest tool is unavailable, report STEP <id>: done or blocked — <actual outcome>. Include TESTS: <command> — passed|failed only for checks you actually ran. Never create Quests or spawn workers.",
    ].filter(Boolean).join("\n")
  }
  const detail = compactQuestDetail(q)
  const stage = detail.currentStage
  const scope = detail.scope
  const visible = (scope.include ?? []).some((path) => /(?:^|[\\/])(tui|ui)(?:[\\/]|$)|\.(?:tsx?|jsx?|css|html|svg|png|jpg|jpeg|gif)$/i.test(path))
  const todos = stage?.todos ?? detail.pendingDeliverables ?? []
  const mark = (status: string) => status === "done" ? " ✓" : status === "pending" ? "" : ` (${status})`
  const steps = q.stages.slice(0, 10).map((step, index) => `${index + 1}. [${step.id}] ${clip(step.title, 90)}${mark(step.status)}`)
  const lines = [
    `Quest ${q.id}: ${detail.title}`,
    detail.objective && `Goal: ${detail.objective}`,
    `Task: ${clip(task, 500)}`,
    detail.nextAction && `Now: ${detail.nextAction}`,
    steps.length ? `Steps:\n${steps.join("\n")}` : "",
    stage && `Current step ${detail.stage} [${stage.id}, attempt ${stage.attempt}]: ${stage.title}`,
    `Proof: ${visible ? "command + run artifact + judgment" : "command"}`,
    detail.latestSetback && `Prior failure (attempt ${detail.latestSetback.attempt}): ${detail.latestSetback.reason}`,
    todos.length ? `Todos:\n${todos.slice(0, 6).map((item) => `- ${item.id}: ${"title" in item ? item.title : ""}`).join("\n")}` : "",
    scope.include.length ? `Claim: ${clip(scope.include.slice(0, 12).join(", "), 400)}` : "",
    scope.exclude.length ? `Avoid: ${clip(scope.exclude.slice(0, 8).join(", "), 200)}` : "",
    detail.acceptance.length ? `Acceptance:\n${detail.acceptance.slice(0, 5).map((item) => `- ${item.id}: ${item.text}`).join("\n")}` : "",
    `Payout: ${detail.payout.provided ? `${detail.payout.count} usage instruction(s) recorded` : "missing; Quest cannot complete"}`,
    `Report: if you have a quest tool, call quest(action="step", id="${q.id}", input={stepID}, state="working"|"done"|"blocked", value=<evidence or blocker>) as you start and finish each step and quest(action="evidence", id="${q.id}", kind="tests", value={command,result,at}) for test runs. ALWAYS also end your final answer with one line per step, exactly: STEP <id>: done — <what you ran and saw> (or blocked — <what is needed>), plus TESTS: <command> — passed|failed for each test run. Never create Quests and never spawn subagents.`,
  ]
  return lines.filter(Boolean).join("\n").slice(0, 4000)
}
