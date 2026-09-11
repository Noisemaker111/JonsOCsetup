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
