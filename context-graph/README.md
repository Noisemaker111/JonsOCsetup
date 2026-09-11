# Context graph

`/context-graph` (alias `/tokens`) opens a full-screen route showing where the live
conversation's tokens went, so the accounting is a view in the app instead of a script
run in another terminal.

The screen keeps two kinds of figure apart and never adds them together.

**Recorded** — cold-start size, per-turn sent vs cache-read, output and cost, and the
session totals — are the provider's own counters, read from `session_message.data.tokens`
in the host database. They are measurements.

**Attributed** — the stacked bar and the ranked list of sources — are derived from the
stored parts at 4 chars/token, because that is the part a change can actually shrink.
Every line carrying them says the estimate is an estimate.

Tool metadata (`state.metadata` on a `tool` part) is stored for the TUI and is never sent
to the model: `aisdk.ts toolResultPart` builds the request from the result. It is reported
on its own line as stored-not-sent and is excluded from every share.

Facts about the stored shape that the attribution depends on: a message's parts are
`text` / `reasoning` / `tool` — there is no tool-call/tool-result pair — and a `tool` part
carries the call and the result together under `state` as `input` / `content` / `metadata`.

`context-graph.ts` owns the reading and the attribution. `scripts/context-audit.ts` reads
through the same module, so the screen and the CLI cannot report different numbers for the
same session.

## Where a Code Mode execute went

`/context-graph` answers where the tokens went. `execute-attribution.ts` answers where the *time*
went inside a Code Mode `execute`, which is one tool call in the timeline but really a small program
that calls other tools: 1,571 execute parts on this installation made 2,286 inner calls, one of them
24 in a single part.

`execute-timing.ts` is the recording half, loaded as this plugin's server entrypoint. The host runs
an inner Code Mode call through the same path as a direct one, so it fires the `tool` plugin hooks
like any other call — with the one difference that makes this work: an inner call inherits the outer
execute's context, so `event.id` is the enclosing part's id. An `execute.before` naming `execute`
opens a frame, every hook afterwards with the same id and another tool name is an inner call of it,
and the closing `execute.after` writes the spans into `result.metadata.innerCalls`. Metadata is
stored for the TUI and never sent, so the record costs no context tokens.

`execute-attribution.ts` is the reading half. A timed execute's span is split four ways and the four
are exact: inner tool calls (the union of their spans, so `Promise.all` is counted once rather than
summed), runtime startup before the first call, gaps between calls, and the return after the last.
Only the first is charged to a tool; the rest is named by where it sits rather than distributed.

Three things it can never time, and names instead of hiding: Code Mode's built-in `search` resolves
against the runtime's own catalog and never reaches a host tool; a call the runtime rejects on its
own signature check is recorded `error` without ever being dispatched; and a failed execute returns
the error instead of a result, so there is no metadata to write on at all.

`scripts/execute-attribution.ts` reads through this module, as any duration view should.
