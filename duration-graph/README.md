# Duration graph

`/duration-graph` (alias `/duration` — not `/time`, which the host already owns) opens a
full-screen route showing where the
live conversation's wall clock went. It is `/context-graph` for time: same host database, same
"measure it, do not estimate it" rule, same module shared with a CLI so the two cannot drift.

Everything on the screen is a **recorded timestamp**. Nothing is estimated, and nothing is
distributed silently — the session window is *partitioned*, so every millisecond between the
session's first and last recorded event lands in exactly one segment and the segments sum to the
total. A rounding drift of a millisecond or two is printed rather than absorbed.

## The segments

| Segment | Measured from |
|---|---|
| `tool: <name>` | the tool part's `time.ran` → `time.completed` |
| `tool call args + dispatch` | the tool part's `time.created` → `time.ran`: the model writing the call's arguments, then permission and dispatch |
| `assistant reasoning` | a reasoning part's `time.created` → `time.completed` |
| `model response` | what is left of the assistant message's `time.created` → `time.completed` envelope |
| `waiting for you` / `idle before injected input` | uncovered time that runs up to the next input arriving |
| `unrecorded · request setup + first token` | uncovered time that runs from an input to the turn appearing |

A running tool outranks the envelope it sits inside, so a turn's envelope is only ever credited
with the part of itself no finer span claimed. Parallel calls split the milliseconds they genuinely
share, and the resulting double count is reported on its own line rather than folded into a
segment.

## Facts the attribution depends on

- A tool part's time is at **`part.time`**, not `part.state.time`, which is undefined. It is
  `{ created, ran, completed }`, and the host's own stats use `completed - coalesce(ran, created)`
  as a call's duration.
- An assistant message's `time.streamed` and `time.completed` are **reset by each new step**
  (`session/message-updater.ts`, `session.step.started`), so only `time.created` and the final
  `time.completed` are trustworthy for a multi-step turn.
- The host creates the assistant message **lazily, on the provider's first output event**
  (`session/runner/publish-llm-event.ts`, `startAssistant`). The stretch between an input arriving
  and the turn appearing is therefore request assembly plus time-to-first-token, and nothing
  records it. Folding it into the model would report the model as slower than the provider was, so
  it gets its own red segment instead.
- A `text` part carries no timestamps at all, which is why assistant text is never its own
  segment — it is inside the envelope residue labelled `model response`.
- Every non-assistant message type (`user`, `synthetic`, `system`, `compaction`,
  `agent-switched`, …) is an input the session sat waiting for, and each one ends an idle stretch.
  Without that, the host taking its own time after a worker reported back was excused as the human
  being slow, and the idle and latency figures were both wrong.

`duration-graph.ts` owns the reading and the attribution. `scripts/duration-audit.ts` reads
through the same module, so the screen and the CLI cannot report different numbers for the same
session. The stacked bar is laid out by `context-graph.ts`'s `stackedBar`, so there is one
implementation of that rounding rather than two.

```
bun scripts/duration-audit.ts --session <id>          # newest dev-release database
bun scripts/duration-audit.ts --db <host.db> --json   # a specific database, machine readable
bun scripts/duration-audit.ts --busiest 5             # the sessions that actually did work
```
