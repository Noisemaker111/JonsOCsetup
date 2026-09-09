import { expect, spyOn, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import * as childProcess from "node:child_process"
import { QuestWorkspaces } from "../quest/workspaces"

function fixture() {
  const tempParent=process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Temp", "opencode") : tmpdir();mkdirSync(tempParent,{recursive:true})
  const scratch = mkdtempSync(join(tempParent, "snapshot-deletions-"))
  const root = join(scratch, "repo"), runtime = join(scratch, "runtime")
  mkdirSync(root); mkdirSync(runtime)
  const git = (...args: string[]) => {
    const out = childProcess.spawnSync("git", ["--no-optional-locks", "-C", root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", ...args], { encoding: "utf8", windowsHide: true })
    if (out.status !== 0) throw new Error(out.stderr)
    return out.stdout
  }
  git("init")
  git("config", "core.autocrlf", "false")
  const names = ["unstaged-delete.txt", "staged-delete.txt", "mixed.txt", "staged.txt", "unstaged.txt", "literal[1].txt", "literal1.txt"]
  for (const name of names) writeFileSync(join(root, name), "base\n")
  git("add", "--", ...names); git("commit", "-m", "fixture base")
  const manager = new QuestWorkspaces(runtime)
  const state = () => ({
    index: readFileSync(join(root, ".git", "index")).toString("hex"),
    status: git("status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ".", ":(exclude,glob)**/.claude/worktrees/**"),
    staged: git("diff", "--cached", "--binary"),
    dirty: git("diff", "--binary"),
    bytes: Object.fromEntries([...names, "draft [2].bin"].map(name => [name, existsSync(join(root, name)) ? readFileSync(join(root, name)).toString("hex") : null])),
  })
  return { scratch, root, runtime, git, manager, state }
}

for (const deletion of ["unstaged", "staged", "both"]) test(`snapshot preserves ${deletion} deletion and mixed source bytes`, () => {
  const f = fixture()
  try {
    if (deletion !== "staged") unlinkSync(join(f.root, "unstaged-delete.txt"))
    if (deletion !== "unstaged") f.git("rm", "--", "staged-delete.txt")
    writeFileSync(join(f.root, "mixed.txt"), "staged version\n")
    writeFileSync(join(f.root, "staged.txt"), "staged only\n")
    f.git("add", "--", "mixed.txt", "staged.txt")
    writeFileSync(join(f.root, "mixed.txt"), "working version\n")
    writeFileSync(join(f.root, "unstaged.txt"), "unstaged only\n")
    writeFileSync(join(f.root, "literal[1].txt"), "literal edit\n")
    writeFileSync(join(f.root, "draft [2].bin"), Buffer.from([0, 255, 10, 13, 1]))
    const before = f.state()
    const worker = f.manager.create({ runID: "deletions", questID: "fixture", directory: f.root })
    for (const [name, bytes] of Object.entries(before.bytes)) {
      expect(existsSync(join(worker.path, name))).toBe(bytes !== null)
      if (bytes !== null) expect(readFileSync(join(worker.path, name)).toString("hex")).toBe(bytes)
    }
    expect(f.state()).toEqual(before)
    expect(f.manager.collect(worker.runID).changes?.files).toEqual([])
    expect(existsSync(join(worker.path, ".claude", "worktrees"))).toBe(false)
    expect(readdirSync(f.runtime).filter(name => name.startsWith("snapshot-"))).toEqual([])
  } finally { rmSync(f.scratch, { recursive: true, force: true }) }
}, 60000)

test("scoped snapshot keeps literal selection and excludes nested worker files", () => {
  const f = fixture()
  try {
    f.git("rm", "--", "literal[1].txt")
    writeFileSync(join(f.root, "literal1.txt"), "outside scope\n")
    mkdirSync(join(f.root, ".claude", "worktrees", "foreign"), { recursive: true })
    writeFileSync(join(f.root, ".claude", "worktrees", "foreign", "draft"), "excluded")
    const before = f.state()
    const tree = (f.manager as any).applySnapshot(f.root, "HEAD", undefined, ["literal[1].txt", ".claude"])
    expect(f.git("diff", "--name-status", "HEAD", tree).trim()).toBe("D\tliteral[1].txt")
    expect(f.state()).toEqual(before)
  } finally { rmSync(f.scratch, { recursive: true, force: true }) }
}, 60000)

test("registered nested worktree is excluded without excluding ordinary sibling source", () => {
  const f = fixture()
  try {
    const child = join(f.root, ".worktrees", "task[1]")
    f.git("worktree", "add", "-b", "nested-fixture", child, "HEAD")
    writeFileSync(join(child, "mixed.txt"), "child staged\n")
    f.git("-C", child, "add", "--", "mixed.txt")
    writeFileSync(join(child, "mixed.txt"), "child working\n")
    writeFileSync(join(child, "draft.bin"), Buffer.from([255, 0, 1]))
    const sibling = join(f.root, ".worktrees", "task1")
    mkdirSync(sibling); writeFileSync(join(sibling, "source.txt"), "ordinary source\n")
    const childIndex = f.git("-C", child, "rev-parse", "--path-format=absolute", "--git-path", "index").trim()
    const childState = () => ({
      index: readFileSync(childIndex).toString("hex"),
      status: f.git("-C", child, "status", "--porcelain=v1", "-z"),
      mixed: readFileSync(join(child, "mixed.txt")).toString("hex"),
      draft: readFileSync(join(child, "draft.bin")).toString("hex"),
    })
    const before = f.state(), nestedBefore = childState()
    const worker = f.manager.create({ runID: "nested", questID: "fixture", directory: f.root })
    expect(existsSync(join(worker.path, ".worktrees", "task[1]"))).toBe(false)
    expect(readFileSync(join(worker.path, ".worktrees", "task1", "source.txt"), "utf8")).toBe("ordinary source\n")
    expect(f.git("ls-tree", "-r", "--name-only", worker.comparisonTree!).includes("task[1]")).toBe(false)
    expect(f.state()).toEqual(before)
    expect(childState()).toEqual(nestedBefore)
    const prepared = f.manager.prepare({ directory: f.root })
    expect(prepared.state).toBe("ready")
    expect(f.manager.prepare({ directory: f.root }).runID).toBe(prepared.runID)
    const assigned = f.manager.create({ runID: "reused", questID: "fixture", directory: f.root })
    expect(assigned.physicalRunID).toBe(prepared.runID)
    f.manager.assertPreparedSource(assigned)
    expect(f.state()).toEqual(before)
    expect(childState()).toEqual(nestedBefore)
    writeFileSync(join(sibling, "source.txt"), "real parent edit\n")
    expect(() => f.manager.assertPreparedSource(assigned)).toThrow("Project changed")
    const refreshed = f.manager.prepare({ directory: f.root })
    expect(refreshed.state).toBe("ready")
    expect(refreshed.runID).not.toBe(prepared.runID)
    expect(readFileSync(join(f.manager.get(refreshed.runID!)!.path, ".worktrees", "task1", "source.txt"), "utf8")).toBe("real parent edit\n")
    expect(childState()).toEqual(nestedBefore)
  } finally { rmSync(f.scratch, { recursive: true, force: true }) }
}, 60000)

for (const mutation of ["content", "new-file", "restore-deletion", "head", "worktree-registration"]) test(`snapshot fails closed for mid-snapshot ${mutation} change`, () => {
  const f = fixture()
  const original = childProcess.spawnSync
  let changed = false
  let spy: ReturnType<typeof spyOn> | undefined
  try {
    unlinkSync(join(f.root, "unstaged-delete.txt"))
    const index = readFileSync(join(f.root, ".git", "index"))
    spy = spyOn(childProcess, "spawnSync").mockImplementation(((command: any, args: any, options: any) => {
      const out = original(command, args, options)
      if (!changed && options?.env?.GIT_INDEX_FILE && args.includes("write-tree")) {
        changed = true
        if (mutation === "content") writeFileSync(join(f.root, "mixed.txt"), "concurrent edit\n")
        if (mutation === "new-file") writeFileSync(join(f.root, "new.txt"), "concurrent new file\n")
        if (mutation === "restore-deletion") writeFileSync(join(f.root, "unstaged-delete.txt"), "restored\n")
        if (mutation === "head") f.git("commit", "--allow-empty", "-m", "concurrent head")
        if (mutation === "worktree-registration") f.git("worktree", "add", "-b", "concurrent", join(f.root, ".worktrees", "concurrent"), "HEAD")
      }
      return out
    }) as typeof childProcess.spawnSync)
    expect(() => f.manager.create({ runID: "race", questID: "fixture", directory: f.root })).toThrow("Source changed during workspace snapshot")
    expect(changed).toBe(true)
    expect(readFileSync(join(f.root, ".git", "index"))).toEqual(index)
    expect(f.manager.get("race")?.bootstrapComplete).toBe(false)
    expect(readdirSync(f.runtime).filter(name => name.startsWith("snapshot-"))).toEqual([])
  } finally { spy?.mockRestore(); rmSync(f.scratch, { recursive: true, force: true }) }
}, 60000)
