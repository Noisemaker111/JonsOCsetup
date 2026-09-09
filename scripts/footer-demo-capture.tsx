/** @jsxImportSource @opentui/solid */
// Renders the chat footer (prompt.footer slot) against a seeded, throwaway
// ledger so the live worker status lines are visible without a live host —
// this is the "one source" fixture: sessions in different states teleport
// straight into the footer with no giver-typed status text.
// Run with: bun --preload @opentui/solid/preload scripts/footer-demo-capture.tsx
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { testRender } from "@opentui/solid"
import { QuestStore } from "../quest/store"
import { Footer } from "../quest/tui-active/quests"

async function main() {
  const root = join(import.meta.dir, "..")
  const dir = mkdtempSync(join(tmpdir(), "footer-demo-"))
  process.env.OPENCODE_QUEST_ROOT = dir
  const store = new QuestStore(dir)
  store.create({
    id: "0123456789abcdefghjkmnpqrs", title: "Ship live worker lines", objective: "Teleport status into the footer",
    sessions: [{
      callID: "c1", role: "worker", state: "executing", providerID: "openai", modelID: "gpt-5.6-luna-fast",
      reasoningEffort: "high", fast: true, runtime: "native", openCodeSessionId: "ses_running1", parentID: "ses_parent1",
      task: "Derive live worker lines", evidence: [], deliverables: [], attempt: 1, updatedAt: new Date().toISOString(),
    }],
  })
  store.create({
    id: "0123456789abcdefghjkmnpqrt", title: "Second quest waiting on review", objective: "Waiting example",
    sessions: [{
      callID: "c2", role: "worker", state: "waiting", providerID: "grok-sub", modelID: "grok-4.6",
      reasoningEffort: "medium", runtime: "native", openCodeSessionId: "ses_waiting1", parentID: "ses_parent1",
      task: "Waiting on dependency", evidence: [], deliverables: [], attempt: 1, updatedAt: new Date(Date.now() - 1000).toISOString(),
    }],
  })
  const navigated: any[] = []
  const context = { location: { directory: dir }, client: { session: {} }, ui: { router: { navigate: (route: any) => navigated.push(route) }, dialog: {} } }
  try {
    const setup = await testRender(() => <Footer context={context} />, { width: 132, height: 12 })
    try {
      await setup.renderOnce()
      await Bun.sleep(50)
      await setup.renderOnce()
      const frame = setup.captureCharFrame().replace(/[ \t]+$/gm, "")
      mkdirSync(join(root, "tmp"), { recursive: true })
      writeFileSync(join(root, "tmp", "footer-demo.txt"), frame, "utf8")
      console.log(frame)
      if (!frame.includes("🟢 Running — Ship live worker lines — openai/gpt-5.6-luna-fast, high, fast")) throw new Error("live Running line did not render")
      if (!frame.includes("🟡 Waiting — Second quest waiting on review — grok-sub/grok-4.6, medium")) throw new Error("live Waiting line did not render")
      console.log("\nOK: live worker status lines rendered in the chat footer, straight from the ledger")

      // Row 0 is the count line, row 1 is the newest quest's live line (the
      // "Second quest waiting on review" Waiting row) — click it and confirm
      // it is 1:1 with that Quest: navigate({type:"plugin",name:"quests",
      // data:{questID:"...pqrt", returnRoute}}), same as the count line's
      // own click-through, not a dead row or a generic "open board".
      await setup.mockMouse.click(1, 1)
      await setup.renderOnce()
      if (navigated.length !== 1) throw new Error(`expected exactly one navigate() from clicking the Waiting row, got ${navigated.length}`)
      if (navigated[0]?.data?.questID !== "0123456789abcdefghjkmnpqrt") throw new Error(`clicking the Waiting row navigated to the wrong Quest: ${JSON.stringify(navigated[0])}`)
      console.log("OK: clicking a footer worker line navigates 1:1 to the Quest it came from")
    } finally {
      setup.renderer.destroy()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

main().catch((error) => { console.error(error); process.exit(1) })
