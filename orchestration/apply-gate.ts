/**
 * Ask-before-apply gate for system-owning code.
 *
 * A Quest whose claimed files fall under a system-owning path (the Quest
 * system's own source, the orchestration layer, model routing, or plugins)
 * cannot reach "complete" until Jk has explicitly recorded approval via
 * approveApplyGate. This is enforced through the existing completion policy
 * (quest/completion.ts -> completionMissing), the same fail-closed checkpoint
 * every other completion requirement already goes through — no new
 * enforcement path, no change to live dispatch.
 */
import type { Quest } from "../quest/types"
import type { QuestStore } from "../quest/store"

/** Paths whose changes self-modify the system that runs Quests, not a Quest's ordinary deliverable. */
export const SYSTEM_OWNED_GLOBS = ["quest/**", "orchestration/**", "models/**", "plugins/**", "plugins-active/**", "papercut/**"] as const

function systemOwnedDir(glob: string): string { return glob.replace(/\/\*\*$/, "") }

/** True if any path (repo-relative, either slash style) falls under a system-owned directory. */
export function touchesSystemOwnedPaths(paths: string[]): boolean {
  return paths.some((raw) => {
    const p = raw.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "")
    return SYSTEM_OWNED_GLOBS.some((glob) => { const dir = systemOwnedDir(glob); return p === dir || p.startsWith(`${dir}/`) })
  })
}

/** Every path a Quest currently claims: top-level file claims plus per-stage claims. Both are the existing scope mechanism (quest/claims.ts, quest/task-scope.ts); this reads them, it does not add a new one. */
export function questClaimedPaths(q: Pick<Quest, "claims" | "stages">): string[] {
  return [...q.claims.flatMap((c) => c.include), ...q.stages.flatMap((s) => s.claim?.include ?? [])]
}

export type ApplyGateStatus = "not-requested" | "pending-approval" | "approved" | "denied"
export type ApplyGate = {
  status: ApplyGateStatus
  requestedAt?: string; requestedPaths?: string[]; note?: string
  approvedAt?: string; approvedBy?: string
  deniedAt?: string; deniedReason?: string
}
const NOT_REQUESTED: ApplyGate = { status: "not-requested" }

export function applyGateOf(q: Pick<Quest, "extensions">): ApplyGate {
  const g = q.extensions?.applyGate
  return g && typeof g === "object" && typeof (g as ApplyGate).status === "string" ? (g as ApplyGate) : NOT_REQUESTED
}

function patchExtensions(store: QuestStore, id: string, partial: Record<string, unknown>): Quest {
  const quest = store.read(id)
  if (!quest) throw new Error(`Quest not found: ${id}`)
  return store.apply(id, "patched", { extensions: { ...quest.extensions, ...partial } })
}

/** A worker stages a proposed fix and asks Jk to look at it. Does not approve anything. */
export function requestApplyApproval(store: QuestStore, id: string, paths: string[], note?: string): Quest {
  const prior = applyGateOf(store.read(id) ?? { extensions: {} })
  const gate: ApplyGate = { ...prior, status: "pending-approval", requestedAt: new Date().toISOString(), requestedPaths: paths, note: note ?? prior.note }
  return patchExtensions(store, id, { applyGate: gate })
}

/** The only call that unblocks a system-owning fix. Caller must be Jk's explicit yes — never called automatically. */
export function approveApplyGate(store: QuestStore, id: string, approvedBy: string, note?: string): Quest {
  if (!approvedBy.trim()) throw new Error("Apply-gate approval requires an explicit approver (Jk); refusing an anonymous or empty approver")
  const prior = applyGateOf(store.read(id) ?? { extensions: {} })
  const gate: ApplyGate = { ...prior, status: "approved", approvedAt: new Date().toISOString(), approvedBy: approvedBy.trim(), note: note ?? prior.note }
  return patchExtensions(store, id, { applyGate: gate })
}

export function denyApplyGate(store: QuestStore, id: string, reason: string): Quest {
  const prior = applyGateOf(store.read(id) ?? { extensions: {} })
  const gate: ApplyGate = { ...prior, status: "denied", deniedAt: new Date().toISOString(), deniedReason: reason }
  return patchExtensions(store, id, { applyGate: gate })
}

/** completion.ts wires this into completionMissing so gate + regular gates share one fail-closed checkpoint. */
export function applyGateMissing(q: Pick<Quest, "extensions" | "claims" | "stages">): string[] {
  if (!touchesSystemOwnedPaths(questClaimedPaths(q))) return []
  return applyGateOf(q).status === "approved" ? [] : ["apply gate approval (Jk must explicitly approve this system-owning fix before it can complete)"]
}
