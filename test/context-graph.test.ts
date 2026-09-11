import { expect, test } from "bun:test"
import { attributeSession, sliceGroups, stackedBar, type MessageRow } from "../context-graph/context-graph"

/**
 * The one invariant worth a check: what the model was actually sent.
 *
 * A tool part carries the call, the result and TUI-only metadata together under `state`.
 * `aisdk.ts toolResultPart` builds the request from the result, so metadata is never sent —
 * counting it as context would overstate the graph, and the bar would be wrong in the direction
 * that makes the session look more expensive than it is.
 */
const message = (type: string, seq: number, data: unknown): MessageRow => ({ type, seq, data: JSON.stringify(data) })

test("tool metadata is reported as stored, never as sent context", () => {
  const result = attributeSession([
    message("user", 1, { text: "x".repeat(400) }),
    message("assistant", 2, {
      tokens: { input: 1000, output: 40, cache: { read: 250 } },
      cost: 0.001,
      content: [
        { type: "text", text: "y".repeat(80) },
        { type: "tool", name: "read", state: { input: { file: "z".repeat(90) }, content: "c".repeat(800), metadata: { preview: "m".repeat(4000) } } },
      ],
    }),
  ], [])

  const labels = result.slices.map(slice => slice.label)
  expect(labels).toContain("tool call in: read")
  expect(labels).toContain("tool result: read")
  expect(result.slices.find(slice => slice.label.startsWith("[stored, not sent]"))!.stored).toBe(true)
  // 4000 chars of metadata is the largest single bucket, and none of it is context.
  expect(result.storedOnlyTokens).toBeGreaterThan(result.sentTokens)
  expect(result.slices.filter(slice => slice.stored).every(slice => slice.share === 0)).toBe(true)
  expect(result.sentTokens).toBe(result.slices.filter(slice => !slice.stored).reduce((n, slice) => n + slice.tokens, 0))
  expect(sliceGroups(result.slices).some(group => group.kind === "stored")).toBe(false)

  // Recorded counters are passed through as measured, not re-derived from characters.
  expect(result.turns).toEqual([{ seq: 2, input: 1000, cached: 250, output: 40, reasoning: 0, cost: 0.001 }])
})

test("the stacked bar spends exactly the cells it is given", () => {
  const groups = [
    { kind: "tool-result" as const, tokens: 900, share: 0.9 },
    { kind: "instructions" as const, tokens: 99, share: 0.099 },
    { kind: "prompts" as const, tokens: 1, share: 0.001 },
  ]
  const cells = stackedBar(groups, 40)
  expect(cells.reduce((n, segment) => n + segment.cells, 0)).toBe(40)
  // A source that is present but tiny still gets a cell instead of vanishing.
  expect(cells.every(segment => segment.cells >= 1)).toBe(true)
})
