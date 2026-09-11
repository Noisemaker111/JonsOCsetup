/**
 * Keep one tool result from owning the rest of the session.
 *
 * A tool result is written into the conversation once and then re-sent on every later request, so
 * an oversized one is not paid for once: it is paid for on every remaining turn. Measured on this
 * installation, tool results are 87% of everything a Quest Giver carries -- 5,960,317 characters
 * across 108 giver sessions against 455,054 characters of assistant text.
 *
 * The results that hurt are structured, not prose. A giver opens by listing every Quest and reading
 * account usage, and both snapshots saturate the host's 51,200-byte tool-output clamp, which cuts
 * mid-structure: the model then carries ~12,800 tokens of invalid JSON for the rest of the session.
 * Two of those in the opening turns is the difference between a session that settles near 8,000
 * tokens and one that opens above 20,000 and re-sends it every turn.
 *
 * So a structured result is shrunk the way its shape allows, in order:
 *   1. Re-serialize compactly. Code Mode pretty-prints returned values with two-space indentation,
 *      which is 25-49% of these nested payloads, and dropping it loses nothing at all.
 *   2. Elide by shape -- bound arrays and long strings -- keeping valid JSON the model can still
 *      parse, with exact counts of what was dropped.
 * Prose falls back to a head and tail slice: the head carries what the result is, the tail carries
 * how it ended. Either way the marker names the tool, what was elided and how to retrieve it, so
 * the model can tell truncation happened and can go get the rest.
 *
 * Structured results get the tighter of the two budgets, because elision leaves them usable: every
 * field is still present, only repetition thins out, and the model can re-query the exact entry it
 * wants. Prose has neither property -- its bytes are its content and there is nothing to ask for
 * more precisely -- so it keeps the larger budget.
 */
export type BudgetPolicy = { maxCharacters: number; structuredCharacters: number; headFraction: number }
export const DEFAULT_RESULT_BUDGET: BudgetPolicy = { maxCharacters: 24000, structuredCharacters: 8000, headFraction: 0.7 }

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

const advice = (tool: string) => retrieval[tool] ?? "run a narrower query"

type Elision = { items: number; characters: number }

const measure = (value: unknown) => JSON.stringify(value)?.length ?? 4
const ITEM_MARKER = 34
const TEXT_MARKER = 26
/** Below this an entry is markers rather than content, so the tail is dropped instead. */
const MIN_ENTRY = 48
/** The note names the tool and what was dropped, so it has to be paid for out of the budget. */
const NOTE_ROOM = 320

/**
 * Fits a value into a character budget by giving every field an equal share and letting the fields
 * that need less hand the rest back. One enormous subtree therefore costs the small fields nothing:
 * an account snapshot keeps its plans, pools and resets whole and spends what is left on the
 * per-session tally that made it enormous.
 *
 * Repetition is what gets traded away. Arrays drop whole trailing entries and say how many, and long
 * strings are clipped. Object keys go last, because every key of a result means something different
 * and a missing one reads as an absent fact rather than an elided one -- when a budget cannot hold
 * them all, the expensive ones go and their names stay.
 */
function fit(value: unknown, budget: number, elided: Elision): unknown {
  if (measure(value) <= budget) return value
  if (typeof value === "string") {
    const keep = Math.max(0, budget - TEXT_MARKER)
    elided.characters += value.length - keep
    return value.slice(0, keep) + `…[+${value.length - keep} characters]`
  }
  // Under one entry's worth of room there is nothing to say about contents, so the value is
  // replaced by its shape: how many entries an array held, which keys an object had. A reader can
  // still see what exists and ask for it by name, which a bare character count never allows.
  if (budget < MIN_ENTRY && value && typeof value === "object") {
    elided.items += 1
    elided.characters += measure(value)
    const shape = Array.isArray(value)
      ? `…[${value.length} entries elided]`
      : `…{${Object.keys(value as Record<string, unknown>).join(",")}}`
    return shape.length <= Math.max(budget, MIN_ENTRY) ? shape : shape.slice(0, Math.max(budget, MIN_ENTRY) - 2) + "…}"
  }
  if (Array.isArray(value)) {
    // Order is the array's meaning, so entries are kept from the front -- but only as many as can
    // still say something. Beyond that the tail is dropped whole and counted, rather than every
    // entry being shaved until none of them carries a fact.
    const room = Math.max(0, budget - 2 - ITEM_MARKER)
    const keep = Math.min(value.length, Math.max(1, Math.floor(room / MIN_ENTRY)))
    const kept: unknown[] = []
    let left = room
    let remaining = keep
    for (const item of value.slice(0, keep)) {
      const shrunk = fitted(item, Math.max(0, Math.floor(left / remaining) - 1), elided)
      kept.push(shrunk)
      left -= measure(shrunk) + 1
      remaining--
    }
    while (kept.length > 1 && measure(kept) > room) kept.pop()
    if (kept.length < value.length) {
      elided.items += value.length - kept.length
      kept.push(`…[+${value.length - kept.length} more entries elided]`)
    }
    return kept
  }
  if (value && typeof value === "object") {
    // Cheapest first, so every field that already fits is settled before the expensive ones divide
    // what remains. Without the ordering a single huge field would take an equal share it cannot use,
    // and it also decides which keys survive a budget too small to hold them all: the cheap ones are
    // the ids, states and percentages a reader acts on, and the names of the rest are still listed.
    const entries = Object.entries(value as Record<string, unknown>).sort((a, b) => measure(a[1]) - measure(b[1]))
    const room = Math.max(0, budget - 2)
    const chosen = entries.slice(0, Math.max(1, Math.floor(room / MIN_ENTRY)))
    const dropped = entries.slice(chosen.length).map(([key]) => key)
    const kept: Record<string, unknown> = {}
    let left = room - (dropped.length ? ITEM_MARKER + dropped.join(", ").length : 0)
    let remaining = chosen.length
    for (const [key, item] of chosen) {
      const overhead = key.length + 4
      const shrunk = fitted(item, Math.max(0, Math.floor(left / remaining) - overhead), elided)
      kept[key] = shrunk
      left -= measure(shrunk) + overhead
      remaining--
    }
    // Object.entries order is the insertion order of the original, which the caller wrote for a
    // reader; the size ordering above is an allocation detail and does not belong in the result.
    const ordered: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>)) if (key in kept) ordered[key] = kept[key]
    if (dropped.length) {
      elided.items += dropped.length
      ordered["…elided"] = dropped.join(", ")
    }
    return ordered
  }
  return value
}

/**
 * A marker can cost more than the share it replaced, so a share is retried tighter until what comes
 * back actually fits it. Below one entry's worth there is nothing left to trade, and the smallest
 * form -- a shape, or a clipped string -- is returned even though it overruns: an empty field would
 * cost the reader more than a few characters cost the budget, and budgetText re-checks the total
 * against the real limit before anything reaches the conversation.
 */
function fitted(value: unknown, budget: number, elided: Elision): unknown {
  for (let room = budget; room >= MIN_ENTRY; room = Math.floor(room * 0.6)) {
    const attempt: Elision = { items: 0, characters: 0 }
    const result = fit(value, room, attempt)
    if (measure(result) > budget) continue
    elided.items += attempt.items
    elided.characters += attempt.characters
    return result
  }
  return fit(value, Math.max(0, Math.min(budget, MIN_ENTRY - 1)), elided)
}

/** Only a JSON container can be re-shaped; a bare number or a string is just text. */
function container(text: string): unknown {
  const first = text.trimStart()[0]
  if (first !== "{" && first !== "[") return undefined
  try {
    const value = JSON.parse(text)
    return value && typeof value === "object" ? value : undefined
  } catch {
    return undefined
  }
}

/** The note rides inside the value, so what reaches the model is still parseable JSON. */
function noted(value: unknown, note: string): string {
  if (Array.isArray(value)) return JSON.stringify([...value, note])
  return JSON.stringify({ ...(value as Record<string, unknown>), resultBudget: note })
}

export function budgetText(text: string, tool: string, policy: BudgetPolicy = DEFAULT_RESULT_BUDGET): string {
  const limit = policy.maxCharacters
  const structured = policy.structuredCharacters ?? limit
  if (!Number.isFinite(limit) || limit <= 0) throw new Error("Result budget must be a positive character limit")
  if (!Number.isFinite(structured) || structured <= 0) throw new Error("Structured result budget must be a positive character limit")
  if (policy.headFraction <= 0 || policy.headFraction >= 1) throw new Error("Result budget head fraction must be between 0 and 1")
  if (text.length <= Math.min(limit, structured)) return text

  const value = container(text)
  if (value !== undefined) {
    // Indentation carries no information, so removing it is not truncation and needs no marker.
    const compact = JSON.stringify(value)
    if (compact.length <= structured) return compact
    // Fair shares overshoot slightly where a marker costs more than the share it replaced, so the
    // budget is retried smaller until the promised limit actually holds.
    for (let room = structured - NOTE_ROOM; room > 200; room = Math.floor(room * 0.8)) {
      const elided: Elision = { items: 0, characters: 0 }
      const shrunk = fitted(value, room, elided)
      const note =
        `Result budget ${structured.toLocaleString()} characters: elided ${elided.items.toLocaleString()} entries and ` +
        `${elided.characters.toLocaleString()} characters from a ${text.length.toLocaleString()}-character result before it ` +
        `entered the conversation, where it would be re-sent on every later turn. To see the elided part, ${advice(tool)}.`
      const candidate = noted(shrunk, note)
      if (candidate.length <= structured) return candidate
    }
  }
  if (text.length <= limit) return text

  // Reserve room for the marker itself so the budgeted result never exceeds the limit it advertises.
  const marker = (elided: number) =>
    `\n\n[... ${elided.toLocaleString()} characters elided by the session result budget of ${limit.toLocaleString()} ` +
    `— this result was truncated before entering the conversation, where it would be re-sent on every later turn. ` +
    `To see the elided part, ${advice(tool)}. ...]\n\n`
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
