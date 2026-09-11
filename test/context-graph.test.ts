/**
 * @core-prevents counting a tool part's state.metadata as context, so the token accounting reports bytes the model was never sent as if they were part of the prompt
 * @core-observed A tool part carries call, result and TUI-only metadata together under state; aisdk's toolResultPart builds the request from the result alone, and on a live beta-19398 session the read/grep metadata was 77 tok sitting in the same stored parts as 19,216 tok of real context (2026-09-11).
 */
import { expect, test } from "bun:test"
import { attributeSession, sliceGroups, type MessageRow } from "../context-graph/context-graph"

const message = (type: string, seq: number, data: unknown): MessageRow => ({ type, seq, data: JSON.stringify(data) })

test("tool metadata is reported as stored, and never as sent context", () => {
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
  // The call and the result shrink for different reasons, so they are separate sources.
  expect(labels).toContain("tool call in: read")
  expect(labels).toContain("tool result: read")

  // 4,000 chars of metadata is the largest single bucket here, and none of it is context.
  expect(result.storedOnlyTokens).toBeGreaterThan(result.sentTokens)
  expect(result.slices.filter(slice => slice.stored).every(slice => slice.share === 0)).toBe(true)
  expect(result.sentTokens).toBe(result.slices.filter(slice => !slice.stored).reduce((n, slice) => n + slice.tokens, 0))
  expect(sliceGroups(result.slices).some(group => group.kind === "stored")).toBe(false)

  // Recorded counters are passed through as the provider measured them, never re-derived.
  expect(result.turns).toEqual([{ seq: 2, input: 1000, cached: 250, output: 40, reasoning: 0, cost: 0.001 }])
})
