# Quest log redesign

The board now keeps task titles readable, puts state and the next useful action near the title, and uses Overview, Changes, and Activity to avoid burying results under diagnostics. Below 100 columns, it opens as a list; Enter or a click opens detail, and Escape returns to the list before returning to chat.

[Wide concept](concept-wide.png) · [Narrow concept](concept-narrow.png) · [Exact image-generation prompts](prompts.md)

[Before](before.png) · [Implemented wide view](after-wide.png) · [Implemented narrow list](after-list.png) · [Implemented review](after-review.png)

Concepts were generated with the built-in imagegen tool. The implementation uses real terminal components, with denser spacing and a flat list sorted by attention, review readiness, and progress. Status always comes from saved Quest state; sample mockup labels and verification claims are not copied into the product.

Actual-host screenshots use twelve synthetic work records saved through the real Quest API in an isolated ledger. They use the installed OpenCode2 host with a source TUI entrypoint registered through `cli.json`. They are actual terminal-buffer captures, not component mockups. Neither the live ledger nor the production activation pointer is changed. The before capture uses the previously active generation.

Keyboard: arrows select a Quest; Enter opens it; `/` searches title/description; `x` clears search; `f` filters; `q` opens the picker; `v`, `d`, and `h` select detail tabs; `e` expands plan details; `m` opens additional actions; Page Up/Down scroll the detail. Escape unwinds dialogs and narrow detail before returning to the originating chat.

A different Quest starts at the top of its detail. Current or blocked step details expand by default; other steps expand on click or through the plan picker. Ready and archived records lead with the recorded deliverable. Acceptance still requires confirmation and the existing runtime guard; no generation of verification claims, launch-policy bypass, or publishing is added.

Reproduce actual-host captures from this checkout (use its absolute path as `--root`):

```powershell
bun scripts/quest-ui-audit.ts --root <absolute-checkout> --scenario quests --cli-plugins --source-capture --keep-run --width 120 --height 40 --out audit/after/120x40
```

Use 80×30 and 200×50 for the other sizes. Captures, terminal recordings, and full logs remain under the ignored `audit/` directory. The real-renderer regression is part of `bun test` and can also run directly:

```powershell
bun --preload @opentui/solid/preload scripts/quest-redesign-render-check.tsx
```

The smoke script now reads its own checkout. Test preload isolates Quest workspace preferences from the live config. The ignored-parent Git test uses the same 60-second allowance as its neighbors; the multi-worktree allocation test has a 120-second allowance after observed 53–60-second runs. Both retain every assertion. The UI lab process helper now requests a hidden window, satisfying the existing process-policy check.

Validation: real-host flows passed at 80×30, 120×40, and 200×50. The UI regression run passed 13 tests; the smoke gate passed 103. The complete suite recorded 732 passes, one existing stress-test skip, and two Git integration timeouts. Both timed-out cases then passed isolated reruns (52.2s and 45.7s); the latter now has a 120-second allowance with unchanged assertions. No production activation or backend release was performed.
