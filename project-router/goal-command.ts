/**
 * What `/goal` was asked to do.
 *
 * It used to accept five verbs and refuse everything else as INVALID_GOAL, so stating a goal meant
 * writing the Quest by hand first and then naming its id. Anything that is not one of those verbs is
 * the goal itself now, and bare `/goal` answers "what is running", which is what it is almost always
 * asked for.
 *
 * The decision lives here rather than inside the command handler because it is the part that
 * silently regresses: add a verb, or tighten the parse, and free text starts being refused again
 * with nothing failing.
 */
export const GOAL_VERBS = ["start", "status", "pause", "cancel", "resume"] as const

export type GoalCommand =
  | { kind: "status" }
  | { kind: "intake"; goal: string }
  | { kind: "control"; action: (typeof GOAL_VERBS)[number]; questID?: string; stepIDs?: string[] }

export function goalCommand(input: string | undefined): GoalCommand {
  const text = (input ?? "").trim()
  if (!text) return { kind: "status" }
  const [action, questID, ...stepIDs] = text.split(/\s+/)
  if (!(GOAL_VERBS as readonly string[]).includes(action)) return { kind: "intake", goal: text }
  return { kind: "control", action: action as (typeof GOAL_VERBS)[number], questID, ...(stepIDs.length ? { stepIDs } : {}) }
}
