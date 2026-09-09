/** @jsxImportSource @opentui/solid */
// Renders the Quest board against a seeded, throwaway ledger so the
// clickable-session-id row is visible without a live host.
// Run with: bun --preload @opentui/solid/preload scripts/session-link-demo-capture.tsx
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { testRender } from "@opentui/solid"
import { QuestStore } from "../quest/store"
import { QuestBoard } from "../quest/tui-active/quest-board"

async function main() {
  const root = join(import.meta.dir, "..")
  const dir = mkdtempSync(join(tmpdir(), "session-link-demo-"))
  process.env.OPENCODE_QUEST_ROOT = dir
  const store = new QuestStore(dir)
  const created = store.create({
    id: "0123456789abcdefghjkmnpqrs", title: "Ship clickable session ids", objective: "Click a ses_… id and jump there",
    sessions: [{
      callID: "c1", role: "worker", state: "executing", providerID: "openai", modelID: "gpt-5.6-luna-fast",
      reasoningEffort: "high", fast: true,
      runtime: "native", openCodeSessionId: "ses_f9216da1dffeuXqOYjixsUMsCW", parentID: "ses_parent1",
      task: "Implement the plugin", evidence: [], deliverables: [], attempt: 1, updatedAt: new Date().toISOString(),
    }],
  })
  const context = { location: { directory: dir }, client: { session: {} }, ui: { router: {}, dialog: {} } }
  try {
    const setup = await testRender(() => <QuestBoard context={context} initialQuestID={created.id} />, { width: 132, height: 60 })
    try {
      await setup.renderOnce()
      await Bun.sleep(50)
      await setup.renderOnce()
      const frame = setup.captureCharFrame().replace(/[ \t]+$/gm, "")
      mkdirSync(join(root, "tmp"), { recursive: true })
      writeFileSync(join(root, "tmp", "session-link-demo.txt"), frame, "utf8")
      console.log(frame)
      if (!frame.includes("↳ ses_f9216da1dffeuXqO")) throw new Error("clickable session id row did not render")
      if (!frame.includes("openai/gpt-5.6-luna-fast (fast") || !frame.includes("high reasoning")) throw new Error("model + fast + reasoning level face disclosure did not render")
      console.log("\nOK: clickable session id row rendered, with model + fast + reasoning level on the face")
    } finally {
      setup.renderer.destroy()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

main().catch((error) => { console.error(error); process.exit(1) })
