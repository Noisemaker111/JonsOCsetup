/**
 * Time the tool calls a Code Mode `execute` makes, so its span stops being one opaque block.
 *
 * The host runs an inner Code Mode call through the same path as a direct one: `Tool.snapshot`
 * builds the Code Mode tool with `(name, tool, input, context) => beforeExecute(...)` and then
 * `executeTool(...)`, and both of those trigger the `tool` plugin hooks. So an inner call fires
 * `execute.before` and `execute.after` exactly like a top-level call does — with one difference
 * that makes the whole thing work: an inner call inherits the *outer* `execute` call's context, so
 * `event.id` is the enclosing execute part's id rather than an id of its own.
 *
 * That is the seam. An `execute.before` naming `execute` opens a frame; every hook afterwards
 * carrying the same id and a different tool name is an inner call of that frame; the `execute.after`
 * naming `execute` closes it and writes the spans into `event.result.metadata`, which the host
 * copies onto the stored part. Metadata is stored for the TUI and never sent to the model, so the
 * record costs nothing in context.
 *
 * What it cannot cover, and does not pretend to: when an execute fails or is interrupted the host
 * returns the error instead of a result, so there is no metadata to write onto and those spans stay
 * untimed. That gap is why an interrupted execute has to be named rather than measured — its
 * `time.completed` is stamped when the abort landed, so its span is the age of an abandoned call.
 * On this installation three such parts out of 1,571 carried 5,890.6 s of a 7,724.4 s total, and
 * one of them had an uninterrupted twin that ran the identical program in 45.9 s.
 * `execute-attribution.ts` therefore reports interrupted spans as `abortedMs`, outside the
 * execution denominator.
 */
import type { InnerCallRecord } from "./execute-attribution"

type OpenCall = { tool: string; start: number }
type Frame = { opened: number; calls: InnerCallRecord[]; open: OpenCall[] }

/**
 * A frame is closed by the outer `execute.after`, which an interrupted execute never fires, so the
 * map needs its own bound. Concurrent executes in one host are a handful at most; this is slack.
 */
const MAX_FRAMES = 64

export class ExecuteTiming {
  private readonly frames = new Map<string, Frame>()

  /** Host ids are `ses_…` and `call_…`, so a space cannot collide with either half. */
  private key(sessionID: string, id: string) { return sessionID + " " + id }

  before(sessionID: string, id: string, tool: string, now = Date.now()) {
    const key = this.key(sessionID, id)
    if (tool === "execute") {
      if (this.frames.size >= MAX_FRAMES) {
        const oldest = [...this.frames.entries()].sort((a, b) => a[1].opened - b[1].opened)[0]
        if (oldest) this.frames.delete(oldest[0])
      }
      this.frames.set(key, { opened: now, calls: [], open: [] })
      return
    }
    // No frame means this is a direct call that happens to share nothing with Code Mode.
    this.frames.get(key)?.open.push({ tool, start: now })
  }

  /** Returns the finished spans when `tool` is `execute`, closing the frame. */
  after(sessionID: string, id: string, tool: string, status: string, now = Date.now()): InnerCallRecord[] | undefined {
    const key = this.key(sessionID, id)
    const frame = this.frames.get(key)
    if (!frame) return undefined
    if (tool === "execute") {
      this.frames.delete(key)
      // "Pending calls are interrupted when execution ends", so a call still open when the program
      // returned really did run for this long and is kept, marked for what it is.
      const interrupted = frame.open.map(call => ({ tool: call.tool, start: call.start, end: now, status: "interrupted" as const }))
      return [...frame.calls, ...interrupted].sort((a, b) => a.start - b.start)
    }
    // Same-named calls are matched first-in-first-out. Which of two concurrent `quest` calls owns
    // which end is unknowable from the hook payload and does not change any reported figure: the
    // merged coverage and the per-tool totals are identical either way.
    const index = frame.open.findIndex(call => call.tool === tool)
    if (index < 0) return undefined
    const [call] = frame.open.splice(index, 1)
    frame.calls.push({ tool, start: call.start, end: now, status: status === "error" ? "error" : "completed" })
    return undefined
  }
}

/** Install the hooks on a plugin context. Shape-checked because a host without them must not throw. */
export async function installExecuteTiming(ctx: any): Promise<ExecuteTiming | undefined> {
  if (typeof ctx?.tool?.hook !== "function") return undefined
  const timing = new ExecuteTiming()
  await ctx.tool.hook("execute.before", (event: any) => {
    const id = event?.id ?? event?.callID
    if (event?.sessionID && id && typeof event.tool === "string") timing.before(event.sessionID, id, event.tool)
  })
  await ctx.tool.hook("execute.after", (event: any) => {
    const id = event?.id ?? event?.callID
    if (!event?.sessionID || !id || typeof event.tool !== "string") return
    const spans = timing.after(event.sessionID, id, event.tool, String(event.status ?? ""))
    if (!spans?.length || !event.result) return
    // The host reads `result.metadata` back after the hook and stores it on the part.
    event.result.metadata = { ...(event.result.metadata ?? {}), innerCalls: spans }
  })
  return timing
}
