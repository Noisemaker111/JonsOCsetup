/**
 * @core-prevents a deliberately opened Quest Giver conversation being refused because an older one still holds the binding, so /new appears to do nothing and drops the user back where they started
 * @core-observed Jon reported twice, most recently 2026-09-12, that /new in the Quest Giver "still doesn't make a new session, it teleports back". /new only navigates to the home screen (packages/tui/src/app.tsx:697); the session is created when the first prompt is sent, the context hook fired, the registry still named the previous conversation, and the turn was refused with SINGLE_GIVER_REQUIRED at quest/user-giver.ts.
 */
import { test, expect } from "bun:test"
import { mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { QuestStore } from "../quest/store"
import { installUserGiverContext } from "../quest/user-giver"
import { readUserGiver } from "../quest/giver-registry.mjs"

/** A host with just enough surface for the context hook: session lookup plus the hook registry. */
function fakeHost(sessions: Record<string, { id: string; agent: string; parentID?: string; location: { directory: string } }>) {
  let handler: ((event: any) => Promise<void>) | undefined
  return {
    host: {
      get: async ({ sessionID }: { sessionID: string }) => sessions[sessionID],
      create: async () => { throw new Error("the hook must never create a session") },
      hook: async (_name: string, fn: (event: any) => Promise<void>) => { handler = fn },
    },
    fire: (event: any) => handler!(event),
  }
}

const conversation = (id: string) => ({ id, agent: "quest-giver", location: { directory: process.cwd() } })

test("a new Quest Giver conversation takes over instead of being refused, and the old one is kept", async () => {
  const root = mkdtempSync(join(tmpdir(), "giver-succession-"))
  try {
    const store = new QuestStore(root)
    const first = "ses_" + "1".repeat(22), second = "ses_" + "2".repeat(22)
    const worker = "ses_" + "w".repeat(22)
    const { host, fire } = fakeHost({
      [first]: conversation(first),
      [second]: conversation(second),
      [worker]: { ...conversation(worker), parentID: first },
    })
    await installUserGiverContext(store, host)

    // The first conversation to speak becomes the giver, exactly as before.
    await fire({ agent: "quest-giver", sessionID: first, system: [] })
    expect(readUserGiver(store.runtime)?.sessionID).toBe(first)

    // Speaking again in it changes nothing and says nothing.
    const quiet: any[] = []
    await fire({ agent: "quest-giver", sessionID: first, system: quiet })
    expect(readUserGiver(store.runtime)?.sessionID).toBe(first)
    expect(quiet).toEqual([])

    // The case Jon hit: a conversation he just opened. It must take over rather than throw.
    const system: any[] = []
    await fire({ agent: "quest-giver", sessionID: second, system })
    expect(readUserGiver(store.runtime)?.sessionID).toBe(second)
    // And it must say so, naming what it succeeded, so the change is never silent.
    expect(system).toHaveLength(1)
    expect(system[0].text).toContain("now your Quest Giver")
    expect(system[0].text).toContain(first)

    // Nothing is destroyed: the previous binding is kept aside rather than deleted.
    const kept = readdirSync(store.runtime).filter((name) => name.includes("released"))
    expect(kept.length).toBe(1)

    // A child session carrying the giver agent is redirected to the real giver, exactly as before --
    // it must never take the binding, and it must not be handed some new error either.
    await expect(fire({ agent: "quest-giver", sessionID: worker, system: [] }))
      .rejects.toThrow(new RegExp(`Continue in your existing Quest Giver: ${second}`))
    expect(readUserGiver(store.runtime)?.sessionID).toBe(second)

    // Neither does a session on another agent.
    await fire({ agent: "build", sessionID: first, system: [] })
    expect(readUserGiver(store.runtime)?.sessionID).toBe(second)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
