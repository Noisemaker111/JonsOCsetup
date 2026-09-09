import { expect, test } from "bun:test"
import { newQuest } from "../quest/schema"
import { renderFrame, questIndicator } from "../quest/tui-model"
import { registerQuestHost } from "../quest/host"
const states = ["Waiting", "Working", "Needs attention", "Verifying", "Ready to complete", "Complete", "Archived"] as const
const qs = states.map((state, i) => ({ ...newQuest({ id: `01j0000000000000000000000${i}`, title: `Q${i}`, objective: "x" }), state }))
const q = qs[0]
test("framebuffer overview/detail are bounded at narrow and wide widths", () => { expect(questIndicator([q])).toBe("0 to turn in, 0 active, 0 verifying, 1 waiting/new"); for (const width of [40, 120]) { expect(renderFrame([q], { type: "overview" }, width).lines.every((x) => x.length <= width)).toBe(true); expect(renderFrame([q], { type: "detail", questID: q.id }, width).lines.every((x) => x.length <= width)).toBe(true) } })
test("indicator reports honest lane counts, not one raw non-archived total, and never shows archived", () => {
  expect(questIndicator(qs)).toBe("2 to turn in, 0 active, 1 need attention, 1 verifying, 2 waiting/new")
  expect(questIndicator(qs)).not.toContain("archived")
  const overview = renderFrame(qs, { type: "overview" }, 120)
  expect(overview.lines[0]).toBe("2 to turn in, 0 active, 1 need attention, 1 verifying, 2 waiting/new")
  expect(overview.lines).toContain("Needs attention")
  expect(overview.lines).toContain("Assigned")
  expect(overview.lines).toContain("Unassigned")
  expect(overview.lines).toContain("Ready to turn in")
  expect(overview.lines.join("\n")).toContain("Ready for you to turn in")
  expect(overview.lines.join("\n")).toContain("Waiting Q0")
  expect(renderFrame([q], { type: "detail", questID: q.id }, 120).lines.join("\n")).toContain("[Accept] [Execute] [Complete] [Turn in]")
})
test("host registration tolerates unavailable APIs and disposes all registrations", () => { const calls: string[] = []; const dispose = registerQuestHost({ slot: (n: string) => { calls.push(n); return () => calls.push("disposed") }, command: (n: string) => { calls.push(n); return () => calls.push("disposed") }, palette: () => () => calls.push("disposed"), width: 80 }, () => [q]); expect(calls).toContain("home-right"); expect(calls).toContain("/quests"); expect(calls).toContain("quest.accept"); expect(calls).toContain("quest.execute"); dispose(); expect(calls.filter((x) => x === "disposed").length).toBe(14); expect(() => registerQuestHost({}, () => [])()).not.toThrow() })


test("blocked quests are attention, idle assigned quests remain visible, and resumed attempts count once", () => {
  const base = newQuest({id: "counts", title: "Counts", objective: "x"});
  const session = {callID: "run", sessionID: "session", role: "worker", state: "executing" as const, evidence: [], deliverables: [], attempt: 1, updatedAt: "2026-09-05T00:00:00Z"};
  expect(questIndicator([{...base, state: "Needs attention"}])).toBe("0 to turn in, 0 active, 1 need attention, 0 verifying, 0 waiting/new");
  expect(questIndicator([{...base, owner: "worker"}])).toBe("0 to turn in, 0 active, 0 verifying, 1 waiting/new");
  expect(questIndicator([{...base, state: "Needs attention", sessions: [session]}])).toContain("1 active, 1 need attention");
  expect(questIndicator([{...base, sessions: [session, {...session, callID: "retry", resumeRoot: "run", attempt: 2, state: "completed"}]}])).toContain("0 active");
  expect(questIndicator([{...base, state: "Archived", sessions: [session]}])).toBe("0 to turn in, 0 active, 0 verifying, 0 waiting/new");
});
