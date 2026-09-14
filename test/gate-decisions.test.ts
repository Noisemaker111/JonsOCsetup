/**
 * @core-prevents the installed activation gate selecting an empty duplicate Quest, mistaking a planned record for a worker, or claiming completion before return and reservation evidence exist
 * @core-observed The 53-run gate passed 26 times and failed 27 across twelve wait predicates; duplicate titles, refused session slots and late worker returns were recorded causes.
 */
import { expect, test } from "bun:test"
import {
  automaticReturn,
  boardVisible,
  boundSession,
  detailSelected,
  latestBoundSession,
  latestRunSavedResult,
  nudgeReply,
  questSettled,
  runQuestPair,
  sessionSettled,
  transcriptVisible,
  workerTranscriptHeaderVisible,
} from "../scripts/gate-decisions"

test("pair selection chooses the newest bound records instead of title-only duplicates", () => {
  const quests = [
    { id: "empty", title: "primary", createdAt: "2026-09-14T10:00:00.000Z", sessions: [{ state: "planned" }] },
    { id: "worked", title: "primary", createdAt: "2026-09-14T10:01:00.000Z", sessions: [{ sessionID: "ses_worker", state: "executing", runID: "run-1" }] },
    { id: "sibling", title: "sibling", createdAt: "2026-09-14T10:01:01.000Z", sessions: [{ openCodeSessionId: "ses_sibling", state: "executing", runID: "run-2" }] },
  ]
  const pair = runQuestPair(quests, "primary", "sibling")
  expect(pair.primary?.id).toBe("worked")
  expect(pair.sibling?.id).toBe("sibling")
  expect(pair.complete).toBe(true)
  expect(latestBoundSession({ ...pair.primary!, sessions: [{ state: "planned" }, ...pair.primary!.sessions!] })?.sessionID).toBe("ses_worker")
  expect(boundSession({ state: "planned" })).toBe(false)
})

test("completion needs the matching settled reservation, not elapsed or title evidence", () => {
  const session = { sessionID: "ses_worker", runID: "run-1", state: "completed" }
  expect(sessionSettled(session, [])).toBe(false)
  expect(sessionSettled(session, [{ runID: "run-other", state: "settled" }])).toBe(false)
  expect(sessionSettled(session, [{ runID: "run-1", state: "active" }])).toBe(false)
  expect(sessionSettled(session, [{ runID: "run-1", state: "settled" }])).toBe(true)
  expect(questSettled({ id: "q", sessions: [{ state: "planned" }, session] }, [{ runID: "run-1", state: "settled" }])).toBe(true)
  const newerActive = { sessionID: "ses_new", runID: "run-2", state: "executing", attempt: 2, updatedAt: "2026-09-14T10:02:00.000Z", deliverables: ["inspect"] }
  const staleSuccess = { ...session, attempt: 1, updatedAt: "2026-09-14T10:01:00.000Z", deliverables: ["inspect"], result: "Host reported execution succeeded" }
  const quest = { id: "q", stages: [{ id: "inspect", status: "done", note: "INSTALLED_QUEST_WORKER_VERIFIED" }], sessions: [staleSuccess, newerActive] }
  expect(latestBoundSession(quest)?.runID).toBe("run-2")
  expect(questSettled(quest, [{ runID: "run-1", state: "settled" }])).toBe(false)
  expect(latestRunSavedResult(quest, [], "INSTALLED_QUEST_WORKER_VERIFIED")).toBe(false)
  const completedLatest = { ...newerActive, state: "completed", result: "Host reported execution succeeded" }
  const returned = { type: "user", text: "Automatic Quest worker update for primary\nINSTALLED_QUEST_WORKER_VERIFIED", metadata: { questWorkerReturn: true, questID: "q", runID: "run-2" } }
  expect(latestRunSavedResult({ ...quest, title: "primary", sessions: [staleSuccess, completedLatest] }, [returned, { type: "assistant", finish: "stop", time: { completed: 1 } }], "INSTALLED_QUEST_WORKER_VERIFIED")).toBe(true)
})

test("frame and transcript decisions distinguish the board, detail and native worker views", () => {
  const board = "Quests · project\nSearch quests\nInstalled single giver project 1"
  const detail = `${board}\n${" ".repeat(40)}Installed single giver project 1\nQUEST STEPS`
  const transcript = "Installed single giver project 1\nINSTALLED_QUEST_WORKER_VERIFIED"
  expect(boardVisible(board)).toBe(true)
  expect(detailSelected(board, "Installed single giver project 1")).toBe(false)
  expect(detailSelected(detail, "Installed single giver project 1")).toBe(true)
  expect(transcriptVisible(transcript, "Installed single giver project 1", "INSTALLED_QUEST_WORKER_VERIFIED")).toBe(true)
  expect(transcriptVisible(`${transcript}\nSearch quests`, "Installed single giver project 1", "INSTALLED_QUEST_WORKER_VERIFIED")).toBe(false)
  expect(workerTranscriptHeaderVisible("QUEST WORKER\nInstalled single giver project 1 · completed\ncliproxyapi/gpt-5.6-luna (max reasoning)", "Installed single giver project 1")).toBe(true)
  expect(workerTranscriptHeaderVisible("QUEST WORKER\nInstalled single giver project 1 · completed\nSearch quests", "Installed single giver project 1")).toBe(false)
})

test("return decisions require ordered completed assistant evidence", () => {
  const title = "Installed single giver project 1"
  const notice = { type: "user", text: `Automatic Quest worker update for ${title}`, metadata: { questWorkerReturn: true, questID: "q", runID: "run-1" } }
  const assistant = { type: "assistant", finish: "stop", time: { completed: 1 } }
  expect(automaticReturn([assistant, notice], title).received).toBe(false)
  expect(automaticReturn([notice, { type: "assistant", finish: "length", time: { completed: 1 } }], title).received).toBe(false)
  expect(automaticReturn([notice, assistant], title, { questID: "q", runID: "run-1" }).received).toBe(true)
  expect(automaticReturn([notice, assistant], title, { questID: "q", runID: "run-1", marker: "INSTALLED_QUEST_WORKER_VERIFIED" }).received).toBe(false)
  expect(automaticReturn([{ ...notice, text: `${notice.text}\nINSTALLED_QUEST_WORKER_VERIFIED` }, assistant], title, { questID: "q", runID: "run-1", marker: "INSTALLED_QUEST_WORKER_VERIFIED" }).received).toBe(true)
  const siblingNotice = { type: "user", text: "Automatic Quest worker update for sibling", metadata: { questWorkerReturn: true, questID: "sibling", runID: "run-sibling" } }
  expect(automaticReturn([notice, siblingNotice, assistant], title, { questID: "q", runID: "run-1" }).received).toBe(true)
  expect(automaticReturn([notice, { type: "user", text: "A manual prompt" }, assistant], title, { questID: "q", runID: "run-1" }).received).toBe(false)
  expect(automaticReturn([notice, assistant], title, { questID: "q", runID: "run-old" }).received).toBe(false)
  expect(nudgeReply([
    { type: "user", text: "Reply exactly NATIVE_BOARD_NUDGE_CONFIRMED" },
    { type: "assistant", finish: "stop", time: { completed: 1 }, content: [{ type: "text", text: "NATIVE_BOARD_NUDGE_CONFIRMED" }] },
  ], "NATIVE_BOARD_NUDGE_CONFIRMED")).toBe(true)
  expect(nudgeReply([{ type: "user", text: "NATIVE_BOARD_NUDGE_CONFIRMED" }], "NATIVE_BOARD_NUDGE_CONFIRMED")).toBe(false)
  expect(nudgeReply([
    { type: "user", text: "NATIVE_BOARD_NUDGE_CONFIRMED" },
    { type: "user", text: "another prompt" },
    { type: "assistant", finish: "stop", time: { completed: 1 }, content: [{ type: "text", text: "NATIVE_BOARD_NUDGE_CONFIRMED" }] },
  ], "NATIVE_BOARD_NUDGE_CONFIRMED")).toBe(false)
})
