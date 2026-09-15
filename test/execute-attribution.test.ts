/**
 * @core-prevents summing overlapping Code Mode inner-call spans, which attributes more time to tools than the execute span contains and turns a duration view into an invented accounting
 * @core-observed Code Mode's own tool description tells the model to "run independent calls concurrently with Promise.all", and it does: on the live ledger 370 of 1,571 execute parts made more than one inner call, one of them 24, and a real two-call execute at ses_fb8d52e45ffeOkAbLTy9mC4b7s seq 6395 ran running_tasks and quest together inside a 61 ms span that summing would have charged as ~120 ms (2026-09-11).
 */
import { expect, test } from "bun:test"
import { attributeExecutePart, attributionTotals, innerToolStats, mergedLength } from "../context-graph/execute-attribution"
import { ExecuteTiming } from "../context-graph/execute-timing"

const part = (inner: unknown[], time: { created: number; ran: number; completed: number }) => ({
  type: "tool", id: "call_x", name: "execute",
  state: { status: "completed", metadata: { toolCalls: inner.map(() => ({ tool: "t", status: "completed" })), innerCalls: inner } },
  time,
})

test("parallel inner calls are merged, never summed, and the remainder is reported as unaccounted", () => {
  const span = attributeExecutePart(part([
    { tool: "running_tasks", start: 1000, end: 1300, status: "completed" },
    { tool: "quest", start: 1100, end: 1400, status: "completed" },
  ], { created: 900, ran: 1000, completed: 1500 }), "ses_a", 1)!

  expect(span.durationMs).toBe(500)
  // 1000..1400 covered once, not 300 + 300.
  expect(span.attributedMs).toBe(400)
  expect(span.unaccountedMs).toBe(100)
  expect(span.attributedMs + span.unaccountedMs).toBe(span.durationMs)
  expect(span.queuedMs).toBe(100)
  // The remainder is placed by where it sits, and the four phases are exact.
  expect([span.startupMs, span.betweenMs, span.tailMs]).toEqual([0, 0, 100])
  expect(span.startupMs + span.attributedMs + span.betweenMs + span.tailMs).toBe(span.durationMs)
  // Each tool is still charged its own duration, because that is what a slow tool costs.
  expect(innerToolStats([span]).map(t => t.tool + ":" + t.totalMs).sort()).toEqual(["quest:300", "running_tasks:300"])
})

test("an inner span reaching past the execute window is charged only for the window", () => {
  const span = attributeExecutePart(part([{ tool: "quest", start: 500, end: 9000, status: "interrupted" }], { created: 900, ran: 1000, completed: 1500 }), "ses_a", 1)!
  expect(span.attributedMs).toBe(500)
  expect(span.unaccountedMs).toBe(0)
})

test("a gap between calls is charged to the program, not to the tools on either side", () => {
  const span = attributeExecutePart(part([
    { tool: "quest", start: 1000, end: 1100, status: "completed" },
    { tool: "usage_status", start: 1400, end: 1450, status: "completed" },
  ], { created: 1000, ran: 1000, completed: 1500 }), "ses_a", 1)!
  expect(span.attributedMs).toBe(150)
  expect([span.startupMs, span.betweenMs, span.tailMs]).toEqual([0, 300, 50])
  expect(span.startupMs + span.attributedMs + span.betweenMs + span.tailMs).toBe(span.durationMs)
})

test("calls that never reach a host tool are named, not counted as instrumentation that missed", () => {
  // `search` resolves against the Code Mode runtime's own catalog; a call the runtime rejects on
  // its signature check is recorded `error` without ever being dispatched. Neither can fire a hook.
  const span = attributeExecutePart({
    type: "tool", id: "call_s", name: "execute",
    state: { status: "completed", metadata: { toolCalls: [{ tool: "search", status: "completed" }, { tool: "quest_work_supply", status: "error" }] } },
    time: { created: 1000, ran: 1000, completed: 1080 },
  }, "ses_a", 1)!
  expect(span.calls).toBe(2)
  expect(span.untimed).toEqual([{ tool: "search", status: "completed" }, { tool: "quest_work_supply", status: "error" }])
  expect(span.timed).toBe(false)
  const totals = attributionTotals([span])
  expect(totals.untimedCalls).toEqual({ search: 1, quest_work_supply: 1 })
  expect(totals.untimedRejected).toBe(1)
})

test("an execute with no recorded spans is counted as unattributed, not left out of the total", () => {
  const timed = attributeExecutePart(part([{ tool: "quest", start: 1000, end: 1400, status: "completed" }], { created: 1000, ran: 1000, completed: 1500 }), "ses_a", 1)!
  const untimed = attributeExecutePart({ type: "tool", id: "call_y", name: "execute", state: { status: "error" }, time: { created: 0, ran: 0, completed: 500 } }, "ses_a", 2)!
  const totals = attributionTotals([timed, untimed])
  expect(totals.executes).toBe(2)
  expect(totals.untimed).toBe(1)
  expect(totals.spanMs).toBe(1000)
  expect(totals.attributedMs).toBe(400)
  expect(totals.unaccountedMs).toBe(600)
  expect(totals.coverage).toBeCloseTo(0.8)
  expect(totals.coverageOfAll).toBeCloseTo(0.4)
})

test("inner calls are recognised by sharing the enclosing execute's call id, and direct calls are not", () => {
  const timing = new ExecuteTiming()
  timing.before("ses_a", "call_direct", "read", 1000)
  expect(timing.after("ses_a", "call_direct", "read", "completed", 1050)).toBeUndefined()

  timing.before("ses_a", "call_e", "execute", 2000)
  timing.before("ses_a", "call_e", "quest", 2010)
  timing.before("ses_a", "call_e", "quest", 2020)
  timing.after("ses_a", "call_e", "quest", "error", 2100)
  // The second quest call is never awaited, so it is still open when the program returns.
  const spans = timing.after("ses_a", "call_e", "execute", "completed", 2200)!
  expect(spans).toEqual([
    { tool: "quest", start: 2010, end: 2100, status: "error" },
    { tool: "quest", start: 2020, end: 2200, status: "interrupted" },
  ])
  // The frame is closed, so a late duplicate cannot resurrect it.
  expect(timing.after("ses_a", "call_e", "execute", "completed", 2300)).toBeUndefined()
})

test("mergedLength unions touching and nested intervals", () => {
  expect(mergedLength([{ start: 0, end: 10 }, { start: 10, end: 20 }])).toBe(20)
  expect(mergedLength([{ start: 0, end: 100 }, { start: 20, end: 30 }])).toBe(100)
  expect(mergedLength([{ start: 0, end: 10 }, { start: 50, end: 60 }])).toBe(20)
  expect(mergedLength([])).toBe(0)
})
