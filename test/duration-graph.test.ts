/**
 * @core-prevents reading a tool call's duration from state.time and treating uncovered stretches as model time, so the duration accounting invents tool spans that do not exist and reports the model as slower than the provider was
 * @core-observed A tool part's time lives at part.time, not part.state.time which is undefined on all 6,091 tool parts in the production ledger, and the host creates the assistant message lazily on the provider's first output event, so on live session ses_faaebdd2affeBCOfu2EVVHDAiR 3m22s of the 13m25s working window is recorded by nothing at all and only appears if uncovered time is kept as its own segment (2026-09-11).
 */
import { expect, test } from "bun:test"
import { attributeDuration, GAP_LABEL, MODEL_LABEL, WAITING_LABEL, toolLabel, type SessionDuration } from "../duration-graph/duration-graph"
import type { MessageRow } from "../context-graph/context-graph"

const message = (type: string, seq: number, data: unknown): MessageRow => ({ type, seq, data: JSON.stringify(data) })
const at = (offset: number) => 1_000_000 + offset
const found = (result: Pick<SessionDuration, "segments">, label: string) => result.segments.find(segment => segment.label === label)

test("every millisecond of the session lands in exactly one segment, and uncovered time stays visible", () => {
  // One turn shaped like the sketch: a prompt, a gap before the first token, reasoning, two tools
  // that overlap, and a tail the assistant message never covered.
  const result = attributeDuration({ time_created: at(0), time_updated: at(10_000) }, [
    message("user", 1, { text: "go", time: { created: at(500) } }),
    message("assistant", 2, {
      time: { created: at(2_000), streamed: at(4_000), completed: at(9_000) },
      content: [
        { type: "reasoning", text: "…", time: { created: at(2_000), completed: at(3_000) } },
        // created -> ran is the model writing the arguments and the host dispatching.
        { type: "tool", name: "edit", time: { created: at(3_000), ran: at(3_200), completed: at(6_200) }, state: { status: "completed", input: {}, content: "" } },
        { type: "tool", name: "read", time: { created: at(3_000), ran: at(3_200), completed: at(4_200) }, state: { status: "completed", input: {}, content: "" } },
      ],
    }),
  ])

  // The partition is the whole point: nothing may be lost, duplicated or quietly spread around.
  const sum = result.segments.reduce((n, segment) => n + segment.ms, 0)
  expect(sum).toBe(result.durationMs)
  expect(result.durationMs).toBe(10_000)
  expect(result.segments.every(segment => segment.ms >= 0)).toBe(true)

  // The prompt at +500 splits idle from latency: before it the session waited on the human, after
  // it the host took 1.5s that no span covers. Folding that into the model would hide it.
  // The 1s tail after the reply is idle again — nothing was running and no input had arrived.
  expect(found(result, WAITING_LABEL)!.ms).toBe(500 + 1_000)
  expect(found(result, GAP_LABEL)!.ms).toBe(1_500)
  expect(result.gapCount).toBe(1)

  // Tool time comes from part.time (created/ran/completed), never from state, which carries none.
  // read and edit share 1,000ms, so the shared run is split and the double count is reported.
  expect(found(result, toolLabel("edit"))!.ms).toBe(3_000 - 500)
  expect(found(result, toolLabel("read"))!.ms).toBe(500)
  expect(result.concurrentToolMs).toBe(1_000)
  expect(result.toolCalls).toBe(2)

  // Reasoning is separable, and what is left of the envelope is the model's own response.
  expect(found(result, "assistant reasoning")!.ms).toBe(1_000)
  expect(found(result, "tool call args + dispatch")!.ms).toBe(200)
  expect(found(result, MODEL_LABEL)!.ms).toBe(9_000 - 6_200 + (3_200 - 3_000 - 200))
  expect(result.activeMs).toBe(result.durationMs - result.waitingMs)
})
