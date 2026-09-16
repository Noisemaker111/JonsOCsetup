/**
 * @core-prevents a dependency refusal that names neither which failure it is nor what would clear it
 * @core-observed September 16: "Fix physical Ctrl+Backspace word deletion in unsent drafts" and "Investigate
 * secure phone access to the existing OVH VPS" both sat undispatchable behind one sentence —
 * "Dependency workspace is unavailable or has different ownership: <runID>" — that covered three unrelated
 * situations at once. 8f355c4e's dependency existed and had simply been created under the project root the
 * Quest was re-pointed away from; 7f2d0f45's had no record at all. Reading the refusal could not tell them
 * apart, so neither giver knew whether to re-run a step, restore a workspace, or wait.
 */
import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { physicalDirectory, projectIdentity } from "../quest/project"
import { QuestWorkspaces } from "../quest/workspaces"

function board() {
  const root = physicalDirectory(mkdtempSync(join(tmpdir(), "quest-dep-refusal-")))
  expect(spawnSync("git", ["init", root], { windowsHide: true }).status).toBe(0)
  writeFileSync(join(root, "README.md"), "dependency refusal fixture\n")
  spawnSync("git", ["-C", root, "add", "-A"], { windowsHide: true })
  spawnSync("git", ["-C", root, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "base"], { windowsHide: true })
  // The runtime lives outside the checkout: a directory created inside it changes the tree the
  // snapshot is reading, and allocation refuses a source that moves under it.
  const runtime = physicalDirectory(mkdtempSync(join(tmpdir(), "quest-dep-runtime-")))
  mkdirSync(join(runtime, "workspaces"), { recursive: true })
  const workspaces = new QuestWorkspaces(runtime)
  const project = projectIdentity(root)
  const create = (runID: string) => workspaces.create({ runID, questID: "quest-a", directory: root, project, inheritRunIDs: ["dependency"] })
  const record = (value: Record<string, unknown>) =>
    writeFileSync(join(runtime, "workspaces", "dependency.json"), JSON.stringify({ version: 1, runID: "dependency", questID: "quest-a", projectID: project.id, root, path: join(root, "gone"), branch: "quest/dependency", base: "HEAD", changes: { available: true, files: [{ path: "a.ts" }], commits: ["abc"], at: "now" }, ...value }))
  return { root, workspaces, project, create, record }
}

test("a dependency with no record left says so, and what would clear it", () => {
  const { create } = board()
  expect(() => create("run-1")).toThrow(/has no record left/)
  expect(() => create("run-2")).toThrow(/Re-run the step that produced it/)
})

test("a dependency belonging to another Quest names that Quest", () => {
  const { create, record } = board()
  record({ questID: "quest-b" })
  expect(() => create("run-1")).toThrow(/belongs to Quest quest-b, not quest-a/)
})

test("a dependency from the project this Quest was re-pointed away from names both roots", () => {
  const { create, record, root } = board()
  record({ projectID: "an-identity-from-before-the-repoint", root: "C:\elsewhere" })
  const error = (() => { try { create("run-1") } catch (e) { return e as Error } })()!
  expect(error.message).toContain("C:\elsewhere")
  expect(error.message).toContain(root)
  expect(error.message).toMatch(/cannot be applied here/)
})
