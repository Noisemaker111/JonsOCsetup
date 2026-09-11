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
