import { expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createQuestAgentAPI } from "../quest/agent-api"
import {
  artifactChain,
  artifactChainSummary,
  artifactLine,
  buildCaptureArtifact,
  ensureQuestAssetsDir,
  normalizeArtifact,
  questAssetsDir,
  UI_CAPTURE_CONVENTION,
} from "../quest/artifacts"
import { newQuest } from "../quest/schema"
import { detail } from "../quest/tui-model"

const ID = "01j00000000000000000000000"

test("artifact store: evidence kind=artifacts keeps labeled paths under quests-assets/<questID>", () => {
  const root = mkdtempSync(join(tmpdir(), "quest-artifacts-"))
  try {
    const api = createQuestAgentAPI(root)
    const created = api.admit({ title: "UI quest", objective: "redo the board" })
    const before = api.evidence(created.id, "artifacts", {
      name: "before-board.png",
      path: `.opencode/quests-assets/${created.id}/before-board.png`,
      label: "before",
    })
    expect(before.evidence.artifacts).toHaveLength(1)
    expect(before.evidence.artifacts[0]).toMatchObject({ label: "before", path: `.opencode/quests-assets/${created.id}/before-board.png` })
    expect(existsSync(questAssetsDir(root, created.id))).toBe(true)
    const after = api.evidence(created.id, "artifacts", JSON.stringify({
      name: "after-board.png",
      path: `.opencode/quests-assets/${created.id}/after-board.png`,
      label: "after",
    }))
    expect(after.evidence.artifacts.map((a: any) => a.label)).toEqual(["before", "after"])
    // Persists through a fresh ledger read.
    expect(api.get(created.id)?.evidence.artifacts.map((a) => a.label)).toEqual(["before", "after"])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("capture convention: before first edit, revision N, after — dir created deterministically", () => {
  const root = mkdtempSync(join(tmpdir(), "quest-capture-"))
  try {
    const api = createQuestAgentAPI(root)
    const created = api.admit({ title: "UI redo", objective: "improve UI in one quest" })
    expect(UI_CAPTURE_CONVENTION).toContain("before")
    const source = join(root, "board.png")
    writeFileSync(source, "fake-png")
    const dir = ensureQuestAssetsDir(root, created.id)
    expect(dir).toBe(questAssetsDir(root, created.id))
    expect(existsSync(dir)).toBe(true)
    const q1 = api.captureArtifact(created.id, { label: "before", sourcePath: source })
    const q2 = api.captureArtifact(created.id, { label: "revision 1", sourcePath: source })
    const q3 = api.captureArtifact(created.id, { label: "after", sourcePath: source })
    expect(q3.evidence.artifacts.map((a: any) => a.label)).toEqual(["before", "revision 1", "after"])
    expect(q3.evidence.artifacts.every((a: any) => String(a.path).startsWith(`.opencode/quests-assets/${created.id}/`))).toBe(true)
    expect(existsSync(join(dir, "before-board.png"))).toBe(true)
    // Chain helper orders before -> revisions -> after regardless of insert order.
    const shuffled = [q3.evidence.artifacts[2], q3.evidence.artifacts[0], q3.evidence.artifacts[1]] as any
    expect(artifactChain(shuffled).map((a) => a.label)).toEqual(["before", "revision 1", "after"])
    expect(artifactChainSummary(shuffled)).toBe("before -> revision 1 -> after")
    // Direct builder without the store keeps the same deterministic layout.
    const built = buildCaptureArtifact(root, created.id, { label: "revision 2", bytes: new Uint8Array([1, 2, 3]), name: "board" })
    expect(built.path).toContain(`.opencode/quests-assets/${created.id}/revision-2-`)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("normalizeArtifact rejects unlabeled garbage and derives revision N", () => {
  expect(() => normalizeArtifact(undefined)).toThrow()
  expect(() => normalizeArtifact({})).toThrow()
  expect(normalizeArtifact({ name: "x.png", label: "revision 3" })).toMatchObject({ label: "revision 3", revision: 3 })
  expect(artifactLine({ name: "b.png", path: ".opencode/quests-assets/q/before-b.png", label: "before", at: "", verified: false })).toBe(
    "before — .opencode/quests-assets/q/before-b.png",
  )
})

test("board detail: ARTIFACTS section lists labeled paths with the before -> after chain", () => {
  const q = {
    ...newQuest({ id: ID, title: "UI redo", objective: "before and after" }),
    evidence: {
      commits: [], tests: [], builds: [],
      artifacts: [
        { name: "after-board.png", path: `.opencode/quests-assets/${ID}/after-board.png`, label: "after", at: "2026-09-04T00:00:02Z", verified: false },
        { name: "before-board.png", path: `.opencode/quests-assets/${ID}/before-board.png`, label: "before", at: "2026-09-04T00:00:01Z", verified: false },
      ],
      publish: [],
    },
  } as any
  const lines = detail(q, 200)
  const text = lines.join("\n")
  expect(text).toContain("ARTIFACTS (2)")
  expect(text).toContain("chain: before -> after")
  expect(text.indexOf("before —")).toBeLessThan(text.indexOf("after —"))
  expect(text).toContain(`before — .opencode/quests-assets/${ID}/before-board.png`)
  expect(text).toContain(`after — .opencode/quests-assets/${ID}/after-board.png`)
  expect(lines.every((line) => line.length <= 200)).toBe(true)
  // Empty quests still render the section header (0 captures), never crash.
  const empty = detail(newQuest({ id: ID, title: "plain", objective: "x" }) as any, 120).join("\n")
  expect(empty).toContain("ARTIFACTS (0)")
})
