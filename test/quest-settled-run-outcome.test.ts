/**
 * @core-prevents a settled Quest run's status row falling back to "Checking owning host…" instead of the outcome we recorded
 * @core-observed 2026-09-16: PR #184 moved the worker picker to the recorded outcome but left the board detail's AGENT LOG on the live observation, which is polled only for owned non-terminal runs, so scripts/gate-decisions.ts detailCompleted could never match and the activation gate could not pass.
 */
import { expect, test } from "bun:test"
import { observedRun } from "../quest/activity"

const live = { state: "running", reason: "Owning host confirms an active execution" }
const inspect = () => live

test("a settled run reports the outcome we recorded, not a live inspection", () => {
  expect(observedRun({ state: "completed", result: "Host reported execution succeeded" } as any, inspect)).toEqual({ state: "completed", reason: "Host reported execution succeeded" })
  for (const settled of ["failed", "cancelled", "missing", "stale"]) expect(observedRun({ state: settled } as any, inspect)).toEqual({ state: settled, reason: "Recorded outcome" })
})

test("a live run is still inspected", () => {
  for (const state of ["planned", "executing", "waiting", "blocked"]) expect(observedRun({ state } as any, inspect)).toEqual(live)
})
