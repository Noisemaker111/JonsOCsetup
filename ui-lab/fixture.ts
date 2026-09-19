/**
 * One deterministic fixture for every OpenCode2 Quest surface in the UI lab.
 *
 * Nothing here touches the real ledger under the home directory: the caller
 * hands in a throwaway directory, OPENCODE_QUEST_ROOT is pinned to it, and the
 * The quests are shaped so every lane and every visual state is on screen at
 * once — running, waiting, blocked, ready to turn in, brand new, archived, and
 * a v2 contract Quest — which is what a redesign pass needs to see.
 */
import { QuestStore } from "../quest/store"
import { stagesFromSteps } from "../quest/steps"
import { projectIdentity } from "../quest/project"
import type { Quest, QuestSession } from "../quest/types"

const NOW = Date.now()
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString()
const MIN = 60_000, HOUR = 60 * MIN

/** Quest ids are 26-char ULIDs; keep them stable so captures diff cleanly. */
export const IDS = {
  working: "0000000000000000000000wrk1",
  contract: "0000000000000000000000ctr1",
  attention: "0000000000000000000000att1",
  ready: "0000000000000000000000rdy1",
  fresh: "0000000000000000000000new1",
  archived: "0000000000000000000000arc1",
} as const

function session(input: Partial<QuestSession> & Pick<QuestSession, "callID" | "state">): QuestSession {
  return { role: "worker", runtime: "native", evidence: [], deliverables: [], attempt: 1, updatedAt: iso(MIN), parentID: "ses_giver_lab_parent00001", ...input }
}

export type LabProject = { id: string; root: string }

/** The project the board filters by: the repo this lab lives in, resolved the same way the host does. */
export function labProject(repoRoot: string): LabProject {
  const identity = projectIdentity(repoRoot)
  return { id: identity.id, root: identity.root }
}

export function seedQuestLedger(dir: string, project: LabProject): QuestStore {
  process.env.OPENCODE_QUEST_ROOT = dir
  const store = new QuestStore(dir)
  const repos = [project.root]
  const scope = { blastRadius: "quest plugin UI", risk: "low" as const, repos, include: ["quest/tui-active/**"], exclude: [] }

  // 1. Legacy (v1) Quest, mid-flight: the richest detail view. RUNNING lane.
  store.create({
    id: IDS.working, title: "Redesign the Quest board, sidebar and footer", project, scope,
    objective: "Make the Quest board readable at a glance: one clear hierarchy, calmer color, denser step list, and a footer that reads like a status bar instead of a log. Keep every click target the current board has.",
    createdAt: iso(3 * HOUR), updatedAt: iso(2 * MIN),
    stages: stagesFromSteps([
      { title: "Capture before shots of every surface", status: "done" },
      { title: "Audit the current color and type hierarchy", status: "done" },
      { title: "Sketch the board list and detail pane in Paper", status: "done", detail: "Two columns; the list is the index, the pane is the record." },
      { title: "Rebuild the board list rows", status: "done" },
      { title: "Rebuild the detail pane header and action bar", status: "working", todos: ["Title, badge and progress on one line", "Action buttons as a quiet row", "Objective as the first paragraph"] },
      { title: "Restyle the step list and agent log" },
      { title: "Restyle the sidebar quest list", needs: ["rebuild-the-board-list"] },
      { title: "Restyle the footer status lines" },
      { title: "Design the Quest Web usage panel" },
      { title: "Re-capture after shots and compare" },
      { title: "Run the TUI test suite" },
    ], { scope }),
    sessions: [
      session({ callID: "c-running", state: "executing", providerID: "openai", modelID: "gpt-5.6-luna-fast", reasoningEffort: "high", fast: true, openCodeSessionId: "ses_lab_running_0a1b2c3d4e5f6g7h", task: "Rebuild the detail pane header and action bar", evidence: ["Header layout drafted; action bar compiles"], updatedAt: iso(MIN) }),
      session({ callID: "c-done", state: "completed", providerID: "anthropic", modelID: "claude-fable-5-1", reasoningEffort: "xhigh", openCodeSessionId: "ses_lab_completed_9z8y7x6w5v4u3t2s", task: "Rebuild the board list rows", result: "Rows use a 3-line layout: title, repo · status, next step. 14 tests pass.", updatedAt: iso(40 * MIN) }),
      session({ callID: "c-waiting", state: "waiting", providerID: "grok-sub", modelID: "grok-4.6", reasoningEffort: "medium", openCodeSessionId: "ses_lab_waiting_1q2w3e4r5t6y7u8i", task: "Restyle the step list and agent log", evidence: ["Waiting on the header rebuild to land"], updatedAt: iso(5 * MIN) }),
      // A retried run keeps its earlier attempt, so any surface that lists sessions instead of the
      // latest attempt per lineage draws this worker twice on adjacent rows.
      session({ callID: "c-running-2", state: "executing", resumeRoot: "c-running", resumedFrom: "c-running", attempt: 2, providerID: "openai", modelID: "gpt-5.6-luna-fast", reasoningEffort: "high", fast: true, openCodeSessionId: "ses_lab_retry_5f6g7h8i9j0k1l2m", task: "Rebuild the detail pane header and action bar", evidence: ["Second attempt after the first was interrupted"], updatedAt: iso(2 * MIN) }),
    ],
    evidence: {
      commits: [{ repo: project.root, hash: "a1b2c3d", verified: true }],
      tests: [{ command: "bun test test/quest-board.test.ts", result: "passed", at: iso(35 * MIN), summary: "14 pass" }],
      builds: [], publish: [],
      artifacts: [
        { name: "board", path: ".opencode/quests-assets/lab/before-board.png", label: "before", at: iso(3 * HOUR), verified: true },
        { name: "board", path: ".opencode/quests-assets/lab/revision-1-board.png", label: "revision 1", revision: 1, at: iso(30 * MIN), verified: true },
      ],
    },
    usageInstructions: ["Open /quests after restart; the board, sidebar and footer pick up the new styles without a config change."],
  })

  // 2. v2 contract Quest, running: exercises ContractDetail (STEPS / AGENT LOG / CHANGES / REWARD).
  store.create({
    id: IDS.contract, contractVersion: 2, title: "Add account usage to Quest Web", project, scope,
    objective: "Show usage in Quest Web", description: "Add a browser panel that shows each account's current quota windows and reset times from the typed usage API.",
    reward: "Open Quest Web and inspect current quota windows without leaving the browser.",
    createdAt: iso(90 * MIN), updatedAt: iso(4 * MIN),
    stages: stagesFromSteps([
      { title: "Expose the typed usage projection", status: "done", detail: "Quest Web receives the same account and quota contract as routing." },
      { title: "Render quota windows and reset times", status: "working", detail: "Keep missing and stale observations explicit." },
      { title: "Verify the browser flow after reload" },
    ], { scope }),
    sessions: [
      session({ callID: "c-v2", state: "executing", model: "anthropic/claude-opus-5", providerID: "anthropic", modelID: "claude-opus-5", reasoningEffort: "medium", openCodeSessionId: "ses_lab_v2_running_0p9o8i7u6y5t4r3e", task: "Render one line per source in compact mode", routingNote: "Routed to opus-5 · fable-5-1 quota window at 91%", updatedAt: iso(4 * MIN) }),
    ],
    evidence: { commits: [], tests: [], builds: [], publish: [], artifacts: [{ name: "quest-web-usage", path: ".opencode/quests-assets/lab/quest-web-usage.png", label: "before", at: iso(90 * MIN), verified: true }] },
  })

  // 3. Needs attention: a blocked step and a failed worker.
  store.create({
    id: IDS.attention, title: "Deploy the plugin generation to the OVH VPS", project, scope,
    objective: "Promote the current generation and restart the remote host.",
    createdAt: iso(6 * HOUR), updatedAt: iso(20 * MIN),
    stages: stagesFromSteps([
      { title: "Package the generation", status: "done" },
      { title: "Upload to the VPS", status: "blocked" },
      { title: "Restart and smoke test" },
    ], { scope }),
    sessions: [
      session({ callID: "c-failed", state: "failed", providerID: "openai", modelID: "gpt-5.6-luna", reasoningEffort: "medium", openCodeSessionId: "ses_lab_failed_2w3e4r5t6y7u8i9o", task: "Upload to the VPS", result: "scp exited 255: Permission denied (publickey). The deploy key on the VPS is not the one in run/keys.", updatedAt: iso(20 * MIN) }),
    ],
  })

  // 4. Ready to turn in: every step done, worker finished.
  store.create({
    id: IDS.ready, title: "Fix mid-word truncation in footer quest titles", project, scope,
    objective: "Footer titles cut at a word boundary with a single ellipsis.",
    createdAt: iso(26 * HOUR), updatedAt: iso(50 * MIN),
    stages: stagesFromSteps([
      { title: "Write fitTitle with word-boundary cut", status: "done" },
      { title: "Use it in board summaries", status: "done" },
      { title: "Regression test", status: "done" },
    ], { scope }),
    sessions: [
      session({ callID: "c-ready", state: "completed", providerID: "anthropic", modelID: "claude-sonnet-5", reasoningEffort: "low", openCodeSessionId: "ses_lab_ready_3e4r5t6y7u8i9o0p", task: "Fix footer truncation", result: "fitTitle added; 6 tests pass.", updatedAt: iso(50 * MIN) }),
    ],
    evidence: { commits: [{ repo: project.root, hash: "f00dcafe", verified: true }], tests: [{ command: "bun test test/tui-quests.test.ts", result: "passed", at: iso(50 * MIN) }], builds: [], publish: [], artifacts: [] },
    usageInstructions: ["No action needed; the footer picks the new fit on next render."],
  })

  // 5. Brand new, nothing planned yet: NEW QUESTS lane.
  store.create({
    id: IDS.fresh, title: "Investigate slow startup of the quests TUI plugin", project, scope,
    objective: "Startup of the quests plugin adds about 400ms; find out where it goes.",
    createdAt: iso(10 * MIN), updatedAt: iso(10 * MIN), kind: "investigation",
  })

  // 6. Archived, accepted.
  store.create({
    id: IDS.archived, title: "Move quest storage to the shared home ledger", project, scope,
    objective: "One ledger for every project.", createdAt: iso(3 * 24 * HOUR), updatedAt: iso(2 * 24 * HOUR),
    archive: { accepted: true, at: iso(2 * 24 * HOUR) },
    stages: stagesFromSteps([{ title: "Move storage", status: "done" }, { title: "Migrate records", status: "done" }], { scope }),
  })
  return store
}

export type { Quest }
