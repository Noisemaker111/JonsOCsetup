import { expect, test } from "bun:test"

/**
 * @core-prevents a renamed TUI bootstrap importing an API the runtime contract does not export.
 * @core-observed On 2026-09-19 a real OpenCode2 drive of the prepared development candidate showed the system plugin failed to load because its bootstrap imported the nonexistent runtimeSource export from scripts/runtime-contract.mjs.
 */
test("the system command bootstrap imports through the selected-generation contract", async () => {
  const plugin = await import("../tui-bootstrap/system/tui")
  expect(plugin.default).toBeDefined()
})
