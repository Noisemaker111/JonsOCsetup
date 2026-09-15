/**
 * @core-prevents a drive that can only be waited on from outside, and its opposite: a settle that reports finished while the host is still printing, that accepts the per-second poll it exists to replace, or that throws on a timeout and so abandons the capture and the stop that follow it in the queue
 * @core-observed On 2026-09-12 a Codex session drove OpenCode2 for a day and spent 247M tokens on 790 tool calls that gathered 1.0M tokens of information. 88 of those calls were `wait` with yield_time_ms 1000, waiting 108 seconds in total for driven turns to finish: about 29M tokens, 268k per second waited, because commands.jsonl had no way to say "wait for the host to go quiet" and the only place left to wait was across tool calls, each replaying the whole conversation to the model and again to the approvals reviewer.
 */
import { test, expect } from "bun:test"
import { settleBounds, settleOutcome, SETTLE_QUIET_MS, SETTLE_TIMEOUT_MS } from "../scripts/drive-settle"

test("settle resolves on quiet, reports a timeout instead of throwing, and refuses a poll interval", () => {
  const bounds = settleBounds({})
  expect(bounds).toEqual({ quiet: SETTLE_QUIET_MS, limit: SETTLE_TIMEOUT_MS })

  // Still printing is not finished. A settle that resolves here captures a half-rendered answer and
  // the drive reports a screen the host had not written yet.
  const deadline = 100_000
  expect(settleOutcome(bounds, 1_000, 1_000 + bounds.quiet - 1, deadline)).toBeUndefined()
  expect(settleOutcome(bounds, 1_000, 1_000 + bounds.quiet, deadline)).toEqual({ settled: true, idle_ms: bounds.quiet })

  // The deadline resolves rather than throws, and says plainly that it did not settle, because the
  // frame of a host still working is the evidence you want and the queue still has to reach `stop`.
  const stuck = settleOutcome(bounds, deadline - 10, deadline, deadline)
  expect(stuck).toEqual({ settled: false, idle_ms: 10 })

  // The floor is the point of the action: waiting a second at a time is what a caller had to do
  // across tool calls, and doing it inside the drive at the same interval saves nothing.
  expect(() => settleBounds({ quiet_ms: 100 })).toThrow()
  expect(() => settleBounds({ quiet_ms: 2_500.5 })).toThrow()
  expect(() => settleBounds({ timeout_ms: 1_000 })).toThrow()
  expect(settleBounds({ quiet_ms: 250, timeout_ms: 250 })).toEqual({ quiet: 250, limit: 250 })
})
