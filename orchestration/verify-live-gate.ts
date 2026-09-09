/**
 * VERIFY-LIVE gate: Ready must mean verified-working on the live host, not
 * "the diff looks right." A Quest whose kind changes running behavior
 * (feature, fix, migration) cannot reach Ready to complete until someone has
 * actually exercised the changed surface on the live/restarted host and
 * recorded the result. This is enforced through the existing completion
 * policy (quest/completion.ts -> completionMissing), the same fail-closed
 * checkpoint every other completion requirement already goes through — no
 * new enforcement path, no change to live dispatch.
 */
import type { Quest } from "../quest/types"
import type { QuestStore } from "../quest/store"

/** Kinds whose deliverable is running code: a live-host check is the only credible completion evidence. */
export const VERIFY_LIVE_KINDS: ReadonlySet<Quest["kind"]> = new Set(["feature", "fix", "migration"])

export function requiresVerifyLive(kind: Quest["kind"]): boolean { return VERIFY_LIVE_KINDS.has(kind) }

export type LiveCheckStatus = "not-verified" | "passed" | "failed"
export type LiveCheck = {
  status: LiveCheckStatus
  command?: string; result?: string; note?: string
  at?: string; by?: string
}
const NOT_VERIFIED: LiveCheck = { status: "not-verified" }

export function liveCheckOf(q: Pick<Quest, "extensions">): LiveCheck {
  const v = q.extensions?.verifyLive
  return v && typeof v === "object" && typeof (v as LiveCheck).status === "string" ? (v as LiveCheck) : NOT_VERIFIED
}

function patchExtensions(store: QuestStore, id: string, partial: Record<string, unknown>): Quest {
  const quest = store.read(id)
  if (!quest) throw new Error(`Quest not found: ${id}`)
  return store.apply(id, "patched", { extensions: { ...quest.extensions, ...partial } })
}

/**
 * Record the outcome of exercising the changed surface on the live/running
 * host — after a restart or hot reload, not against a staged diff. Called
 * once the surface has actually been retried post-restart, per Jk: "restarting
 * and it correctly working should be the completion criteria."
 */
export function recordLiveCheck(store: QuestStore, id: string, result: "passed" | "failed", command: string, note?: string, by?: string): Quest {
  if (!command.trim()) throw new Error("VERIFY-LIVE evidence requires the command/steps run against the live host, not just a verdict")
  const check: LiveCheck = { status: result, command: command.trim(), result, note, at: new Date().toISOString(), by }
  return patchExtensions(store, id, { verifyLive: check })
}

/** completion.ts wires this in so VERIFY-LIVE shares the same fail-closed checkpoint as every other gate. */
export function verifyLiveMissing(q: Pick<Quest, "kind" | "extensions">): string[] {
  if (!requiresVerifyLive(q.kind)) return []
  const check = liveCheckOf(q)
  if (check.status === "passed") return []
  return check.status === "failed"
    ? ["VERIFY-LIVE gate (last live-host check failed; re-run the changed surface on the live host after restart/reload and record a passing result)"]
    : ["VERIFY-LIVE gate (no live-host check recorded yet; exercise the changed surface on the running host after restart/reload and record the result)"]
}
