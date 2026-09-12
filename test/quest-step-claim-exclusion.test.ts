/**
 * @core-prevents two harnesses taking the same Quest step at the same moment and both being told they own it, so Claude and Codex silently redo each other's work on the one shared board
 * @core-observed Racing four claimers through a build of ~/.agents/quest.mjs with expectedRevision dropped from the claim, on 2026-09-11: round 1 gave one winner, rounds 2 and 3 gave two, round 4 gave three — agent0, agent1 and agent2 each printed "claimed contested-step" for the same step of the same Quest, and the board showed nothing wrong.
 */
import { test, expect } from "bun:test"
import { spawn, spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { QuestStore } from "../quest/store"

const repo = resolve(fileURLToPath(new URL(".", import.meta.url)), "..")
const cli = join(repo, "setup", "files", ".agents", "quest.mjs")
const ledger = mkdtempSync(join(tmpdir(), "quest-claim-"))
/** The CLI resolves its release from the activated channel; pin it at this checkout and an empty ledger. */
const env = { ...process.env, OPENCODE_QUEST_RELEASE: repo, OPENCODE_QUEST_ROOT: ledger }
const quest = (...argv: string[]) => spawnSync("bun", [cli, ...argv], { env, encoding: "utf8", windowsHide: true })
const claimer = (id: string, step: string, agent: string) => new Promise<{ code: number; out: string }>((done) => {
  const child = spawn("bun", [cli, "claim", id, step, "--as", agent], { env, windowsHide: true })
  let out = ""
  child.stdout.on("data", (chunk) => { out += chunk })
  child.stderr.on("data", (chunk) => { out += chunk })
  child.on("close", (code) => done({ code: code ?? -1, out: out.trim() }))
})

test("of two harnesses claiming one Quest step at once, exactly one comes away holding it", async () => {
  try {
    const filed = quest("file", "Race the step claim", "Two harnesses must never both own one step", "contested step")
    const id = filed.stdout.trim().split(/\s+/)[0]
    expect(id).toMatch(/^[0-9a-hjkmnp-tv-z]{26}$/)
    const step = "contested-step"

    // Real processes, started together, contending for the same step. Whether they collide inside
    // the store's revision compare or one simply arrives second, the board may only ever hand the
    // step to one of them, and nobody else may come away believing they have it.
    for (let round = 1; round <= 3; round++) {
      const results = await Promise.all(["claude", "codex", "opencode", "fable"].map((agent) => claimer(id, step, agent)))
      const winners = results.filter((result) => result.code === 0)
      const losers = results.filter((result) => result.code !== 0)
      expect({ round, winners: winners.length, losers: losers.length }).toEqual({ round, winners: 1, losers: 3 })
      const holder = winners[0].out.match(/@(\S+)/)![1]
      // Two ways to lose, both safe. Being told the holder by name is the good one. Being told the
      // Quest is being written too fast to decide is the other: it happens when four processes
      // collide hard enough that a claimer exhausts its revision retries before anyone visibly
      // holds the step, and a runner slow enough makes it ordinary rather than rare. What matters is
      // that neither loser walks away thinking it owns the step -- one of them would then go and do
      // the work. Asserting only the by-name form made a contended board look like a broken one.
      for (const loss of losers) {
        if (loss.code === 3) expect(loss.out).toBe(`held ${step} @${holder} 0m`)
        else expect({ code: loss.code, out: loss.out }).toEqual({ code: 1, out: `Quest ${id} is being written too fast to claim ${step}; retry.` })
      }

      // And the ledger agrees: one holder, not four sessions all calling themselves executing.
      const who = JSON.parse(quest("who", "--json").stdout)
      expect(who.map((row: any) => [row.agent, row.step])).toEqual([[holder, step]])

      quest("release", id, step, "--as", holder, `round ${round} over`)
    }

    // The exclusion is the store's optimistic revision compare, and it is compared inside the
    // Quest's lock. A writer holding a stale snapshot must be refused even when it is alone.
    const store = new QuestStore(ledger)
    const stale = store.read(id)!.revision
    store.apply(id, "patched", { reason: "something else touched this Quest" })
    expect(() => store.apply(id, "session-claimed", { callID: `step:${step}`, role: "latecomer" }, "test", { expectedRevision: stale }))
      .toThrow(/changed since it was read/)
    expect(store.read(id)!.sessions.some((session) => session.role === "latecomer")).toBe(false)
  } finally { rmSync(ledger, { recursive: true, force: true }) }
})
