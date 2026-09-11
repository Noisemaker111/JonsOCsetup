/**
 * Which homes a driven host writes to.
 *
 * A drive is normally a check, so the host must not write into the real session database, quest
 * ledger, orchestration log, telemetry file or state directory. --live is the other case: another
 * harness asking the Quest Giver to do actual work on the actual board.
 *
 * This lives on its own because the failure it guards is a *partial* redirect. Every entry here is
 * one real home; forget one and an isolated check silently writes into it, which is indistinguishable
 * from a real session until something is already lost. Keeping the redirect and the live case as one
 * table makes the two modes each other's negation instead of two lists that drift apart.
 */
import { join } from "node:path"

/** Every environment variable that points the host at one of its real homes. */
export const REDIRECTED_HOMES = [
  "OPENCODE_DB",
  "OPENCODE_QUEST_ROOT",
  "OPENCODE_ORCHESTRATION_LEDGER",
  "OPENCODE_TELEMETRY_FILE",
  "XDG_STATE_HOME",
] as const

export function isolationEnvironment(out: string): Record<string, string> {
  return {
    // Project config can point a check at a different plugin set than the release under test.
    OPENCODE_CONFIG_PROJECT_DISABLE: "1",
    OPENCODE_DB: join(out, "host.db"),
    OPENCODE_QUEST_ROOT: join(out, "quests"),
    OPENCODE_ORCHESTRATION_LEDGER: join(out, "orchestration.jsonl"),
    OPENCODE_TELEMETRY_FILE: join(out, "requests.jsonl"),
    XDG_STATE_HOME: join(out, "state"),
  }
}

export function driveEnvironment(input: { base: NodeJS.ProcessEnv; root: string; out: string; live: boolean; bridgePort: number }): Record<string, string | undefined> {
  return {
    ...input.base,
    OPENCODE_CONFIG_DIR: input.root,
    OPENCODE_RELEASE_CHANNEL: "dev",
    ...(input.live ? {} : isolationEnvironment(input.out)),
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    CLAUDE_CODE_BRIDGE_PORT: String(input.bridgePort),
  }
}

/**
 * Which conversation a drive opens.
 *
 * The Quest Giver is one registered session, not a role a new session can take. A live drive that
 * started a fresh session opened onto the real board, saw its nine open Quests, and could not touch
 * one of them: the registry already names a giver, so every quest tool answers "Continue in your
 * existing Quest Giver" and the session can only chat. Driving the giver means opening the giver.
 *
 * An isolated drive is the opposite case. Its ledger and database are empty by construction, so
 * there is no registered giver to attach to and attaching to a real session id would defeat the
 * isolation entirely. It always starts fresh.
 */
export const SESSION_ID = /^ses_[A-Za-z0-9_-]+$/

export function driveSession(input: { live: boolean; pinned?: string; newSession?: boolean; registered?: { state?: string; sessionID?: unknown } }): string | undefined {
  if (input.pinned) {
    if (!SESSION_ID.test(input.pinned)) throw new Error("--session takes a ses_ identifier")
    return input.pinned
  }
  if (!input.live || input.newSession) return undefined
  const row = input.registered
  return row?.state === "bound" && typeof row.sessionID === "string" && SESSION_ID.test(row.sessionID) ? row.sessionID : undefined
}

/**
 * Which model and agent a drive imposes on the conversation it opens.
 *
 * A new session needs both chosen for it. An existing one already has them, and they belong to
 * whoever owns that conversation. Attaching to the registered Quest Giver with the channel's model
 * rewrote its lane; the forced turn then failed on an exhausted account, the host recovered by
 * switching to the replacement model's default agent, Build, and `session_v2.agent` recorded that --
 * which made the single registered giver fail its own eligibility check and left every quest tool
 * answering "The user giver must be a verified root Quest Giver".
 */
export function driveIdentity(input: { attaching: boolean; model?: string; agent?: string; chose: (flag: string) => boolean }): string[] {
  if (!input.attaching) {
    if (!input.model) throw new Error("Required: --model")
    return ["--model", input.model, "--agent", input.agent ?? "quest-giver"]
  }
  return [
    ...(input.chose("--model") && input.model ? ["--model", input.model] : []),
    ...(input.chose("--agent") && input.agent ? ["--agent", input.agent] : []),
  ]
}

/**
 * What counts as this run's work finishing.
 *
 * In a sandbox every Quest is new, so "any completed worker session" could only mean this run's. On
 * the real board it means "any worker that ever succeeded", and it fires immediately: a live drive
 * asked to dispatch a step of Quest 7f2d0f45 reported ok after 49s with zero tokens and the step
 * still pending, because a session from 2026-09-06 on that same Quest was marked completed.
 *
 * So a live condition has to name something that did not exist when the prompt was sent. Sessions
 * carry `updatedAt`; a step does not, but the `stage-state` event that set it does. A step that
 * merely moved is not a step that finished, so both halves are required.
 */
export type QuestRecord = {
  stages?: { status?: string }[]
  sessions?: { state?: string; updatedAt?: string }[]
  history?: { type?: string; at?: string }[]
}

export function conditionMet(input: { condition: "quest-step-done" | "worker-completed"; live: boolean; promptAt: number; quests: QuestRecord[] }): boolean {
  const since = (value: unknown) => { const at = Date.parse(String(value ?? "")); return Number.isFinite(at) && at >= input.promptAt }
  return input.quests.some(quest => {
    if (input.condition === "worker-completed")
      return (quest.sessions ?? []).some(s => s.state === "completed" && (!input.live || since(s.updatedAt)))
    const done = (quest.stages ?? []).some(s => s.status === "done")
    if (!done) return false
    return !input.live || (quest.history ?? []).some(e => e?.type === "stage-state" && since(e.at))
  })
}
