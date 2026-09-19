import { requestFingerprint } from "./privacy"
import type { Quest } from "./types"

/** A Quest still owns its request until the work is finished or the record is archived. */
export function unresolved(q: Quest): boolean { return !["Archived", "Complete"].includes(q.state) }
/** Wording, punctuation and casing are presentation; the request underneath is what must be admitted once. */
export function normalizeRequestText(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() }
export function questRequestFingerprint(input: { projectID?: string; title: string; objective: string }): string {
  return requestFingerprint({ project: input.projectID ?? "", title: normalizeRequestText(input.title), objective: normalizeRequestText(input.objective) })
}
const significantWords = (value: string) => new Set(normalizeRequestText(value).split(" ").filter((x) => x.length > 3))
/**
 * How much of the shorter statement the longer one already says. A retry rewords the
 * request and usually adds words ("A missing provider credential must show ... instead of
 * silently dropping the prompt"), which containment keeps near 1 where an overlap ratio
 * would not. Below three significant words there is not enough of a statement to compare,
 * so only identical text counts.
 */
export function requestOverlap(a: string, b: string): number {
  const left = significantWords(a), right = significantWords(b)
  if (left.size < 3 || right.size < 3) return normalizeRequestText(a) === normalizeRequestText(b) ? 1 : 0
  let shared = 0
  for (const word of left) if (right.has(word)) shared++
  return shared / Math.min(left.size, right.size)
}
export const NEAR_IDENTICAL = 0.7
export function exactFingerprintMatch(quests: Quest[], fingerprint: string): Quest | undefined { return quests.find((q) => q.requestFingerprint === fingerprint && unresolved(q)) }
/**
 * The Quest that already holds this request for this project, if one is unresolved.
 * A retry after a failed dispatch re-states the same request in slightly different
 * words, so an exact fingerprint alone would let every retry open another Quest.
 */
export function unresolvedDuplicate(quests: Quest[], request: { projectID?: string; title: string; objective: string; fingerprint: string }): Quest | undefined {
  return quests.find((q) => unresolved(q) && (q.project?.id ?? "") === (request.projectID ?? "")
    && (q.requestFingerprint === request.fingerprint
      || normalizeRequestText(q.objective) === normalizeRequestText(request.objective)
      || requestOverlap(q.title, request.title) >= NEAR_IDENTICAL))
}
