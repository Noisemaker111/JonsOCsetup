/**
 * Keep one tool result from owning the rest of the session.
 *
 * A tool result is written into the conversation once and then re-sent on every later request, so
 * an oversized one is not paid for once: it is paid for on every remaining turn. Measured on this
 * installation, read results are 24.6M tokens across 1,203 sessions and a single read reached
 * 180,453 characters -- about 45,000 tokens resident for the rest of that conversation.
 *
 * Truncation is only safe when the model can tell it happened and can get the rest, so the marker
 * names the tool, the exact characters elided and the way to retrieve them. Head and tail are both
 * kept: the head carries what the result is, the tail carries how it ended.
 */
export type BudgetPolicy = { maxCharacters: number; headFraction: number }
export const DEFAULT_RESULT_BUDGET: BudgetPolicy = { maxCharacters: 24000, headFraction: 0.7 }

/** Retrieval advice has to name a real next step, or truncation just loses the work. */
const retrieval: Record<string, string> = {
  read: "call read again with offset and limit for the part you need",
  grep: "narrow the pattern, add a path filter, or raise offset",
  glob: "narrow the pattern",
  list: "list a deeper path",
  bash: "rerun piping through a filter so only the needed lines return",
  shell: "rerun piping through a filter so only the needed lines return",
  webfetch: "request a narrower section of the page",
  execute: "return only the fields you need from the code you run",
}

export function budgetText(text: string, tool: string, policy: BudgetPolicy = DEFAULT_RESULT_BUDGET): string {
  const limit = policy.maxCharacters
  if (!Number.isFinite(limit) || limit <= 0) throw new Error("Result budget must be a positive character limit")
  if (policy.headFraction <= 0 || policy.headFraction >= 1) throw new Error("Result budget head fraction must be between 0 and 1")
  if (text.length <= limit) return text
  // Reserve room for the marker itself so the budgeted result never exceeds the limit it advertises.
  const marker = (elided: number) =>
    `\n\n[... ${elided.toLocaleString()} characters elided by the session result budget of ${limit.toLocaleString()} ` +
    `— this result was truncated before entering the conversation, where it would be re-sent on every later turn. ` +
    `To see the elided part, ${retrieval[tool] ?? "run a narrower query"}. ...]\n\n`
  const sample = marker(text.length)
  const room = limit - sample.length
  if (room < 200) return text.slice(0, Math.max(0, limit))
  const head = Math.floor(room * policy.headFraction)
  const tail = room - head
  return text.slice(0, head) + marker(text.length - head - tail) + text.slice(text.length - tail)
}

/** Mutates the hook's result in place; the host hands us the same object it will store. */
export function applyResultBudget(event: any, policy: BudgetPolicy = DEFAULT_RESULT_BUDGET): number {
  if (!event || event.status !== "completed") return 0
  const content = event.result?.content
  if (!Array.isArray(content)) return 0
  let saved = 0
  for (const part of content) {
    if (!part || part.type !== "text" || typeof part.text !== "string") continue
    const budgeted = budgetText(part.text, String(event.tool ?? ""), policy)
    if (budgeted === part.text) continue
    saved += part.text.length - budgeted.length
    part.text = budgeted
  }
  return saved
}
