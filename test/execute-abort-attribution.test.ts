/**
 * @core-prevents charging an interrupted Code Mode execute's span as execution time, which makes a handful of abandoned calls look like the entire cost of Code Mode and sends optimisation work at tools that were never running
 * @core-observed On the live ledger three execute parts recorded {type:"aborted"} carried 5,890.6s of a 7,724.4s total span -- 76% -- and one of them, ses_f7bc68f69ffeg0S3kYdkugcAKO seq 5, had an uninterrupted twin at ses_f7bc4e0cfffeFBNcyHA1B8tOIS seq 5 that ran the identical program in 45.9s. Excluding the aborted parts drops the total to 1,833.8s (2026-09-11).
 */
import { expect, test } from "bun:test"
import { attributeExecutePart, attributionTotals } from "../context-graph/execute-attribution"

/** Exactly what the host stores on an execute it interrupted, down to the error shape. */
const aborted = (ms: number) => attributeExecutePart({
  type: "tool", id: "call_abort", name: "execute",
  state: { status: "error", input: { code: "await tools.quest({action:'update'})" }, error: { type: "aborted", message: "Tool execution interrupted: execute" } },
  time: { created: 0, ran: 0, completed: ms },
}, "ses_abandoned", 5)!

const ran = (ms: number) => attributeExecutePart({
  type: "tool", id: "call_ok", name: "execute",
  state: { status: "completed", metadata: { toolCalls: [{ tool: "quest", status: "completed" }], innerCalls: [{ tool: "quest", start: 0, end: ms, status: "completed" }] } },
  time: { created: 0, ran: 0, completed: ms },
}, "ses_finished", 5)!

test("an interrupted execute is marked aborted and an ordinary failure is not", () => {
  expect(aborted(4_704_500).aborted).toBe(true)
  expect(ran(45_900).aborted).toBe(false)
  // A tool part that errored for a reason of its own still ran; only the host's abort is excluded.
  const failed = attributeExecutePart({
    type: "tool", id: "call_bad", name: "execute",
    state: { status: "error", error: { type: "unknown", message: "ReferenceError: tools.nope is not a function" } },
    time: { created: 0, ran: 0, completed: 120 },
  }, "ses_a", 1)!
  expect(failed.aborted).toBe(false)
})

test("aborted spans are reported as themselves and kept out of the span every share is taken of", () => {
  // The real ratio: two abandoned calls beside one that ran the same program to completion.
  const totals = attributionTotals([aborted(4_704_500), aborted(1_180_300), ran(45_900)])
  expect(totals.executes).toBe(1)
  expect(totals.aborted).toBe(2)
  expect(totals.abortedMs).toBe(5_884_800)
  expect(totals.spanMs).toBe(45_900)
  // Without the split, coverage would read 0.8% and the tools would look blameless by accident.
  expect(totals.attributedMs).toBe(45_900)
  expect(totals.coverage).toBe(1)
  expect(totals.coverageOfAll).toBe(1)
})
