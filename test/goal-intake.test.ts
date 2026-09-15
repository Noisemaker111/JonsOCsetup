/**
 * @core-prevents a stated goal being refused by the one command that is meant to take it, so intake silently goes back to hand-writing a Quest and naming its id before anything can start
 * @core-observed Before 2026-09-12 `/goal` accepted only start, status, pause, cancel and resume and threw INVALID_GOAL at everything else — project-router/server.ts refused any first word that was not one of those five, so `/goal fix ctrl+backspace on stable` could not reach the giver at all and bare `/goal` was an error rather than "what is running".
 */
import { test, expect } from "bun:test"
import { goalCommand, GOAL_VERBS } from "../project-router/goal-command"

test("anything that is not one of the five verbs is the goal itself", () => {
  // The case that was refused outright, and the whole point of the command.
  expect(goalCommand("fix ctrl+backspace on stable")).toEqual({ kind: "intake", goal: "fix ctrl+backspace on stable" })
  expect(goalCommand("  make the gutter measurement work on a phone  ")).toEqual({ kind: "intake", goal: "make the gutter measurement work on a phone" })

  // A goal that merely begins with a word resembling a verb is still a goal.
  expect(goalCommand("started failing after the release")).toEqual({ kind: "intake", goal: "started failing after the release" })
  expect(goalCommand("Status page is down")).toEqual({ kind: "intake", goal: "Status page is down" })

  // Bare `/goal` asks what is running rather than erroring.
  for (const empty of ["", "   ", undefined]) expect(goalCommand(empty)).toEqual({ kind: "status" })

  // Operating an existing Quest keeps working exactly as before.
  expect(goalCommand("status")).toEqual({ kind: "control", action: "status", questID: undefined })
  expect(goalCommand("start 7f2d0f45 discover-access")).toEqual({ kind: "control", action: "start", questID: "7f2d0f45", stepIDs: ["discover-access"] })
  expect(goalCommand("start 7f2d0f45 one two")).toEqual({ kind: "control", action: "start", questID: "7f2d0f45", stepIDs: ["one", "two"] })
  expect(goalCommand("pause 7f2d0f45")).toEqual({ kind: "control", action: "pause", questID: "7f2d0f45" })

  // Every declared verb routes to control, so adding one cannot quietly become intake.
  for (const verb of GOAL_VERBS) expect(goalCommand(`${verb} q1`).kind).toBe("control")
})
