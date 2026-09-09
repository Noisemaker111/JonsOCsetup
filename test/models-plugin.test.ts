/**
 * Routing is a plugin now, not a region of favorite-router.ts.
 *
 * That file had grown to 1859 lines covering five unrelated concerns, so
 * nothing could be shipped, tested or reasoned about on its own. Policy lives
 * in model-routing.ts (no plugin host at all); plugins-active/models.ts is
 * only the wiring.
 */
import { expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dir, "..")
const policy = readFileSync(join(root, "models", "model-routing.ts"), "utf8")
const plugin = readFileSync(join(root, "models", "server.ts"), "utf8")
const router = readFileSync(join(root, "harnesses", "server.ts"), "utf8")

/** Comments name the host APIs on purpose; only real code is checked. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

test("routing policy never touches the plugin host", () => {
  // The moment policy needs a ctx, it can only run inside this host.
  // Matched as real usage, not the word: "128k ctx" is a context-window label.
  expect(code(policy)).not.toMatch(/\bctx[.?]|\(ctx\b|ctx:\s*\{|@opencode-ai\/plugin/)
  expect(code(policy)).not.toMatch(/tool\?\.hook|session\?\.hook/)
})

test("the models plugin owns routing's host wiring", () => {
  for (const fn of ["installSpawnGuard", "installSessionModelGuard", "installQuotaContext", "installUsageFailureHook"]) {
    expect(`${fn}: ${plugin.includes(`export async function ${fn}`)}`).toBe(`${fn}: true`)
  }
  expect(plugin).toMatch(/id: "models"/)
})

test("favorite-router no longer installs routing hooks", () => {
  for (const fn of ["installGoSpawnGuard", "installSessionModelGuard"]) {
    expect(`${fn} in router: ${code(router).includes(fn)}`).toBe(`${fn} in router: false`)
  }
})

test("quota lines are injected once, by the plugin that owns quota", () => {
  // Router and models both used to push them into event.system, so every line
  // appeared twice. The router may still *read* quota — its watchdog reports a
  // cap when a subagent dies — it just must not own a context hook at all: the
  // only reason it had one was quest admission, which is now the quests plugin.
  expect(code(router)).not.toMatch(/session\.hook\("context"/)
  expect(plugin).toMatch(/quotaSummaryLine/)
  expect(code(plugin)).not.toMatch(/usageSummaryLine\(usage\)/)
})

test("every system push is a SystemPart object", () => {
  // A raw string bricks opencode2 sends with a schema validation error.
  for (const [name, src] of [["models", plugin], ["favorite-router", router]] as const) {
    for (const m of code(src).matchAll(/\.system\.push\(([^)]*)/g)) {
      expect(`${name}: ${m[1]}`).toMatch(/systemPart\(|\{ ?type: ?"text"/)
    }
  }
})

test("the models plugin is registered and its policy is a known helper", () => {
  const set = JSON.parse(readFileSync(join(root, "plugin-set.json"), "utf8"))
  expect(set.serverEntrypoints).toContain("plugins-active/models.ts")
  expect(set.helpersOutsideDiscovery).toContain("models/model-routing.ts")
})

test("the models plugin stays small — it is wiring, not logic", () => {
  const lines = plugin.split("\n").length
  expect(`models.ts lines: ${lines < 200}`).toBe("models.ts lines: true")
})

const orchestration = readFileSync(join(root, "orchestration", "orchestration.ts"), "utf8")
const questsPlugin = readFileSync(join(root, "quest", "server.ts"), "utf8")

test("the spawn ledger and watchdog live in the quests plugin; there is no orchestration plugin", () => {
  // Jk's model is "the Quest giver and the sessions on Quests". Tracking what
  // was spawned and whether its result reached the giver is Quest bookkeeping,
  // so the former orchestration plugin folded into quests.
  // Deliberately indifferent to `async`: installWatchdog must NOT be awaited.
  for (const fn of ["installCanonicalDispatch", "installLedger", "installWatchdog"]) {
    expect(`${fn}: ${new RegExp(`export (async )?function ${fn}\\b`).test(questsPlugin)}`).toBe(`${fn}: true`)
  }
  expect(existsSync(join(root, "plugins-active", "orchestration.ts"))).toBe(false)
  const set = JSON.parse(readFileSync(join(root, "plugin-set.json"), "utf8"))
  expect(set.serverEntrypoints).not.toContain("plugins-active/orchestration.ts")
})

test("the router installs no orchestration", () => {
  for (const fn of ["watchSubagentCompletions", "installOrchestrationLedger", "installTaskDisplay"]) {
    expect(`${fn} in router: ${code(router).includes(fn)}`).toBe(`${fn} in router: false`)
  }
})

test("the quests plugin owns binding and dispatch together", () => {
  expect(questsPlugin).toMatch(/export async function installQuestBinding/)
  expect(questsPlugin).toMatch(/id: "quests"/)
  expect(questsPlugin).toMatch(/\["canonical-dispatch"[\s\S]*?\["binding"/)
})

test("the completion watchdog registers once per process", () => {
  // Its state lives on globalThis so a hot-reload reuses the running watch;
  // a second subscription would double-inject every subagent result.
  expect(orchestration).toMatch(/Symbol\.for\(/)
  expect(orchestration).toMatch(/watchdogState/)
})

test("quests and models do not import each other's plugins", () => {
  for (const [name, src] of [["quests", questsPlugin], ["models", plugin]] as const) {
    expect(`${name}: ${/from "\.\/(models|orchestration)"/.test(code(src))}`).toBe(`${name}: false`)
  }
})
