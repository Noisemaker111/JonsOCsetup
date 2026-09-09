import { expect, test } from "bun:test"
import { join } from "node:path"
import { mkdtempSync, rmSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { CAPACITY_FILE, blockLane, capacitySnapshot, laneBlock, taskState } from "../models/capacity-registry"

test("9 reported / 2 executing / 7 blocked excludes blocked from running", () => {
  const d=mkdtempSync(join(tmpdir(),"capacity-")),f=join(d,"capacity.json")
  for(let i=0;i<9;i++)taskState(`t${i}`,"p",`line-${i}`,i<7?"opencode-go":"openai",i<7?"blocked":"executing",i<7?"weekly cap":undefined,f)
  const s=capacitySnapshot(f);expect(s.counts).toEqual({reported:9,executing:2,blocked:7,running:2});rmSync(d,{recursive:true,force:true})
})

test("Grok exhaustion blocks fallback until reset then reconciles", () => {
  const d=mkdtempSync(join(tmpdir(),"capacity-")),f=join(d,"capacity.json")
  blockLane("grok-sub","weekly exhausted",new Date(Date.now()+60_000).toISOString(),"429 token=[secret]",f)
  expect(laneBlock("grok-sub",f)?.reason).toContain("weekly exhausted")
  blockLane("expired","old",new Date(Date.now()-1).toISOString(),undefined,f);expect(laneBlock("expired",f)).toBeUndefined();rmSync(d,{recursive:true,force:true})
})

test("Go blocked and OpenRouter executing are independent lanes", () => {
  const d=mkdtempSync(join(tmpdir(),"capacity-")),f=join(d,"capacity.json")
  blockLane("opencode-go","weekly cap",undefined,undefined,f)
  taskState("t-or","p","line-or","openrouter","executing","Go capped; rewritten to model-openrouter-z-ai-glm-5-3-flash",f)
  expect(laneBlock("opencode-go",f)?.state).toBe("blocked")
  expect(laneBlock("openrouter",f)).toBeUndefined()
  const s=capacitySnapshot(f)
  expect(s.tasks.some(t=>t.lane==="openrouter"&&t.state==="executing")).toBe(true)
  expect(s.counts.executing).toBe(1)
  rmSync(d,{recursive:true,force:true})
})

test("a lane block always expires", () => {
  // reconcile() only clears a lane whose resetAt has passed, so a block
  // written without one never cleared. capResetAt returns undefined whenever
  // the usage cache carries no reset seconds — every transient failure — so a
  // single bad minute removed a provider from routing permanently. A test run
  // did exactly that to all four live lanes.
  const file = join(mkdtempSync(join(tmpdir(), "capacity-ttl-")), "capacity.json")
  blockLane("grok-sub", "transient", undefined, undefined, file)
  const block = laneBlock("grok-sub", file)
  expect(block).toBeDefined()
  expect(typeof block!.resetAt).toBe("string")
  expect(Date.parse(block!.resetAt!)).toBeGreaterThan(Date.now())
})

test("the suite never points at the live capacity file", () => {
  // blockLane writes real routing state. Without the preload override, a test
  // that exercised a failover blocked a lane in the user's own
  // ~/.local/state/opencode/capacity.json — and because those blocks carried
  // no resetAt, they never cleared. A full run left all four lanes dead.
  const override = process.env.OPENCODE_CAPACITY_FILE
  expect(`override set: ${Boolean(override)}`).toBe("override set: true")
  expect(CAPACITY_FILE).toBe(override!)
  expect(CAPACITY_FILE).not.toContain(join(homedir(), ".local", "state", "opencode"))
})
