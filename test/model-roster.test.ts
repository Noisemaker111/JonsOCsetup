/**
 * The set of models a Task may be routed to is declared in the repo, not
 * discovered from machine state.
 *
 * It used to come from ~/.local/state/opencode/model.json — the TUI's
 * favourites list. That is untracked, unreviewable, and empty on a new
 * machine, so "which models exist as subagents" was invisible to the config
 * repo entirely.
 */
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { favoritesFromProfiles } from "../models/model-routing"

const root = join(import.meta.dir, "..")
const doc = JSON.parse(readFileSync(join(root, "models", "model-profiles.json"), "utf8")) as {
  profiles: Array<{ id: string; model?: string | string[]; lane?: string; best?: string; avoid?: string }>
}

test("every curated profile declares the model it routes to", () => {
  for (const p of doc.profiles) {
    expect(`${p.id}: ${p.model === undefined}`).toBe(`${p.id}: false`)
  }
})

test("every declared model is a provider/model id", () => {
  for (const p of doc.profiles) {
    for (const m of Array.isArray(p.model) ? p.model : [p.model!]) {
      expect(m).toMatch(/^[a-z0-9-]+\/\S+$/)
    }
  }
})

test("the roster is readable without touching machine state", () => {
  const roster = favoritesFromProfiles()
  expect(roster.length).toBeGreaterThanOrEqual(doc.profiles.length)
  for (const fav of roster) {
    expect(typeof fav.providerID).toBe("string")
    expect(typeof fav.modelID).toBe("string")
  }
})

test("the roster covers each cost lane, so failover always has somewhere to go", () => {
  const lanes = new Set(doc.profiles.map((p) => p.lane))
  for (const lane of ["go-quota", "sub", "free", "metered"]) expect(lanes).toContain(lane)
})

test("the declared roster is merged ahead of TUI favourites", () => {
  const src = readFileSync(join(root, "harnesses", "server.ts"), "utf8")
  expect(src).toMatch(/mergeFavs\(favoritesFromProfiles\(\),\s*readFavorites\(\)/)
})

test("every routable model carries routing guidance", () => {
  // A roster entry with no best/avoid gives the picker nothing to reason with.
  for (const p of doc.profiles) {
    expect(`${p.id} best: ${Boolean(p.best)}`).toBe(`${p.id} best: true`)
    expect(`${p.id} avoid: ${Boolean(p.avoid)}`).toBe(`${p.id} avoid: true`)
  }
})

test("xai is never declared — it bills per token", () => {
  for (const p of doc.profiles) {
    for (const m of Array.isArray(p.model) ? p.model : [p.model!]) {
      expect(`${p.id}: ${m.startsWith("xai/")}`).toBe(`${p.id}: false`)
    }
  }
})
