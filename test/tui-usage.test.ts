/**
 * Source gate for plugins/tui/usage.tsx.
 *
 * Lives under test/ (NOT plugins/) so the TUI/plugin loader cannot evaluate
 * `import { test } from "bun:test"` and throw:
 *   Cannot use test outside of the test runner. Run "bun test" to run tests.
 *
 * Self-test: plugins/tui/usage.log already recorded this three times:
 *
 *   keymap=yes registerLayer=false layer=true command.register=false
 *   keymapKeys=active,commands,dispatch,layer,mode,pending,shortcuts
 *   uiKeys=dialog,format,router,slot,tabs,toast
 *   setup() register failed: Error: Keymap.Provider is missing
 *       at registerCommands (...usage.tsx)
 *       at setup (...usage.tsx)
 *
 * `registerCommands at setup` = Keymap.Provider is missing.
 * Live beta-18684 context has keymap.layer(), but it is a Solid hook and must
 * run from a component mounted on the app slot. registerLayer no longer exists.
 *
 * Host slash autocomplete reads reachable palette slashes through
 * entry.command.slash.name. Commands need id + slash + namespace "palette".
 * Host already owns /sessions, so the plugin uses /running.
 *
 * This test would have caught:
 *   - keymap.layer (dead API; slash never registers)
 *   - home-only slot (append: "home.footer")
 *   - colliding slash name with host session.list
 * Wrong export shape ({ id, tui }) is already in smoke-test.ps1.
 */
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  COL,
  DIALOG_INNER,
  HEADER_LINE,
  MISSING,
  TABLE_WIDTH,
  emptySourceRow,
  fmtMoney,
  fmtPct,
  fmtReset,
  fmtStatus,
  formatDoc,
  formatRowLine,
  formatSubtitle,
  formatWindowRow,
  sourceHint,
} from "../usage/tui-usage-format"

const configRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const SRC = readFileSync(join(configRoot, "usage/tui-active/usage.tsx"), "utf8")

function skipString(src: string, i: number): number {
  const q = src[i]
  i++
  while (i < src.length) {
    if (src[i] === "\\") {
      i += 2
      continue
    }
    if (src[i] === q) return i + 1
    i++
  }
  return i
}

function balancedObject(src: string, openIdx: number): string {
  if (src[openIdx] !== "{") throw new Error(`expected { at ${openIdx}`)
  let depth = 0
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i]
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipString(src, i) - 1
      continue
    }
    if (ch === "{") depth++
    else if (ch === "}") {
      depth--
      if (depth === 0) return src.slice(openIdx, i + 1)
    }
  }
  throw new Error("unbalanced {")
}

function pluginDefineObject(src: string): string {
  const m = src.match(/export\s+default\s+Plugin\.define\s*\(\s*\{/)
  if (!m || m.index === undefined) throw new Error("export default Plugin.define({...}) not found")
  return balancedObject(src, m.index + m[0].length - 1)
}

/** setup() function body (the `{...}` after setup(...)), until its matching close. */
function setupBody(src: string): string {
  const obj = pluginDefineObject(src)
  const m = obj.match(/\bsetup\s*(?:\([^)]*\)\s*\{|:[\s\S]*?=>\s*\{)/)
  if (!m || m.index === undefined) throw new Error("setup( function not found in Plugin.define")
  return balancedObject(obj, m.index + m[0].length - 1)
}

/**
 * Everything this source must and must not do to register on beta-18684.
 *
 * Verified against the running host (0.0.0-beta-18684) rather than against
 * @opencode-ai/plugin 1.18.5 in node_modules, which still describes the old
 * shape. Live evidence from ~/.local/state/opencode/tui-usage.log:
 *
 *   keymapKeys=active,commands,dispatch,layer,mode,pending,shortcuts
 *   dialog keys=alert,clear,confirm,prompt,select,set,show
 *   undefined is not an object (evaluating 'context.slots.register')
 *   undefined is not an object (evaluating 'context.keymap.registerLayer')
 *   ui.slot(app) ok / ui.slot(prompt.footer) ok
 *
 * So: registerLayer and slots.register and dialog.replace are all gone, and
 * keymap.layer() must run from a mounted component because it reads the
 * Keymap context — calling it in setup() throws "Keymap.Provider is missing".
 */
function problems(raw: string): string[] {
  // Comments name the dead APIs on purpose — strip them so prose never fails
  // the file it is explaining.
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "")
  const found: string[] = []
  let body = ""
  try {
    body = setupBody(src)
  } catch (e) {
    found.push(e instanceof Error ? e.message : String(e))
    return found
  }
  if (/\bkeymap\.(layer|registerLayer)\s*\(/.test(body)) {
    found.push('setup() must not register a keymap layer (no Keymap.Provider); mount a component on the "app" slot')
  }
  if (body.includes("registerCommands(")) {
    found.push("setup() must not call registerCommands(")
  }
  if (/\bslots\.register\s*\(/.test(src)) {
    found.push("slots.register is gone in beta-18684; it throws and takes the rest of setup() down")
  }
  if (!/\bui\.slot\s*\(/.test(body)) {
    found.push("setup() must mount the context footer via ui.slot")
  }
  if (/\bkeymap\.registerLayer\s*\(/.test(src)) {
    found.push("keymap.registerLayer is gone in beta-18684; the plugin keymap exposes layer()")
  }
  if (!/\bkeymap\.layer\s*\(/.test(src)) {
    found.push("commands must register through keymap.layer() from a mounted component")
  }
  if (/\bdialog\.replace\s*\(/.test(src)) {
    found.push("ui.dialog.replace is gone in beta-18684; use dialog.show/select/confirm")
  }
  if (!/\bdialog\.show\s*\(|\bopenTuiDialog\s*\(/.test(src)) {
    found.push("must open its dialog through dialog.show")
  }
  if (!/["']prompt\.footer["']/.test(src)) {
    found.push('must mount the context footer on "prompt.footer" (the always-present composer footer)')
  }
  if (/\b(app_bottom|home_bottom|home_footer|sidebar_content|session_prompt_right)\b/.test(src)) {
    found.push("slot names are dotted in beta-18684, not underscored")
  }
  const slashNames = [...src.matchAll(/slash:\s*\{\s*name:\s*["']([^"']+)["']/g)].map((m) => m[1])
  if (!slashNames.includes("usage")) found.push('missing slash: { name: "usage" }')
  if (slashNames.includes("sessions")) {
    found.push('must not register slash: { name: "sessions" } (host session.list collision)')
  }
  if (/slashName:\s*["']/.test(src)) {
    found.push("slashName is gone; slash autocomplete reads the slash object")
  }
  if (!/\bid:\s*["']usage\.show["']/.test(src)) {
    found.push('command must use id: "usage.show" (command entries are keyed by id)')
  }
  return found
}

test("usage.tsx registers /usage through a mounted keymap.layer, not setup()", () => {
  const found = problems(SRC)
  expect(found).toEqual([])
})

test("usage.tsx registers a reachable /usage slash with no host collision", () => {
  // Comments and the inspectRegistered() diagnostic name the dead fields on
  // purpose — one reads whatever the host hands back, which may still be the
  // old shape. Only registration code is gated.
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "")
  expect(code).toMatch(/id:\s*["']usage\.show["']/)
  expect(code).toMatch(/slash:\s*\{\s*name:\s*["']usage["']/)
  expect(code).toMatch(/keymap\.layer\s*\(/)
  expect(code).not.toMatch(/keymap\.registerLayer/)
  expect(code).not.toMatch(/slashName:\s*["']/)
  expect(code).not.toMatch(/slash:\s*\{\s*name:\s*["']sessions["']/)
})

test("the context usage footer is wired to the same supported dialog path", () => {
  const footer = SRC.match(/function\s+ContextFooter[\s\S]*?(?=\nfunction\s+UsageCommands)/)?.[0] ?? ""
  expect(footer).toMatch(/openDialog\(context/)
  expect(footer).toMatch(/<UsageDialog\s+context=\{context\}/)
  expect(footer).toMatch(/onMouseUp=\{\(event: any\) => activateOnMouseUp\(/)
})

test("usage footer consumes the release that opens its dialog", () => {
  expect(SRC).toMatch(/function activateOnMouseUp\(/)
  expect(SRC).toMatch(/event\?\.stopPropagation\?\.\(\)/)
  expect(SRC).not.toMatch(/onMouseDown=/)
})

test("context footer does not hardcode a 200k overlay", () => {
  expect(SRC).not.toMatch(/EFFECTIVE_CONTEXT_LIMIT/)
  expect(SRC).not.toMatch(/200_000|200000/)
  expect(SRC).toContain("aggregateTelemetry(stored.records, { sessionID })")
  expect(SRC).not.toMatch(/function contextTokenCount/)
})

test("restart and update slashes spawn the host script without a second confirm", () => {
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "")
  expect(code).toMatch(/function runRestart/)
  expect(code).toMatch(/function runUpdate/)
  expect(code).not.toMatch(/dialog\?\.confirm/)
  expect(code).toMatch(/slash:\s*\{\s*name:\s*["']restart["']/)
  expect(code).toMatch(/slash:\s*\{\s*name:\s*["']update["']/)
  expect(code).toMatch(/\["-Update"\]/)
})

test("restart carries the session only to its owned supervisor and offers a safe unmanaged fallback", () => {
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "")
  const runRestart = code.slice(code.indexOf("function runRestart"), code.indexOf("function runUpdate"))
  // The supervisor owns the process; an unmanaged terminal must not stop peers.
  expect(runRestart).toMatch(/activeSessionID\(context\)/)
  expect(runRestart).toContain("requestManagedRestart(sessionID)")
  expect(runRestart).toContain("context.ui.dialog.alert")
  expect(runRestart).not.toContain("runHostScript(")
})

test("TUI plugin id is usage matching filename stem", () => {
  expect(pluginDefineObject(SRC)).toMatch(/id:\s*["']usage["']/)
  expect(pluginDefineObject(SRC)).not.toMatch(/usage-sessions/)
})

test("usage server owns usage_status", () => {
  const usageSrc = readFileSync(join(configRoot, "usage", "server.ts"), "utf8")
  expect(usageSrc).toMatch(/id:\s*["']usage["']/)
  expect(usageSrc).toMatch(/name:\s*["']usage_status["']/)
})

// Old source that produced usage.log: registerCommands at setup = Keymap.Provider is missing.
const OLD_PROVIDER_MISSING = `
export default Plugin.define({
  id: "usage-sessions",
  setup(context) {
    registerCommands(context, commands)
    context.keymap.layer(() => ({
      mode: "base",
      priority: 10,
      commands,
      bindings: [],
    }))
  },
})
`

const OLD_HOME_FOOTER = `
export default Plugin.define({
  id: "usage-sessions",
  setup(context) {
    return context.ui.slot({
      append: "home.footer",
      render: () => <UsageSlash />,
    })
  },
})
function UsageSlash() {
  context.keymap.layer(() => ({
    mode: "global",
    commands: [{ slashName: "usage" }],
    bindings: [],
  }))
}
`

const OLD_SESSIONS_COLLISION = `
export default Plugin.define({
  id: "usage-sessions",
  setup(context) {
    return context.ui.slot({
      append: "app",
      render: () => <UsageSlash />,
    })
  },
})
function UsageSlash() {
  context.keymap.layer(() => ({
    priority: 10,
    commands: [
      { id: "usage.show", slashName: "usage", slash: { name: "usage" } },
      { id: "sessions.show", slashName: "sessions", slash: { name: "sessions" } },
    ],
    bindings: [],
  }))
}
`

// The shape this file demanded until beta-18684 removed all three methods.
const PRE_18684 = `
export default Plugin.define({
  id: "usage",
  setup(context) {
    context.keymap.registerLayer({ commands: [{ id: "usage.show", slashName: "usage" }] })
    context.slots.register({ slots: { app_bottom: () => <ContextFooter /> } })
  },
})
function open(context) { context.ui.dialog.replace(() => <UsageDialog />) }
`

test("self-test: registering a keymap layer from setup() misses Keymap.Provider", () => {
  const found = problems(OLD_PROVIDER_MISSING)
  expect(found.some((m) => m.includes("registerCommands"))).toBe(true)
  expect(found.some((m) => m.includes("must not register a keymap layer"))).toBe(true)
  expect(found.some((m) => m.includes("must mount the context footer via ui.slot"))).toBe(true)
})

test("self-test: the pre-18684 API shape is rejected on all three methods", () => {
  const found = problems(PRE_18684)
  expect(found.some((m) => m.includes("slots.register is gone"))).toBe(true)
  expect(found.some((m) => m.includes("keymap.registerLayer is gone"))).toBe(true)
  expect(found.some((m) => m.includes("ui.dialog.replace is gone"))).toBe(true)
  expect(found.some((m) => m.includes("slot names are dotted"))).toBe(true)
  expect(found.some((m) => m.includes("slashName is gone"))).toBe(true)
})

test("self-test: home.footer alone would miss the session composer", () => {
  const found = problems(OLD_HOME_FOOTER)
  expect(found.some((m) => m.includes("prompt.footer"))).toBe(true)
  expect(found.some((m) => m.includes("slashName is gone"))).toBe(true)
})

test("self-test: colliding sessions slash would hide /usage", () => {
  const found = problems(OLD_SESSIONS_COLLISION)
  expect(found.some((m) => m.includes("sessions"))).toBe(true)
})

// Source-only: importing usage.tsx evaluates the OpenTUI JSX runtime, which
// is unavailable in Bun's ordinary test process. Money/doc formatters live
// in usage-format.ts (imported below); this file still gates JSX layout.
const FORMAT_SRC = readFileSync(join(configRoot, "usage", "tui-usage-format.ts"), "utf8")

test("usage layout never uses wrapping labels or n/a placeholders", () => {
  expect(SRC).not.toMatch(/resets-in/i)
  expect(SRC).not.toMatch(/\bn\/a\b/i)
  expect(SRC).not.toContain("Refreshing (up to 8s)")
  expect(SRC).not.toMatch(/value\s*=\s*["']STATUS["']/)
  expect(SRC).not.toMatch(/value=\{\s*row\.status\s*\}/)
  expect(FORMAT_SRC).not.toMatch(/resets-in/i)
  expect(FORMAT_SRC).not.toMatch(/\bn\/a\b/i)

  const usageTable = SRC.match(/function\s+UsageTable[\s\S]*?(?=\nfunction\s+SessionsTable)/)?.[0] ?? SRC
  const headers = [...usageTable.matchAll(/value\s*=\s*["']([^"']+)["']/g)].map((m) => m[1])
  expect(headers).toContain("%")
  expect(headers).not.toContain("STATUS")
  expect(headers).toContain("RESET")
  expect(headers.indexOf("%")).toBeLessThan(headers.indexOf("RESET"))
  expect(headers.every((header) => header.length <= 6)).toBe(true)
})

test("usage rows fit the 72-column dialog budget", () => {
  expect(SRC).toMatch(/import\s*\{[\s\S]*\bCOL\b[\s\S]*\}\s*from\s*["']\.\.\/tui-usage-format["']/)
  expect(TABLE_WIDTH).toBeLessThanOrEqual(DIALOG_INNER)
  expect(TABLE_WIDTH).toBeLessThanOrEqual(72)
  expect(Object.values(COL).every((width) => Number.isInteger(width) && width > 0)).toBe(true)

  // A row is rendered as one horizontal container, not a prose/table string
  // that can wrap at spaces. Cells must not wrap or shrink.
  expect(SRC).toMatch(/<box\s+flexDirection=["']row["']/)
  expect(SRC).toMatch(/flexWrap=["']no-wrap["']/)
  expect(SRC).toMatch(/wrapMode=["']none["']/)
  expect(SRC).toMatch(/\btruncate\b/)
  expect(SRC).toMatch(/flexShrink=\{0\}/)
  expect(SRC).toMatch(/minWidth=\{DIALOG_INNER\}/)
})

test("usage formatting keeps money stable and omits raw token/doc noise", () => {
  expect(FORMAT_SRC).toMatch(/toFixed\(2\)/)
  expect(FORMAT_SRC).not.toMatch(/slice\(0,\s*3\)/)
  expect(SRC).not.toMatch(/slice\(0,\s*3\)/)

  // Raw usedTokens is collector data, not a display column.
  expect(SRC).not.toMatch(/row\.usedTokens|value=\{[^}]*usedTokens/)

  // Plans may contain a generated "Edit me" placeholder; formatDoc omits it
  // and sourceHint never dumps wrapping paragraphs into the dialog.
  expect(FORMAT_SRC).toMatch(/edit\s+me/i)
  expect(SRC).not.toMatch(/\{\s*block\.doc\s*\}/)
  expect(SRC).toMatch(/sourceHint/)
})

test("usage-format: money is two decimals, never n/a", () => {
  expect(fmtMoney(3.7)).toBe("$3.70")
  expect(fmtMoney(12)).toBe("$12.00")
  expect(fmtMoney(146.69)).toBe("$146.69")
  expect(fmtMoney(Number.NaN)).toBe(MISSING)
  expect(fmtMoney(undefined)).toBe(MISSING)
  expect(fmtMoney(3.7)).not.toMatch(/n\/a/i)
  expect(fmtMoney(3.7).endsWith(".")).toBe(false)
})

test("usage-format: compact cells never wrap past 72", () => {
  expect(TABLE_WIDTH).toBeLessThanOrEqual(DIALOG_INNER)
  expect(HEADER_LINE.length).toBe(TABLE_WIDTH)
  expect(HEADER_LINE).not.toMatch(/STATUS/i)
  expect(HEADER_LINE.indexOf("%")).toBeGreaterThanOrEqual(0)
  expect(HEADER_LINE.indexOf("%")).toBeLessThan(HEADER_LINE.indexOf("RESET"))
  expect(Object.values(COL).reduce((sum, n) => sum + n, 0) + 6).toBe(TABLE_WIDTH)

  const go = formatWindowRow(
    { label: "5h", used: 3.69, cap: 12, pct: 61, resetsInSeconds: 720, status: "ok" },
    { id: "opencode-go" },
  )
  expect(go.window).toBe("5h")
  expect(go.pct).toBe("61%")
  expect(go.pctTone).toBe("ok")
  expect(go.reset).toBe("12m")
  expect(formatRowLine(go).length).toBeLessThanOrEqual(72)
  expect(go.pct).toBe("61%")
  expect(go.reset).not.toBe("")

  const capped = formatWindowRow(
    { label: "7d", used: 11, cap: 30, pct: 100, resetsInSeconds: 3 * 86400 + 18 * 3600, status: "rate-limited" },
    "ok",
  )
  expect(capped.pct).toBe("100%")
  expect(capped.reset).toBe("3d 18h")
  expect(formatRowLine(capped).length).toBeLessThanOrEqual(72)
  expect(capped.reset).not.toBe("")

  const grok = formatWindowRow(
    { label: "5h", used: 112.04, cap: null, pct: null, resetsInSeconds: 13 },
    { id: "grok-sub" },
  )
  expect(grok.metric).toBe("$112.04")
  expect(grok.pct).toBe(MISSING)
  expect(grok.reset).toBe("13s")
  expect(formatRowLine(grok)).not.toMatch(/n\/a/i)
  expect(formatRowLine(grok).includes("\n")).toBe(false)
  expect(formatRowLine(grok).length).toBeLessThanOrEqual(72)
})

test("usage-format: docs omit placeholders and do not dump Go paragraph", () => {
  expect(formatDoc("edit me - SuperGrok limits")).toBeUndefined()
  expect(formatDoc("edit me - your real Cursor 5h premium window")).toBeUndefined()
  expect(sourceHint("opencode-go", "Go: server rolling 5h AND weekly AND monthly")).toBe("Go: 5h+week+month are real caps")
  expect(sourceHint("grok-sub", "edit me - SuperGrok limits")).toBe("SuperGrok 5h window · not xAI metered")
  const long = "Go: " + "caps ".repeat(80)
  expect(formatDoc(long)?.length).toBeLessThanOrEqual(70)
  expect(formatDoc(long)?.includes("\n")).toBe(false)
  expect(fmtPct(null)).toBe(MISSING)
  expect(fmtReset(null)).toBe(MISSING)
  expect(fmtStatus("rate-limited", "ok")).toBe("cap")
  expect(fmtStatus(undefined, "no endpoint")).toBe("none")
  expect(emptySourceRow("none").metric).toBe(MISSING)
  expect(formatSubtitle("2s", false)).toBe("2s ago")
  expect(formatSubtitle("2s", true)).toBe("2s ago · stale")
})

test("the usage command layer never passes command ids as host key bindings", () => {
  // `bindings` is the host's key-binding list (input.move.left, ...). Passing
  // command ids there broke the whole layer, so /usage, /running, /restart and
  // /update all vanished while /quests (no bindings) kept working.
  const src = readFileSync(join(import.meta.dir, "..", "usage", "tui-active", "usage.tsx"), "utf8")
  const layer = src.slice(src.indexOf("function UsageCommands"), src.indexOf("export default Plugin.define"))
  expect(layer).toMatch(/mode:\s*["']global["']/)
  expect(layer).not.toMatch(/bindings:/)
})
