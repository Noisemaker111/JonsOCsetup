import { expect, test } from "bun:test"
import { buildCache, aggregateRequestHistory } from "../usage/usage-collector"

type SourceAgg = {
  id: string
  kind: string
  windows: { windows: Record<string, any>; models: Map<string, any> }
}

function agg(id: string, kind: string, used30d: number): SourceAgg {
  const windows: Record<string, any> = {}
  if (used30d > 0) {
    windows["30d"] = { usedTokens: used30d, used: used30d, dbCost: used30d, oldestTs: Date.now() - 1000 }
  }
  return { id, kind, windows: { windows, models: new Map() } }
}

test("a configured shell with real spend sorts ahead of empty configured shells", () => {
  // Regression for the buildCache sort: ids outside the known `order` array
  // (openrouter, plus the unknown-shell claude-code/codex/grok-build) all used
  // to land in one -1 bucket and get tie-broken alphabetically, which put a
  // real-spend source (openrouter) behind three sources with zero usage.
  const bySource = new Map<string, SourceAgg>([
    ["claude-code", agg("claude-code", "sub", 0)],
    ["codex", agg("codex", "sub", 0)],
    ["grok-build", agg("grok-build", "sub", 0)],
    ["openrouter", agg("openrouter", "metered", 6.31)],
    ["opencode-go", agg("opencode-go", "sub", 26.06)],
  ])
  const cache = buildCache(bySource, [], { plans: {} }, new Date())
  const ids = cache.sources.map((s: any) => s.id)
  expect(ids.indexOf("opencode-go")).toBeLessThan(ids.indexOf("openrouter"))
  expect(ids.indexOf("openrouter")).toBeLessThan(ids.indexOf("claude-code"))
  expect(ids.indexOf("openrouter")).toBeLessThan(ids.indexOf("codex"))
  expect(ids.indexOf("openrouter")).toBeLessThan(ids.indexOf("grok-build"))
})

test("known-order ids still win over any unranked id regardless of spend", () => {
  const bySource = new Map<string, SourceAgg>([
    ["xai", agg("xai", "metered", 1.26)],
    ["openrouter", agg("openrouter", "metered", 6.31)],
  ])
  const cache = buildCache(bySource, [], { plans: {} }, new Date())
  const ids = cache.sources.map((s: any) => s.id)
  expect(ids.indexOf("xai")).toBeLessThan(ids.indexOf("openrouter"))
})

test("compatibility collector uses shared token counts and separates API equivalent from charges",()=>{
 const record:any={id:"r",sessionID:"s",route:{providerID:"openai",modelID:"m"},kind:"primary",startedAt:100,state:"completed",completedAt:200,tokens:{input:100,cacheRead:400,cacheWrite:50,output:20,reasoning:10},price:{version:"fixture",provider:"openai",model:"m",date:"fixture",currency:"USD",perMillion:{input:10,cacheRead:1,cacheWrite:12,output:20,reasoning:20}}}
 const source=aggregateRequestHistory([record,record],1000).get("openai")!
 expect(source.windows.windows["30d"].usedTokens).toBe(580)
 expect(source.windows.windows["30d"].used).toBe(0)
 expect(source.windows.models.get("openai/m")!.cost).toBeCloseTo(0.0026)
})
