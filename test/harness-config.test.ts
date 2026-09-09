/**
 * The harness specs must line up with the host config that exposes them. This
 * asserts against opencode.jsonc, which is this checkout's own configuration
 * and not something the published opencode-harness repo ships — so it lives
 * here rather than in harnesses.test.ts, which does ship.
 */
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { parse as parseJson5 } from "json5"
import { harnessList } from "../harnesses"

const root = join(import.meta.dir, "..")
const config = parseJson5(readFileSync(join(root, "opencode.jsonc"), "utf8"))

test("every harness is selectable as a provider in the config", () => {
  for (const spec of harnessList()) {
    const provider = config.providers[spec.provider]
    expect(`${spec.id}: ${Boolean(provider)}`).toBe(`${spec.id}: true`)
    for (const model of spec.models) {
      expect(`${spec.provider}/${model.id}: ${Boolean(provider.models[model.id])}`).toBe(`${spec.provider}/${model.id}: true`)
    }
  }
})

test("harness providers carry no API key env — they ride the vendor's own CLI auth", () => {
  for (const spec of harnessList()) {
    expect(config.providers[spec.provider].env).toEqual([])
  }
})

test("harness models declare explicit context limits so nothing falls back to a default", () => {
  // Unknown provider ids have no models.dev catalog entry; an omitted limit is
  // what made a 500k model compact at 200k.
  for (const spec of harnessList()) {
    for (const model of spec.models) {
      const limit = config.providers[spec.provider].models[model.id].limit
      expect(`${spec.provider}/${model.id}: ${typeof limit?.context}`).toBe(`${spec.provider}/${model.id}: number`)
    }
  }
})
