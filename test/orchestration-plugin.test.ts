/**
 * The watchdog installer must not block plugin setup.
 *
 * watchSubagentCompletions ends in `for await (const event of stream)` over
 * the host event stream, so it returns only when the server goes down. When
 * the orchestration split turned the original `void watchSubagentCompletions(ctx)`
 * into `await`, setup() stopped resolving and the host hung before it finished
 * booting: no error, no output, and every model in the promotion gate reported
 * a bare "timeout". This test reproduces that in-process.
 */
import { expect, test } from "bun:test"
import { installWatchdog } from "../plugins-active/quests"
import { watchdogState } from "../orchestration/orchestration"
import orchestration from "../plugins-active/quests"

/** A stream that never ends, exactly like the real host event subscription. */
function neverEndingCtx() {
  let released: () => void = () => {}
  const ctx = {
    event: {
      subscribe: async () => ({
        async *[Symbol.asyncIterator]() {
          await new Promise<void>((resolve) => { released = resolve })
        },
      }),
    },
    session: { get: async () => undefined },
    tool: { hook: async () => {} },
  }
  return { ctx, release: () => released() }
}

const withinMs = async (ms: number, work: () => unknown) => {
  const timeout = new Promise<"timeout">((r) => setTimeout(() => r("timeout"), ms))
  return Promise.race([Promise.resolve(work()).then(() => "done" as const), timeout])
}

test("installWatchdog returns while the event stream stays open", async () => {
  const { ctx, release } = neverEndingCtx()
  expect(await withinMs(2000, () => installWatchdog(ctx))).toBe("done")
  release()
})

test("plugin setup completes even though the watchdog runs forever", async () => {
  // The whole failure was that setup() never resolved, so assert on setup()
  // itself and not just the installer it calls.
  //
  // The watchdog installs once per process and keeps that flag on globalThis,
  // so without this reset the previous test has already claimed it and this
  // one passes by taking the early return — green against the very bug it
  // exists to catch.
  watchdogState().installed = false
  const { ctx, release } = neverEndingCtx()
  expect(await withinMs(5000, () => (orchestration as any).setup(ctx))).toBe("done")
  release()
})
