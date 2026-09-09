/**
 * One deterministic fixture for every quest / usage surface in the UI lab.
 *
 * Nothing here touches the real ledger under the home directory: the caller
 * hands in a throwaway directory, OPENCODE_QUEST_ROOT is pinned to it, and the
 * usage collector is pointed at fixture files so no network probe ever runs.
 * The quests are shaped so every lane and every visual state is on screen at
 * once — running, waiting, blocked, ready to turn in, brand new, archived, and
 * a v2 contract Quest — which is what a redesign pass needs to see.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
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
      { title: "Restyle the /usage dialog table" },
      { title: "Re-capture after shots and compare" },
      { title: "Run the TUI test suite" },
    ], { scope }),
    sessions: [
      session({ callID: "c-running", state: "executing", providerID: "openai", modelID: "gpt-5.6-luna-fast", reasoningEffort: "high", fast: true, openCodeSessionId: "ses_lab_running_0a1b2c3d4e5f6g7h", task: "Rebuild the detail pane header and action bar", evidence: ["Header layout drafted; action bar compiles"], updatedAt: iso(MIN) }),
      session({ callID: "c-done", state: "completed", providerID: "anthropic", modelID: "claude-fable-5-1", reasoningEffort: "xhigh", openCodeSessionId: "ses_lab_completed_9z8y7x6w5v4u3t2s", task: "Rebuild the board list rows", result: "Rows use a 3-line layout: title, repo · status, next step. 14 tests pass.", updatedAt: iso(40 * MIN) }),
      session({ callID: "c-waiting", state: "waiting", providerID: "grok-sub", modelID: "grok-4.6", reasoningEffort: "medium", openCodeSessionId: "ses_lab_waiting_1q2w3e4r5t6y7u8i", task: "Restyle the step list and agent log", evidence: ["Waiting on the header rebuild to land"], updatedAt: iso(5 * MIN) }),
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
    id: IDS.contract, contractVersion: 2, title: "Add a compact mode to the /usage dialog", project, scope,
    objective: "Compact /usage", description: "Add a one-line-per-source compact mode to the /usage dialog so ten configured sources fit in a 40-row terminal without a scrollbar. Default stays the full table; compact is a click on the header.",
    reward: "Type /usage, click Compact in the header. Each source collapses to one line: name, worst window bar, reset.",
    createdAt: iso(90 * MIN), updatedAt: iso(4 * MIN),
    stages: stagesFromSteps([
      { title: "Add a compact flag to UsageTable", status: "done", detail: "Signal in UsageDialog, passed as a prop." },
      { title: "Render one line per source in compact mode", status: "working", detail: "Worst-percent window wins the bar." },
      { title: "Header toggle and test coverage" },
    ], { scope }),
    sessions: [
      session({ callID: "c-v2", state: "executing", model: "anthropic/claude-opus-5", providerID: "anthropic", modelID: "claude-opus-5", reasoningEffort: "medium", openCodeSessionId: "ses_lab_v2_running_0p9o8i7u6y5t4r3e", task: "Render one line per source in compact mode", routingNote: "Routed to opus-5 · fable-5-1 quota window at 91%", updatedAt: iso(4 * MIN) }),
    ],
    evidence: { commits: [], tests: [], builds: [], publish: [], artifacts: [{ name: "usage", path: ".opencode/quests-assets/lab/before-usage.png", label: "before", at: iso(90 * MIN), verified: true }] },
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
      { title: "Use it in workerStatusLine", status: "done" },
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

/** Usage cache + telemetry fixture; returns the env the usage plugin reads. */
export function seedUsageFixture(dir: string): Record<string, string> {
  mkdirSync(dir, { recursive: true })
  const env = {
    OPENCODE_ACCOUNT_DISCOVERY_ROOT: dir,
    OPENCODE_ACCOUNT_USAGE_FILE: join(dir, "accounts.json"),
    OPENCODE_USAGE_CACHE_FILE: join(dir, "cache.json"),
    OPENCODE_TELEMETRY_FILE: join(dir, "requests.jsonl"),
  }
  Object.assign(process.env, env)
  const win = (label: string, pct: number, used: number, cap: number | null, resetsInSeconds: number, status = "ok") =>
    ({ label, usedTokens: Math.round(used * 4_000_000), used, cap, pct, remaining: null, estimated: false, resetsInSeconds, status, provenance: "provider-observed" })
  const cache = {
    updated: new Date(NOW).toISOString(), cacheAgeSeconds: 0, maxAgeSeconds: 900,
    sources: [
      { id: "opencode-go", kind: "sub", source: "local-db", windows: [win("5h", 34, 4.1, 12, 2 * 3600 + 14 * 60), win("7d", 65, 21.85, 30, 47 * 3600), win("30d", 41, 61.2, 150, 19 * 24 * 3600)] },
      { id: "claude-code", kind: "sub", source: "oauth", windows: [win("5h", 91, 0, null, 52 * 60, "warn"), win("7d", 58, 0, null, 3 * 24 * 3600)] },
      { id: "grok-sub", kind: "sub", source: "probe", windows: [win("5h", 12, 0, null, 4 * 3600)] },
      { id: "openai", kind: "sub", source: "oauth", windows: [win("5h", 100, 0, null, 38 * 60, "rate-limited"), win("7d", 77, 0, null, 5 * 24 * 3600)] },
      { id: "openrouter", kind: "api", source: "api", windows: [{ label: "7d", usedTokens: 12_400_000, used: 18.42, cap: null, pct: null, remaining: null, estimated: true, resetsInSeconds: null, status: "ok", prediction: { state: "unlikely", confidence: "low", horizonSeconds: null } }, { label: "30d", usedTokens: 51_000_000, used: 64.9, cap: 100, pct: null, remaining: null, estimated: true, resetsInSeconds: 12 * 24 * 3600, status: "ok" }] },
      { id: "cursor", kind: "sub", source: "probe", windows: [] },
    ],
  }
  writeFileSync(env.OPENCODE_USAGE_CACHE_FILE, JSON.stringify(cache, null, 2))
  writeFileSync(env.OPENCODE_ACCOUNT_USAGE_FILE, JSON.stringify({ updated: new Date(NOW).toISOString(), accounts: [] }))
  const request = (i: number, input: number, cacheRead: number, output: number, reasoning: number, context: number) => JSON.stringify({
    version: 1, request: {
      id: `lab-request-${i}`, sessionID: "ses_lab_giver", route: { providerID: "anthropic", modelID: "claude-fable-5-1" }, kind: "chat",
      startedAt: NOW - (12 - i) * 90_000, completedAt: NOW - (12 - i) * 90_000 + 40_000, firstVisibleAt: NOW - (12 - i) * 90_000 + 3_000, lastOutputAt: NOW - (12 - i) * 90_000 + 40_000,
      state: "completed", tokens: { input, cacheRead, cacheWrite: 0, output, reasoning }, context: { tokens: context, source: "provider", at: NOW - (12 - i) * 90_000 },
    },
  })
  const lines: string[] = []
  for (let i = 1; i <= 12; i++) lines.push(request(i, 1_200 + i * 300, 18_000 + i * 6_000, 900 + i * 120, 400 + i * 60, 24_000 + i * 7_500))
  writeFileSync(env.OPENCODE_TELEMETRY_FILE, lines.join("\n") + "\n")
  return env
}

export type { Quest }
