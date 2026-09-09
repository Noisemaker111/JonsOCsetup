/**
 * The Quest list/detail/action logic the TUI renders, tested without a host.
 *
 * These used to be expressions inside JSX, so the only way to check that
 * "Turn in" is hidden on a Waiting Quest was to look at the file.
 */
import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { newQuest } from "../quest/schema"
import { QuestStore } from "../quest/store"
import {
  applyQuestAction,
  questActions,
  questDetailFields,
  questErrorText,
  questPickerRows,
  questRowLabel,
  questSessionLabel,
  questSidebarLine,
  questsForSession,
} from "../quest/tui-controller"
import type { Quest } from "../quest/types"

function quest(patch: Partial<Quest> = {}): Quest {
  return { ...newQuest({ id: "01j00000000000000000000001", title: "Repair the chrome", objective: "o" }), ...patch }
}

test("a list row names the state, title, live execution and remaining deliverables", () => {
  const q = quest({
    state: "Working",
    executingCount: 2,
    deliverables: [
      { id: "a", title: "a", status: "done" },
      { id: "b", title: "b", status: "pending" },
    ],
  })
  expect(questRowLabel(q)).toBe("Working · Repair the chrome · 2 executing · 1 remaining")
})

test("a sidebar line drops the remaining count when nothing is left", () => {
  expect(questSidebarLine(quest({ state: "Waiting" }))).toBe("Waiting · Repair the chrome")
  expect(questSidebarLine(quest({ state: "Waiting", deliverables: [{ id: "b", title: "b", status: "pending" }] })))
    .toBe("Waiting · Repair the chrome · 1 left")
})

test("detail fields carry state, reason, next action and what is still missing", () => {
  const q = quest({ state: "Waiting", reason: "No linked sessions", nextAction: "Start one", missingRequirements: ["passing tests"] })
  expect(questDetailFields(q)).toEqual([
    "Repair the chrome",
    "Waiting · No linked sessions",
    "Next: Add steps",
    "Sessions: 0 · Remaining: passing tests",
  ])
  expect(questDetailFields(quest({ missingRequirements: [] }))[3]).toContain("Remaining: none")
})

test("complete and turn-in only appear once the Quest is finishable, and turn-in confirms", () => {
  expect(questActions(quest({ state: "Waiting" })).map((a) => a.id)).toEqual(["accept", "start-session", "archive", "abandon", "delete"])
  const ready = questActions(quest({ state: "Ready to complete" }))
  expect(ready.map((a) => a.id)).toEqual(["accept", "start-session", "complete", "turn-in", "archive", "abandon", "delete"])
  expect(ready.find((a) => a.id === "turn-in")?.confirm).toBeTruthy()
  expect(ready.find((a) => a.id === "complete")?.confirm).toBeUndefined()
  expect(questActions(quest({ state: "Complete" })).map((a) => a.id)).toContain("turn-in")
})

test("questsForSession matches both the working session and its parent", () => {
  const mine = quest({ id: "01j00000000000000000000002", sessions: [{ callID: "c", role: "worker", state: "executing", sessionID: "ses_a", evidence: [], deliverables: [], attempt: 1, updatedAt: "" }] })
  const child = quest({ id: "01j00000000000000000000003", sessions: [{ callID: "d", role: "worker", state: "executing", parentID: "ses_a", evidence: [], deliverables: [], attempt: 1, updatedAt: "" }] })
  const other = quest({ id: "01j00000000000000000000004" })
  expect(questsForSession([mine, child, other], "ses_a").map((q) => q.id)).toEqual([mine.id, child.id])
})

test("the picker includes archived Quests so reopen and delete remain reachable", () => {
  const archived = quest({ id: "01j00000000000000000000008", state: "Archived" })
  const rows = questPickerRows([archived])
  expect(rows.some((row) => row.kind === "quest" && row.quest.id === archived.id)).toBe(true)
  expect(rows.some((row) => row.kind === "header" && row.lane === "archived")).toBe(true)
})

test("a failed verb is bounded text, not a throw at the host", () => {
  const dir = mkdtempSync(join(tmpdir(), "quest-controller-"))
  try {
    const store = new QuestStore(dir)
    const missing = applyQuestAction(store, "accept", "01j00000000000000000000009")
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error).toContain("Quest not found")

    const created = store.create({ id: "01j0000000000000000000000a", title: "Real", objective: "o" })
    const accepted = applyQuestAction(store, "accept", created.id, { callID: "call-1" })
    expect(accepted.ok).toBe(true)
    if (accepted.ok) expect(accepted.quest.sessions).toEqual([])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("error text is bounded so a stack never becomes the whole dialog", () => {
  expect(questErrorText(new Error("x".repeat(500))).length).toBe(180)
  expect(questErrorText("plain")).toBe("plain")
})
