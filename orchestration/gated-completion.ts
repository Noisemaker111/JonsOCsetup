/**
 * Gated auto-completion: a Quest carrying a recorded Jk yes completes and
 * archives automatically once its VERIFY-LIVE check passes. Without a
 * recorded yes, a Quest that clears every other gate stops at "Ready to
 * complete" and waits for Jk to read it and turn it in — matching Jk:
 * "then I read it and turn it in post-restart." Auto-turn-in is therefore
 * opt-in per Quest, never silent: nothing archives without an explicit,
 * attributed approval recorded first.
 */
import type { Quest } from "../quest/types"
import type { QuestStore } from "../quest/store"
import { completionMissing } from "../quest/completion"
import { liveCheckOf } from "./verify-live-gate"

export type JkApprovalStatus = "pending" | "yes"
export type JkApproval = { status: JkApprovalStatus; at?: string; by?: string; note?: string }
const NO_APPROVAL: JkApproval = { status: "pending" }

export function jkApprovalOf(q: Pick<Quest, "extensions">): JkApproval {
  const v = q.extensions?.jkApproval
  return v && typeof v === "object" && typeof (v as JkApproval).status === "string" ? (v as JkApproval) : NO_APPROVAL
}

function patchExtensions(store: QuestStore, id: string, partial: Record<string, unknown>): Quest {
  const quest = store.read(id)
  if (!quest) throw new Error(`Quest not found: ${id}`)
  return store.apply(id, "patched", { extensions: { ...quest.extensions, ...partial } })
}

/** The only call that arms auto turn-in. Caller must be Jk's explicit yes — never inferred, never called automatically. */
export function recordJkApproval(store: QuestStore, id: string, by: string, note?: string): Quest {
  if (!by.trim()) throw new Error("Jk approval requires an explicit approver (Jk); refusing an anonymous or empty approver")
  const approval: JkApproval = { status: "yes", at: new Date().toISOString(), by: by.trim(), note }
  const quest = patchExtensions(store, id, { jkApproval: approval })
  return maybeAutoCompleteAndArchive(store, quest.id)
}

/**
 * If (and only if) a Jk-yes is on record and every completion gate —
 * including VERIFY-LIVE — is satisfied, complete and archive the Quest in
 * one atomic pass and say so in the ledger. Otherwise this is a no-op: a
 * Quest with no recorded yes stops at Ready to complete no matter how green
 * its gates are.
 */
export function maybeAutoCompleteAndArchive(store: QuestStore, id: string): Quest {
  const current = store.read(id)
  if (!current) throw new Error(`Quest not found: ${id}`)
  if (["Complete", "Archived"].includes(current.state)) return current
  if (jkApprovalOf(current).status !== "yes") return current
  const missing = completionMissing(current, (dependencyID) => store.read(dependencyID))
  if (missing.length) return current
  const approval = jkApprovalOf(current)
  const live = liveCheckOf(current)
  const completed = store.apply(id, "complete", {})
  return store.apply(id, "archive", {
    reason: `Auto-archived: Jk approved (${approval.by}, ${approval.at}) and VERIFY-LIVE passed (${live.at ?? "n/a"})`,
  }, "quest:gated-auto-completion")
}
