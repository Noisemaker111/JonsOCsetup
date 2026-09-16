/**
 * @core-prevents a finished dependency that changed nothing making a re-pointed Quest undispatchable forever
 * @core-observed September 16: "Fix physical Ctrl+Backspace word deletion in unsent drafts" refused every
 * dispatch with WORKSPACE_PREPARATION_FAILED — "Dependency workspace is unavailable or has different
 * ownership: d7dc1269109f32c321c555f90e". That workspace belongs to the same Quest and recorded
 * files: [] and commits: [], so it had nothing to apply; it carried the project identity of
 * .config/opencode/.worktrees/jonsocsetup-public, the root the Quest was created under before it was
 * re-pointed to opencode-hub, and create() compares that identity against the project running now.
 * Nothing can ever make those match, so the Quest could not be dispatched again at all.
 */
import { expect, test } from "bun:test"
import { dependencyContributes } from "../quest/workspaces"

/** The record that blocked the Quest, minus its comparison tree. */
const blocking = {
  version: 1, allocationVersion: 2, runID: "d7dc1269109f32c321c555f90e", questID: "8f355c4e2fab97123deb848f9e",
  projectID: "ca5100e4565d4e0cb654380ba223f31325ccf615daacb9578461563abc3bf790",
  root: "C:\Users\Jk101\.config\opencode\.worktrees\jonsocsetup-public",
  path: "C:\Users\Jk101\.config\opencode\.worktrees\jonsocsetup-public\.claude\worktrees\quest-d7dc1269109f32c321c555f90e",
  branch: "quest/d7dc1269109f32c321c555f90e", base: "2e620efa91548964e2032b06cbf9c56e92af71ca",
  bootstrapComplete: true, inheritedRunIDs: ["e26e7d73cb4821ad4c314ce337"],
  changes: { available: true, files: [], commits: [], at: "2026-09-10T02:49:49.325Z" },
} as any

test("a dependency that recorded no files and no commits is not inherited", () => {
  expect(dependencyContributes(blocking)).toBe(false)
})

test("a dependency that changed something is still inherited, and still verified", () => {
  expect(dependencyContributes({ ...blocking, changes: { ...blocking.changes, files: ["quest/tracker.ts"] } })).toBe(true)
  expect(dependencyContributes({ ...blocking, changes: { ...blocking.changes, commits: ["abc1234"] } })).toBe(true)
})

test("an unavailable record is still a missing dependency, not a silently dropped one", () => {
  expect(dependencyContributes(undefined)).toBe(true)
  // available: false means the change list was never computed, so emptiness proves nothing.
  expect(dependencyContributes({ ...blocking, changes: { available: false, files: [], commits: [], at: blocking.changes.at } })).toBe(true)
  expect(dependencyContributes({ ...blocking, changes: undefined })).toBe(true)
})

test("research dependencies are excluded as before", () => {
  expect(dependencyContributes({ ...blocking, mode: "research" })).toBe(false)
})
