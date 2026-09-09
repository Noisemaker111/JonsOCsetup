import { expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { stageCandidate } from "../scripts/plugin-deploy"
import { checkHeadless, repositoryBoundaries } from "../scripts/headless-guard"
import { hiddenExecFileSync } from "../scripts/windows-process"

function fixture(run: (root: string) => void) {
  const parent = join(import.meta.dir, "..", "tmp")
  mkdirSync(parent, { recursive: true })
  const root = mkdtempSync(join(parent, "router-deployment-"))
  try { run(root) } finally { rmSync(root, { recursive: true, force: true }) }
}
function source(root: string, path: string, text = "export const source = true") {
  const file = join(root, path)
  mkdirSync(join(file, ".."), { recursive: true })
  writeFileSync(file, text)
}

test("deployment and headless checks exclude registered nested worktrees but retain untracked source", () => fixture(root => {
  const git = (...args: string[]) => hiddenExecFileSync("git", ["-C", root, ...args], { stdio: ["ignore", "pipe", "pipe"] })
  git("init")
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", "fixture")
  git("worktree", "add", "--detach", "sandboxes/owned", "HEAD")
  source(root, "sandboxes/owned/unsafe.ts", "spawn('unsafe')")
  source(root, ".worktrees/legacy/unsafe.ts", "spawn('unsafe')")
  source(root, ".claude/worktrees/legacy/unsafe.ts", "spawn('unsafe')")
  source(root, "project-router/untracked.ts")
  source(root, "sandboxes/normal.ts")
  expect(repositoryBoundaries(root).has("sandboxes/owned")).toBe(true)
  expect(checkHeadless(root)).toEqual([])
  const candidate = stageCandidate(root, "fixture")
  for (const path of ["sandboxes/owned", ".worktrees", ".claude/worktrees"]) expect(existsSync(join(candidate, path))).toBe(false)
  expect(readFileSync(join(candidate, "project-router/untracked.ts"), "utf8")).toContain("source = true")
  expect(existsSync(join(candidate, "sandboxes/normal.ts"))).toBe(true)
  source(root, "project-router/unsafe.ts", "spawn('unsafe')")
  source(root, ".hidden/unsafe.ts", "spawn('unsafe')")
  expect(checkHeadless(root).filter(x => x.includes("unsafe process API"))).toHaveLength(2)
}))

test("deployment and headless checks reject source junctions without traversing outside the root", () => fixture(parent => {
  const root = join(parent, "repo"), outside = join(parent, "outside")
  mkdirSync(root)
  source(outside, "unsafe.ts", "spawn('unsafe')")
  symlinkSync(outside, join(root, "linked"), process.platform === "win32" ? "junction" : "dir")
  expect(checkHeadless(root)).toEqual(["linked: source link is not traversed"])
  expect(() => stageCandidate(root, "fixture")).toThrow("Cannot stage source link: linked")
  expect(readFileSync(join(outside, "unsafe.ts"), "utf8")).toBe("spawn('unsafe')")
}))

test("failed Git inventory in a repository fails closed before staging or scanning", () => fixture(root => {
  // A broken linked-worktree marker is an inventory failure, not a non-Git fixture.
  writeFileSync(join(root, ".git"), "gitdir: missing-owned-metadata\n")
  source(root, "custom/owned/unsafe.ts", "spawn('unsafe')")
  expect(() => repositoryBoundaries(root)).toThrow("Cannot inventory repository worktree boundaries")
  expect(() => checkHeadless(root)).toThrow("Cannot inventory repository worktree boundaries")
  expect(() => stageCandidate(root, "fixture")).toThrow("Cannot inventory repository worktree boundaries")
  expect(existsSync(join(root, ".candidates"))).toBe(false)
}))

test("external host skill links are excluded while local skill source stays checked", () => fixture(parent => {
  const root = join(parent, "repo"), outside = join(parent, "outside")
  source(outside, "unsafe.ts", "spawn('unsafe')")
  for (const namespace of [".claude/skills", ".agents/skills"]) {
    source(root, `${namespace}/local/safe.ts`)
    symlinkSync(outside, join(root, namespace, "external"), process.platform === "win32" ? "junction" : "dir")
  }
  expect(checkHeadless(root)).toEqual([])
  const candidate = stageCandidate(root, "fixture")
  for (const namespace of [".claude/skills", ".agents/skills"]) {
    expect(existsSync(join(candidate, namespace, "external"))).toBe(false)
    expect(existsSync(join(candidate, namespace, "local/safe.ts"))).toBe(true)
    source(root, `${namespace}/local/unsafe.ts`, "spawn('unsafe')")
  }
  expect(checkHeadless(root).filter(x => x.includes("unsafe process API"))).toHaveLength(2)
  expect(readFileSync(join(outside, "unsafe.ts"), "utf8")).toBe("spawn('unsafe')")
}))