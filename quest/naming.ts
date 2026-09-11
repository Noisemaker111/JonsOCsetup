/**
 * A Quest has to be readable from its own record. Jk reads the board and the saved .md, not the
 * conversation that produced them, and two defects made that impossible often enough to be
 * refused at the door instead of asked for in a prompt: in his ledger 37 of 79 objectives open
 * with who spoke ("Jk:", "User requests") before saying what the work is, and 20 of 289 step
 * titles are exactly "Implementation", "Verification" or "Integration", so a list of steps reads
 * as a process template rather than this task's work.
 *
 * Both checks are exact matches, never a judgement about quality. A step titled "Integration" is
 * refused; "Integration: fold the router into the dev channel" is not. An objective opening
 * "Jk: ..." is refused; one that mentions Jk in a later sentence is not. Everything softer -- a
 * title that fails to distinguish its siblings, authorization tangled into the goal sentence, a
 * pinned date that will go stale -- stays advisory in skills/quest-writing, because refusing on a
 * guess would block work over wording.
 */

/** Stages every Quest passes through; alone, none of them names what this Quest or step is. */
const STAGE_WORDS = new Set([
  "scout", "scouting", "plan", "planning", "research", "design", "implement", "implementation",
  "build", "develop", "code", "verify", "verification", "validate", "validation", "test", "testing",
  "review", "integrate", "integration", "deploy", "deployment", "deliver", "delivery", "handover",
  "handoff", "cleanup", "setup", "audit", "inventory", "finalize", "execute", "execution", "wrap up",
])

/** True only when the whole name is a stage word: "Verification" yes, "Verification: run check.mjs" no. */
export function bareStageName(value: string): boolean {
  return STAGE_WORDS.has(String(value ?? "").toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim())
}

/**
 * Attribution shapes, not the mere presence of a name: "Jk"/"Jon" leading a sentence is always the
 * speaker, and "User" counts only in front of a reporting verb, so an objective about users
 * ("Users lose their draft on reconnect") is never mistaken for one about who asked.
 */
const SPEAKER = /^\s*(?:jk|jon)\b|^\s*user\s*-?\s*(?:asks?|wants?|requests?|says?|said|picked|pivots?|directed|approved|corrected|showed|explicitly|decided|chose)\b/i

export function speakerAttribution(value: string): boolean { return SPEAKER.test(String(value ?? "")) }

/** What is wrong with this Quest's names, phrased as what to write instead. Empty means admit it. */
export function namingProblems(input: { title: string; objective: string; steps: { title: string }[] }): string[] {
  const problems: string[] = []
  const title = String(input.title ?? "").trim(), objective = String(input.objective ?? "").trim()
  if (bareStageName(title))
    problems.push(`The title "${title}" names a lifecycle stage, not an outcome. Title the Quest by what is true once the work lands, specific enough that a sibling Quest could not carry the same title.`)
  if (speakerAttribution(objective))
    problems.push(`The objective opens by naming who spoke ("${objective.slice(0, 48)}..."). Open with the goal itself: the board shows the first sentence and truncates the rest, so who asked, the authorization and the exclusions belong in later sentences.`)
  for (const step of input.steps ?? []) {
    const stepTitle = String(step?.title ?? "").trim()
    if (bareStageName(stepTitle))
      problems.push(`Step "${stepTitle}" names a lifecycle stage, not this task's work. Title it with what that step does and the result that can be checked.`)
  }
  return problems
}
