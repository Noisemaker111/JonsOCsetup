/**
 * benchmarks.md is the source of truth for public coding-agent scores, and it is written to be
 * read by a person. Routing needs the same numbers, and a second machine file would drift from
 * the prose within a week, so the document itself carries one fenced `benchmark-routing` block
 * and this parses it.
 *
 * Nothing here invents a score. Every entry names its effort level, provenance, source URL and
 * measurement date, and a route may only claim the number published for the effort level it
 * actually runs at. `unstated` is a real effort key: it means the source printed a headline
 * figure without saying which effort produced it, and callers must say so rather than quietly
 * attributing it to the cheap tier.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { canonicalModelID } from "./model-catalog"

export type BenchmarkProvenance = "independent" | "vendor"
export type BenchmarkEntry = {
  /** Catalog model id, e.g. `deepseek-v4.1-flash`. Matching is on the canonical last segment. */
  id: string
  /** Other catalog ids that are the same weights, e.g. an OpenCode Go `-contributor` packaging. */
  aliases?: string[]
  provenance: BenchmarkProvenance
  source: string
  measuredAt: string
  /** Artificial Analysis Intelligence Index, when the document records one. */
  intelligence?: number
  /** effort level -> pass@1. The key `unstated` means the source published no effort level. */
  passAt1: Record<string, number>
}
export type BenchmarkTable = { version: 1; suite: string; entries: BenchmarkEntry[] }

export const benchmarkFile = () => process.env.OPENCODE_BENCHMARKS ?? join(import.meta.dir, "benchmarks.md")
const FENCE = /```json benchmark-routing\r?\n([\s\S]*?)\r?\n```/

export function readBenchmarkTable(file = benchmarkFile()): BenchmarkTable {
  let document: string
  try { document = readFileSync(file, "utf8") } catch { throw new Error("Benchmark table is unavailable; " + file + " must carry a benchmark-routing block") }
  const block = FENCE.exec(document)
  if (!block) throw new Error("No fenced benchmark-routing block in " + file)
  let table: BenchmarkTable
  try { table = JSON.parse(block[1]) } catch (error) { throw new Error("benchmark-routing block is not valid JSON: " + (error as Error).message) }
  if (table?.version !== 1 || !table.suite?.trim() || !Array.isArray(table.entries) || !table.entries.length) throw new Error("benchmark-routing must be version 1 with a named suite and at least one model")
  const seen = new Set<string>()
  for (const entry of table.entries) {
    const names = [entry?.id, ...(entry?.aliases ?? [])]
    if (!names.every(name => typeof name === "string" && name.trim())) throw new Error("Benchmark entry needs a model id")
    if (!["independent", "vendor"].includes(entry.provenance)) throw new Error(entry.id + ": provenance must be independent or vendor")
    if (!entry.source?.trim() || !Number.isFinite(Date.parse(entry.measuredAt))) throw new Error(entry.id + ": every score needs a source and a measurement date")
    if (entry.intelligence !== undefined && !(Number.isFinite(entry.intelligence) && entry.intelligence > 0)) throw new Error(entry.id + ": invalid intelligence index")
    const efforts = Object.entries(entry.passAt1 ?? {})
    if (!efforts.length) throw new Error(entry.id + ": no pass@1 scores")
    for (const [effort, score] of efforts) {
      if (!effort.trim()) throw new Error(entry.id + ": empty effort level")
      if (!Number.isFinite(score) || score <= 0 || score > 1) throw new Error(entry.id + " " + effort + ": pass@1 must be a fraction in (0,1]")
    }
    if ("unstated" in entry.passAt1 && efforts.length > 1) throw new Error(entry.id + ": an unstated-effort score cannot sit beside per-effort scores")
    for (const name of names) {
      const key = canonicalModelID(name)
      if (seen.has(key)) throw new Error("Duplicate benchmark identity: " + name)
      seen.add(key)
    }
  }
  return table
}

/** Same weights, whatever gateway serves them: match on the canonical model id or a declared alias. */
export function benchmarkFor(table: BenchmarkTable, modelID: string): BenchmarkEntry | undefined {
  const want = canonicalModelID(modelID)
  return table.entries.find(entry => [entry.id, ...(entry.aliases ?? [])].some(name => canonicalModelID(name) === want))
}
