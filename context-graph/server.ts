/** Records how long each inner Code Mode call took, for the context and duration views. */
import { define } from "@opencode-ai/plugin/v2/promise"
import { installExecuteTiming } from "./execute-timing"

export default define({
  id: "context-graph",
  async setup(ctx) {
    await installExecuteTiming(ctx)
  },
})
