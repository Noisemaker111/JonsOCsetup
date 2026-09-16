/**
 * @core-prevents a permitted effort silently deriving no route because its published score states none
 * @core-observed September 15: opencode-go/deepseek-v4.1-flash#high has 154 clean runs at 99% on this
 * machine and is not a candidate the router can rank. Its benchmark row publishes an unstated effort, which
 * is attributed to the highest effort the model declares, so only #max derives a route. Nothing said so, and
 * the working configuration was reachable only by naming it.
 */
import { test, expect } from 'bun:test'
import { deriveBenchmarkRoutes, benchmarkedEfforts, type CatalogModel } from '../models/live-routes'
import type { BenchmarkTable } from '../models/benchmark-table'

const model: CatalogModel = { providerID: 'opencode-go', modelID: 'deepseek-v4.1-flash', efforts: ['low', 'high', 'max'], cost: { input: 0.15, output: 0.6, cache_read: 0.003 } }
const table: BenchmarkTable = {
  suite: 'DeepSWE v1.1 pass@1',
  entries: [{ id: 'deepseek-v4.1-flash', provenance: 'vendor', source: 'https://api-docs.deepseek.com/updates/', measuredAt: '2026-09-10', passAt1: { unstated: 0.742 } }],
} as any
const snapshot: any = { accounts: [{ id: 'opencode-go-account', provider: 'opencode-go', state: 'available', connections: [{ routeProviders: ['opencode-go'] }], windows: [] }] }

test('an unstated published effort still says which efforts it left unranked', () => {
  // The attribution itself is unchanged: the headline number claims only the highest effort.
  expect(benchmarkedEfforts(table.entries[0], model).map(e => e.reasoning)).toEqual(['max'])

  const derived = deriveBenchmarkRoutes({ catalog: [model], table, snapshot, policy: { routes: [], billing: { 'opencode-go-account': 'subscription' } } })
  expect(derived.routes.map(r => r.reasoning)).toEqual(['max'])

  const notice = derived.diagnostics.find(d => d.includes('deepseek-v4.1-flash') && d.includes('derive no ranked route'))
  expect(notice).toBeDefined()
  expect(notice).toContain('low, high')
  expect(notice).toContain('claimed by max')
  expect(notice).toContain('name one explicitly')
})

test('a per-effort published board ranks each effort and reports nothing unranked', () => {
  const scored: BenchmarkTable = { suite: 'x', entries: [{ ...table.entries[0], passAt1: { low: 0.6, high: 0.72, max: 0.742 } }] } as any
  const derived = deriveBenchmarkRoutes({ catalog: [model], table: scored, snapshot, policy: { routes: [], billing: { 'opencode-go-account': 'subscription' } } })
  expect(derived.routes.map(r => r.reasoning).sort()).toEqual(['high', 'low', 'max'])
  expect(derived.diagnostics.filter(d => d.includes('derive no ranked route'))).toHaveLength(0)
})
