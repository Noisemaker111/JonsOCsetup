# UI lab: the quest + usage plugin surfaces, isolated

Every piece of plugin chrome the OpenCode2 host shows, rendered headless from one
fixture, without launching the host, touching the real ledger, or hitting the
network. Edit a component, run one command, look at the result. Push the same
captures into Paper as editable artboards when you want to design rather than code.

## Run it

```bash
bun run ui:lab
```

Then open `ui-lab/out/index.html` in a browser. Per surface you also get
`<surface>.png`, `.svg`, `.txt` (the exact cell grid) and `.html`.

Only some surfaces, or a different terminal size:

```bash
bun run ui:lab sidebar footer
bun run ui:lab board --width 160 --height 50
```

**Your real data instead of the fixture** (this is the 1:1 capture to hold next to a
host screenshot: your shared Quest ledger, your accounts, your telemetry):

```bash
bun run ui:lab --real
```

Real mode reads only. The usage cache is copied and stamped fresh so the dialog does
not spawn the network collector. Surfaces that need a specific fixture Quest or the
empty ledger are skipped in real mode.

## What makes a capture 1:1

- **Size**: the board renders at 200×50 cells, the sidebar at 40 columns, the `/usage`
  dialog at 60 columns, all measured from host screenshots. Change `HOST_COLS`,
  `HOST_ROWS`, `SIDEBAR_COLS`, `DIALOG_COLS` in `render.tsx` if your terminal differs.
- **Theme**: cells a component never paints show the host's own ground. The board
  paints its own palette; the sidebar, footer and dialog sit on the host's near-black
  and gray. The lab passes the plugins no `theme`, because the live host passes none
  either, which is why `/usage` is grayscale in the host.
- **Chrome**: the composer box and the host footer row around the `prompt.footer`
  slot, and the sidebar column around `sidebar.content`, are static mocks traced from
  screenshots. Only the plugin content inside them is live code.
- **Data**: `--real` for your ledger and accounts; the fixture otherwise.

## Surfaces → source

| id | What it is | Edit this |
| --- | --- | --- |
| `board` | `/quests` full-screen route, legacy Quest selected | `quest/tui-active/quest-board.tsx` — `QuestBoard`, `Row`, `SectionHeader`, `LegacyDetail`, `StageList`, `AgentLog`, `ActionBar`, palette `C` |
| `board-contract` | Same board, v2 contract Quest selected | `quest/tui-active/quest-board.tsx` — `ContractDetail` |
| `board-attention` | Same board, blocked step + failed worker | `quest/tui-active/quest-board.tsx` — `status()`, `badge()`, `sessionColor()` |
| `board-empty` | First-run, no Quests | `quest/tui-active/quest-board.tsx` — `QuestBoard` fallback |
| `sidebar` | The quest list beside the chat (`sidebar.content` slot) | `quest/tui-active/quests.tsx` — `Sidebar`, `laneColor` |
| `footer` | Bottom bar under the composer (`prompt.footer` slot): count line + live worker lines, then the usage gauge | `quest/tui-active/quests.tsx` — `Footer`; `quest/tui-active/quest-board.tsx` — `liveWorkerLines`, `workerStatusLine`, `fitTitle`; `usage/tui-active/usage.tsx` — `ContextFooter` |
| `usage` | The `/usage` dialog | `usage/tui-active/usage.tsx` — `UsageDialog`, `ConversationTelemetry`, `UsageTable`; column widths and bars in `usage/tui-usage-format.ts` |

Text that comes from data rather than layout lives one level down: the count
line wording is `questIndicator` in `quest/tui-model.ts`, the "Step 3/11: …"
next-action text is `nextStepAction` in `quest/steps.ts`, the progress glyphs and
ring are also in `quest/steps.ts`.

## Fixture

`fixture.ts` seeds a throwaway ledger with six Quests chosen to light up every
lane and state at once: running (legacy, rich detail), running (v2 contract),
needs attention, ready to turn in, brand new, archived. It also writes a usage
cache with connected / usage-reached / metered / empty sources and twelve
telemetry requests for the current session. Change the fixture when you need a
state the lab does not show; the real components render whatever is there.

## pen.dev (recommended canvas)

[pen.dev](https://pen.dev) (formerly Pencil) is a free design canvas that runs inside
Cursor/VS Code (extension `highagency.pencildev`) or as a desktop app. Its files are
plain JSON, so every lab run writes one directly, no MCP calls and no quota:

- `ui-lab/out/pen/quest-ui.pen` — the fixture set (9 surfaces)
- `ui-lab/out/pen/quest-ui-real.pen` — your real ledger/accounts (4 surfaces)

Open either file in Cursor. Each surface is a frame at the host's size; each terminal
row is a horizontal frame; each colour run is a text layer locked to the cells it
occupied (Cascadia Mono 16px on a 9.6×20 px grid), so the grid holds no matter what
you drag. Painted backgrounds (selected row, buttons) are frames with that fill.
Regenerate with `bun run ui:lab [--real]` after code changes; the file is overwritten,
so copy a frame to another page in pen.dev if you want to keep a hand-edited version.

The extension also ships an MCP server, registered for Claude Code at user scope as
`pencil` (it connects to the running Cursor, so Cursor must be open with a `.pen` file
or every call answers "transport not connected"). `bun ui-lab/pen-mcp.ts --tools|--state|
--call <tool> '<json>'` talks to the same server directly. Its tools are `execute`,
`get_app_state`, `get_style`, `read_skill`; `read_skill({"path":"pen-schema.md"})` is the
authoritative schema for the installed version. The headless `pen` CLI
(`npx @pen.dev/cli interactive --out x.pen --in y.pen --enable-preview`) can render
previews without an editor but needs `pen login` first.

## Paper

[Paper](https://paper.design) is a design canvas with a local MCP server. Once
the Paper desktop app is running with a file open, every capture can be pushed
as an artboard made of real text layers (one per colour run), so you can move,
recolour and retype on the canvas:

```bash
bun run ui:lab:paper
```

`bun run ui:lab:paper sidebar footer` pushes a subset. Other flags on `bun ui-lab/paper.ts`:
`--info` lists the file, page and artboards with node ids; `--inspect <id>` prints a
node's layer tree and saves a screenshot; `--delete <id,id>` removes artboards (a
superseded push); `--list-tools` prints what the running Paper exposes. After every
push a Paper screenshot lands in `ui-lab/out/paper-check/<surface>.png` so you can
confirm without switching windows. If no Paper file is open the script creates one
named "OpenCode2 quest UI lab". It speaks MCP over HTTP to `http://127.0.0.1:29979/mcp`
directly, so no client config is needed for it. To also let Claude Code or OpenCode read your
Paper canvas back (screenshots, JSX, styles), register the same endpoint:

```bash
claude mcp add paper --transport http http://127.0.0.1:29979/mcp --scope user
```

or in `opencode.json`:

```json
{ "mcp": { "paper": { "type": "remote", "url": "http://127.0.0.1:29979/mcp", "enabled": true } } }
```

The Paper fragments are plain HTML with inline styles: `ui-lab/out/paper/<surface>.html`.
They can also be pasted anywhere that accepts HTML.

## Loop

1. `bun run ui:lab` — before shots.
2. Push to Paper, redesign on the canvas (or sketch in the gallery HTML).
3. Edit the component named in the table above.
4. `bun run ui:lab <surface>` — compare against the before shot in `index.html`.
5. `bun test test/tui-quests.test.ts test/tui-usage.test.ts test/quest-board.test.ts` — the click targets and wording the tests pin.

`ui-lab/out/` is git-ignored; it is regenerated every run.
