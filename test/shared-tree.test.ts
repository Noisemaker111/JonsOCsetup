/** Owned Quest workspaces and the explicit isolation manager are the only checkout creators. */
import { expect, test } from "bun:test"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { isIsolatedWorktree, validateDeclaredWorktree } from "../quest/worktree"

const root = join(import.meta.dir, "..")
const ALLOWED_WORKTREE_CREATORS = ["quest/isolated-worktree.ts", "quest/workspaces.ts", "quest/codex/recovery-workspace.ts"]
const SKIP_DIRS = new Set(["node_modules", "generations", ".git", "test", "run", ".opencode"])

function sourceFiles(dir = root): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP_DIRS.has(name) || name.startsWith(".")) return []
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.(ts|tsx)$/.test(name) ? [full] : []
  })
}

test("only owned workspace and explicit isolation managers create a git worktree", () => {
  const creators = sourceFiles()
    .filter((file) => /worktree["']?\s*,\s*["']add|worktree add/.test(readFileSync(file, "utf8")))
    .map((file) => relative(root, file).replaceAll("\\", "/"))
  expect(creators.sort()).toEqual(ALLOWED_WORKTREE_CREATORS.sort())
})

test("a Quest session with no declared worktree is shared-tree and valid", () => {
  const shared = { repo: root, branch: "master" }
  expect(validateDeclaredWorktree(shared)).toEqual([])
  expect(isIsolatedWorktree(shared)).toBe(false)
})

test("declaring the repo as the worktree is still shared, not isolated", () => {
  expect(isIsolatedWorktree({ repo: root, branch: "master", worktree: root })).toBe(false)
})

test("a different path is isolated and must be declared deliberately", () => {
  expect(isIsolatedWorktree({ repo: root, branch: "fork", worktree: join(root, "..", "fork") })).toBe(true)
})

test("the repo-local shared-tree rule lives in the OpenCode skill", () => {
  const agents = readFileSync(join(root, "AGENTS.md"), "utf8")
  const skill = readFileSync(join(root, "skills", "opencode", "SKILL.md"), "utf8")
  expect(skill).toMatch(/owned worktrees/i)
  expect(skill).toMatch(/verifies the host session directory/i)
  expect(agents).not.toMatch(/shared tree/i)
})

test("promotion stages candidates in the repo, never in a temp directory", () => {
  // A candidate is a full copy of the config tree. Staging it under %TEMP%
  // put real work somewhere untracked, and a quarantined promotion orphaned
  // it there with no way to find it later.
  const deploy = readFileSync(join(root, "scripts", "plugin-deploy.ts"), "utf8")
  expect(deploy).toContain(".candidates")
  expect(deploy).not.toMatch(/tmpdir\(\)|os\.tmpdir/)
})

test("in-repo staging areas are ignored, not committed", () => {
  const ignore = readFileSync(join(root, ".gitignore"), "utf8")
  expect(ignore).toMatch(/^\.candidates\/$/m)
  expect(ignore).toMatch(/^\.candidate-health-\*\.json$/m)
})

test("bun test is scoped to this repo's test directory", () => {
  // generations/ holds a full copy of the suite per promotion; without a root
  // they all run against the live config and their failures look real.
  const bunfig = readFileSync(join(root, "bunfig.toml"), "utf8")
  expect(bunfig).toMatch(/root\s*=\s*"\.\/test"/)
})

test("a generation never contains another generation, or the test suite", () => {
  // Staging used to copy the whole repo, so gen N contained gen N-1 (four
  // deep), 399 duplicate test files and 92 duplicate Quest files — 204 MB that
  // bun test walked and git tried to track.
  const pointer = JSON.parse(readFileSync(join(root, "plugin-activation.json"), "utf8"))
  const active = join(root, "generations", pointer.activeGeneration)
  for (const forbidden of ["generations", "test", "bench", ".opencode"]) {
    expect(`${forbidden}: ${existsSync(join(active, forbidden))}`).toBe(`${forbidden}: false`)
  }
})

test("generations are build output, not tracked source", () => {
  const ignore = readFileSync(join(root, ".gitignore"), "utf8")
  expect(ignore).toMatch(/^generations\/$/m)
})
