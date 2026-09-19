# Verify through the user's controls

OpenCode, Codex and Claude must inspect the real project logic and use the product
through the same controls as the user. Identify the user operation before editing,
ensure the agent can perform it, repeat it after the change, and reopen its saved
result. Actual product use is the primary verification.

For websites use browser navigation, forms and clicks. For terminal or desktop
apps use native keys, mouse and screens. For a CLI run its public command. For
integrations call the tool through its configured host with real providers.
Private function calls, database edits, scripted provider replies and builds do
not prove the user operation works. Logs and code explain observed behavior.

Use existing browser/computer controls or a controller driving the real terminal.
Temporary interaction scripts may send input and capture output; do not encode
expected feature responses or maintain scenario suites. Resolve missing controls
before claiming verification. Preserve unrelated apps, real data and active work.

Keep a small core suite for consequential invariants: exact model identity, access
boundaries, workspace isolation, secret redaction and release identity. Exercise
production functions directly with concise cases and real temporary files where
filesystem behavior matters. Do not copy algorithms into tests, mock the app,
snapshot incidental text/layout, or build a suite for every feature. Core checks
supplement actual product use; they never replace it.

Before finishing, trace callers, registrations, generators and instructions for
replaced behavior. Remove obsolete implementations and exclusive helpers. Report
the user operation, observations, saved result after reopening, and any failure.
Keep private verification evidence out of public Git.

## OpenCode2 terminal control

From the selected dev release, start `bun run runtime:drive -- --config-root
<release> --cwd <project> --model <exact-route> --out <new-evidence-directory>`.
Use one shell command line; the wrap above is for readability. Add `--auto` only
for an already-authorized isolated run. The printed `commands` path accepts JSON
lines. All three agents can operate it through their native shell tools.

Append `{"action":"capture","name":"before"}` and inspect the PNG/text first.
Send `{"action":"paste","text":"/quests"}` then
`{"action":"key","name":"return"}` to open the actual board. Capture again,
choose coordinates from the observed screen, and use
`{"action":"click","x":10,"y":8}` or native keys to operate it. Coordinates
are one-based terminal cells. Capture after each meaningful operation. Use the
app's `/restart` command and reopen saved results when checking persistence.
Finish completed owned sessions with `{"action":"stop"}`. Captures and raw
terminal output remain local; no expected responses or feature scripts are built in.

`bun run check:core` runs the small retained production-logic checks. This command
is supplementary; it does not demonstrate that the board, composer or tools work.
