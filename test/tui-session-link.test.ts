/**
 * The clickable-session-id feature end to end, without a host: a native
 * worker's id resolves through navigateQuestSession to a real
 * {type:"session"} route, and a session with nothing to route to (external
 * harness, or one the live session.get can't confirm) falls back to a
 * dialog instead of a dead click.
 *
 * A real testRender of the board (showing the id as visible, clickable text)
 * lives in scripts/session-link-demo-capture.tsx instead of here: @opentui/solid
 * needs its renderer registered via `--preload @opentui/solid/preload`
 * (see scripts/quest-board-demo-capture.tsx), which bunfig.toml's [test]
 * preload does not include, so testRender inside `bun test` throws an
 * unrelated "Orphan text" reconciler error. Run the capture script directly
 * for the rendered fixture.
 */
import { expect, test } from "bun:test"
import { navigateQuestSession } from "../quest/tui-navigation"
import { liveWorkerLines, openWorkerSession, shortSessionID, subagentChipLabel, workerLabel, workerStatusLine } from "../quest/tui-active/quest-board"
import { subagentChipLabel as dispatchChipLabel } from "../orchestration/dispatch"
import { fitTitle, footerWidth, FOOTER_MAX_LINES } from "../quest/tui-active/quest-board"

test("shortSessionID truncates a long id and passes a short one through unchanged", () => {
  expect(shortSessionID(undefined)).toBeUndefined()
  expect(shortSessionID("ses_short")).toBe("ses_short")
  const long = "ses_f9216da1dffeuXqOYjixsUMsCW"
  expect(shortSessionID(long)).toBe(`${long.slice(0, 20)}…`)
})

test("workerLabel always names the model, tags fast only for a fast variant, and shows the reasoning level next to it", () => {
  expect(workerLabel({ providerID: "cliproxyapi", modelID: "gpt-5.6-sol", reasoningEffort: "xhigh", fast: false } as any)).toBe("cliproxyapi/gpt-5.6-sol (xhigh reasoning)")
  expect(workerLabel({ providerID: "openai", modelID: "gpt-5.6-luna-fast", reasoningEffort: "medium", fast: true } as any)).toBe("openai/gpt-5.6-luna-fast (fast · medium reasoning)")
  // A non-fast worker never gets a "fast" label.
  expect(workerLabel({ providerID: "grok-sub", modelID: "grok-4.6", fast: false } as any)).toBe("grok-sub/grok-4.6")
  expect(workerLabel({ agentRole: "worker" } as any)).toBe("worker")
})

test("workerStatusLine renders the live-footer line for each non-terminal state and hides terminal ones", () => {
  const quest = { title: "Ship live worker lines" } as any
  expect(workerStatusLine(quest, { state: "executing", providerID: "openai", modelID: "gpt-5.6-luna-fast", reasoningEffort: "high", fast: true } as any))
    .toBe("🟢 Running — Ship live worker lines — openai/gpt-5.6-luna-fast, high, fast")
  expect(workerStatusLine(quest, { state: "waiting", providerID: "grok-sub", modelID: "grok-4.6", reasoningEffort: "medium" } as any))
    .toBe("🟡 Waiting — Ship live worker lines — grok-sub/grok-4.6, medium")
  expect(workerStatusLine(quest, { state: "blocked", providerID: "cliproxyapi", modelID: "gpt-5.6-sol", reasoningEffort: "xhigh" } as any))
    .toBe("🔴 Blocked — Ship live worker lines — cliproxyapi/gpt-5.6-sol, xhigh")
  // A session with no model/reasoning yet omits those parts — never a raw placeholder on the face.
  expect(workerStatusLine(quest, { state: "planned" } as any))
    .toBe("⚪ Planned — Ship live worker lines")
  // Terminal states are not "live" — they never show in the footer.
  for (const state of ["completed", "failed", "cancelled", "missing", "stale"]) {
    expect(workerStatusLine(quest, { state, providerID: "openai", modelID: "gpt-5.6-sol" } as any)).toBeUndefined()
  }
})

test("footer lines fit realistic widths: short-title word-boundary ellipsis, never mid-word, never over budget", () => {
  const quest = { title: "Make a Restart plugin for the thing that restarts things cleanly" } as any
  const session = { state: "executing", providerID: "openai", modelID: "gpt-5.6-sol", reasoningEffort: "high" } as any
  for (const width of [80, 120]) {
    const line = workerStatusLine(quest, session, width)!
    expect(line.length).toBeLessThanOrEqual(width)
    expect(line).not.toContain("...")
    expect(line).not.toContain("pending")
  }
  // At 120 the full title survives; at 80 it is whole words plus one "…".
  expect(workerStatusLine(quest, session, 120)!).toContain(quest.title)
  const line80 = workerStatusLine(quest, session, 80)!
  expect(line80).toContain("…")
  const kept = line80.split(" — ")[1]!.slice(0, -1)
  expect(quest.title.startsWith(kept)).toBe(true)
  expect(quest.title[kept.length]).toBe(" ")
  // Short titles pass through untouched at both widths.
  const short = { title: "Ship live worker lines" } as any
  expect(workerStatusLine(short, session, 80)).toBe("🟢 Running — Ship live worker lines — openai/gpt-5.6-sol, high")
  expect(workerStatusLine(short, session, 120)).toBe("🟢 Running — Ship live worker lines — openai/gpt-5.6-sol, high")
})

test("fitTitle cuts only between words and footerWidth falls back narrow without a renderer", () => {
  expect(fitTitle("Make a Restart plugin", 100)).toBe("Make a Restart plugin")
  expect(fitTitle("Make a Restart plugin for things", 18)).toBe("Make a Restart…")
  expect(footerWidth(undefined)).toBe(78)
  expect(footerWidth({ renderer: { width: 120 } })).toBe(118)
})

test("liveWorkerLines caps at the two most recent rows so the footer never collides with the composer hint", () => {
  expect(FOOTER_MAX_LINES).toBe(2)
  const mk = (id: string, at: string) => ({ id, title: `Quest ${id}`, updatedAt: at, sessions: [{ state: "executing", providerID: "openai", modelID: "gpt-5.6-sol", reasoningEffort: "high" }] }) as any
  const rows = liveWorkerLines([mk("a", "2026-09-01T00:00:00.000Z"), mk("b", "2026-09-02T00:00:00.000Z"), mk("c", "2026-09-03T00:00:00.000Z")])
  expect(rows.map((r) => r.questID)).toEqual(["c", "b"])
})

test("no raw internals on the face: 'model pending' and 'reasoning pending' never render", () => {
  const quest = { title: "Q" } as any
  for (const session of [{ state: "executing" }, { state: "waiting" }, { state: "planned" }] as any[]) {
    expect(workerStatusLine(quest, session)!).not.toContain("pending")
  }
})
test("the board chip is the dispatch chip: one format, so the host description renders exactly this string", () => {
  const quest = { title: "Ship live worker lines" } as any
  const faces = [
    { providerID: "openai", modelID: "gpt-5.6-luna-fast", reasoningEffort: "high", fast: true },
    { providerID: "grok-sub", modelID: "grok-4.6", reasoningEffort: "medium" },
    { providerID: "claude-code", modelID: "sonnet" },
    {},
  ] as any[]
  for (const session of faces) {
    expect(subagentChipLabel(quest, session)).toBe(dispatchChipLabel(quest, session))
  }
  expect(subagentChipLabel(quest, faces[0])).toBe("(Ship live worker lines, openai/gpt-5.6-luna-fast, high, fast)")
  expect(subagentChipLabel(quest, faces[3])).toBe("(Ship live worker lines)")
})
test("liveWorkerLines flattens every quest's live sessions, newest quest first, each row 1:1 with its Quest id for the click target", () => {
  const older = { id: "quest-older", title: "Older quest", updatedAt: "2026-09-01T00:00:00.000Z", sessions: [{ state: "executing", providerID: "openai", modelID: "gpt-5.6-sol", reasoningEffort: "high" }] } as any
  const newer = { id: "quest-newer", title: "Newer quest", updatedAt: "2026-09-04T00:00:00.000Z", sessions: [{ state: "waiting", providerID: "grok-sub", modelID: "grok-4.6", reasoningEffort: "low" }, { state: "completed", providerID: "openai", modelID: "gpt-5.6-sol" }] } as any
  expect(liveWorkerLines([older, newer])).toEqual([
    { questID: "quest-newer", line: "🟡 Waiting — Newer quest — grok-sub/grok-4.6, low" },
    { questID: "quest-older", line: "🟢 Running — Older quest — openai/gpt-5.6-sol, high" },
  ])
})

test("navigateQuestSession resolves a native worker's id to a real session route", async () => {
  const session: any = {
    callID: "c1", role: "worker", state: "executing", providerID: "claude-code", modelID: "sonnet",
    runtime: "native", openCodeSessionId: "ses_child123", parentID: "ses_parent1",
    evidence: [], deliverables: [], attempt: 1, updatedAt: "",
  }
  const navigated: any[] = []
  const context = {
    client: { session: { get: async ({ sessionID }: any) => ({ data: { id: sessionID, parentID: "ses_parent1" } }) } },
    ui: { router: { navigate: (route: any) => navigated.push(route) } },
  }
  const ok = await navigateQuestSession(context, session)
  expect(ok).toBe(true)
  expect(navigated).toEqual([{ type: "session", sessionID: "ses_child123" }])
})

test("openWorkerSession falls back to a dialog when there is no live route — the closest real thing, not a dead click", async () => {
  const session: any = {
    callID: "c2", role: "worker", state: "failed", providerID: "codex", modelID: "default",
    runtime: "claude-code", harness: "codex", parentID: "ses_parent1",
    evidence: [], deliverables: [], attempt: 1, updatedAt: "",
  }
  const alerts: any[] = []
  const context = {
    client: { session: { get: async () => { throw new Error("no session") } } },
    ui: { dialog: { alert: async (opts: any) => alerts.push(opts) } },
  }
  await openWorkerSession(context, session)
  expect(alerts.length).toBe(1)
  expect(alerts[0].message).toContain("external codex process")
})
