import { expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const root = join(import.meta.dir, "..")
const script = join(root, "scripts", "artifact-gate.ps1")

function run(repo: string, artifact: string, status: string) {
  return Bun.spawnSync(["pwsh", "-NoProfile", "-File", script, "-RepoRoot", repo, "-ArtifactPath", artifact, "-PublishStatus", status], { stdout: "pipe", stderr: "pipe", stdin: "ignore", windowsHide: true })
}

function output(result: ReturnType<typeof run>) {
  return new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr)
}

function makeGit(repo: string) {
  for (const args of [["init", "-q"], ["config", "user.email", "test@example.invalid"], ["config", "user.name", "artifact-test"], ["add", "."], ["commit", "-qm", "fixture"]]) {
    const result = Bun.spawnSync(["git", "-C", repo, ...args], { stdout: "pipe", stderr: "pipe", stdin: "ignore", windowsHide: true })
    if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr))
  }
}

test("README-only repository blocks even with smoke/build-looking evidence", () => {
  const repo = mkdtempSync(join(tmpdir(), "artifact-gate-readme-"))
  writeFileSync(join(repo, "README.md"), "placeholder"); makeGit(repo)
  const artifact = join(repo, "dist.zip"); writeFileSync(artifact, "fake")
  const result = run(repo, artifact, "succeeded")
  expect(result.exitCode).toBe(1)
  expect(output(result)).toMatch(/BLOCK source/)
  rmSync(repo, { recursive: true, force: true })
})

test("source, local artifact, and publish status produce CLEAN", () => {
  const repo = mkdtempSync(join(tmpdir(), "artifact-gate-pass-"))
  writeFileSync(join(repo, "src.ts"), "export const ok = true"); makeGit(repo)
  const artifact = join(repo, "dist.zip"); writeFileSync(artifact, "fake")
  const result = run(repo, artifact, "succeeded")
  expect(result.exitCode).toBe(0)
  expect(output(result)).toMatch(/ARTIFACT-GATE CLEAN/)
  rmSync(repo, { recursive: true, force: true })
})

test("manifests cannot satisfy the artifact gate", () => {
  const repo = mkdtempSync(join(tmpdir(), "artifact-gate-manifest-"))
  writeFileSync(join(repo, "src.ts"), "export const ok = true")
  writeFileSync(join(repo, "package.json"), JSON.stringify({ version: "1.0.0" }))
  makeGit(repo)
  const result = run(repo, join(repo, "package.json"), "succeeded")
  expect(result.exitCode).toBe(1)
  expect(output(result)).toMatch(/not a distributable artifact/)
  rmSync(repo, { recursive: true, force: true })
})

test("package URLs must name downloadable artifacts, not metadata", () => {
  const repo = mkdtempSync(join(tmpdir(), "artifact-gate-package-url-"))
  writeFileSync(join(repo, "src.ts"), "export const ok = true")
  makeGit(repo)
  const result = Bun.spawnSync(["pwsh", "-NoProfile", "-File", script, "-RepoRoot", repo, "-PackageUrl", "https://example.invalid/package.json", "-PublishStatus", "succeeded"], { stdout: "pipe", stderr: "pipe", stdin: "ignore", windowsHide: true })
  expect(result.exitCode).toBe(1)
  expect(output(result)).toMatch(/package URL does not name a distributable artifact/)
  rmSync(repo, { recursive: true, force: true })
})
