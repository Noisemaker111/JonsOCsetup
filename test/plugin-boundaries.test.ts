/**
 * One plugin = one self-contained unit. A plugin may import another plugin's
 * declared public surface, but never reach into its internals.
 */
import { expect, test } from "bun:test"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { dirname, join, normalize } from "node:path"

const root = join(import.meta.dir, "..")

const OWNED_DIRS: Record<string, string> = {
  "quest/": "quests",
  "project-router/": "project-router",
  "usage/": "usage",
  "models/": "models",
  // Folded into quests: the spawn ledger and completion watchdog serve Quest workers only.
  "orchestration/": "quests",
  "papercut/": "papercut",
  "harnesses/": "harness",
}

/** Compatibility modules that have not yet moved behind their owner. */
const OWNED_FILES: Record<string, string> = {
  "harness-run": "harness",
  "claude-code-task": "harness",
  "claude-code-session": "harness",
}

const set = JSON.parse(readFileSync(join(root, "plugin-set.json"), "utf8")) as {
  serverEntrypoints: string[]
  tuiEntrypoints: string[]
  entrypointOwners: Record<string, string>
  publicSurfaces: string[]
}

const posix = (path: string) => path.replaceAll("\\", "/")
const withoutExtension = (path: string) => path.replace(/\.(ts|tsx|json)$/, "")
const publicSurfaces = new Set(set.publicSurfaces.map(withoutExtension))

function ownerOf(path: string): string | undefined {
  const relative = posix(path)
  for (const [directory, owner] of Object.entries(OWNED_DIRS)) {
    if (relative.startsWith(directory)) return owner
  }
  const entrypointOwner = set.entrypointOwners[relative]
  if (entrypointOwner) return entrypointOwner
  const stem = relative.split("/").pop()?.replace(/\.(ts|tsx)$/, "") ?? ""
  return OWNED_FILES[stem]
}

function imports(src: string): string[] {
  return [...src.matchAll(/from\s+["'](\.\.?\/[^"']+)["']/g)].map((match) => match[1])
}

function importTarget(file: string, specifier: string): string {
  return posix(normalize(join(dirname(file), specifier)))
}

function sourceFiles(directory: string): string[] {
  const full = join(root, directory)
  if (!existsSync(full)) return []
  return readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
    const relative = posix(join(directory, entry.name))
    if (entry.isDirectory()) return sourceFiles(relative)
    return /\.(ts|tsx)$/.test(entry.name) ? [relative] : []
  })
}

function pluginSources(): Array<{ file: string; plugin: string; src: string }> {
  const files = new Set([
    ...Object.keys(OWNED_DIRS).flatMap((directory) => sourceFiles(directory)),
    ...set.serverEntrypoints,
    ...set.tuiEntrypoints,
    ...sourceFiles("plugins-active"),
    ...sourceFiles("tui-active"),
  ])
  return [...files].flatMap((file) => {
    const plugin = ownerOf(file)
    return plugin ? [{ file, plugin, src: readFileSync(join(root, file), "utf8") }] : []
  })
}

test("no plugin imports another plugin's internals", () => {
  for (const { file, plugin, src } of pluginSources()) {
    for (const specifier of imports(src)) {
      const target = importTarget(file, specifier)
      if (publicSurfaces.has(withoutExtension(target))) continue
      const owner = ownerOf(target)
      if (!owner || owner === plugin) continue
      expect(`${file} -> ${target} (owned by ${owner})`).toBe("")
    }
  }
})

test("the usage footer no longer owns Quest chrome", () => {
  const usage = readFileSync(join(root, "usage", "tui-active", "usage.tsx"), "utf8")
  expect(usage).not.toMatch(/readAllQuests|questCount|function QuestLog/)
})

test("usage owns usage_status instead of Favorite Router", () => {
  const usage = readFileSync(join(root, "usage", "server.ts"), "utf8")
  const router = readFileSync(join(root, "harnesses", "server.ts"), "utf8")
  expect(set.serverEntrypoints).toContain("usage/server.ts")
  expect(set.tuiEntrypoints).toContain("usage/tui-active/usage.tsx")
  expect(usage).toMatch(/name:\s*["']usage_status["']/)
  expect(router).not.toMatch(/name:\s*["']usage_status["']/)
})

test("quests is the only plugin rendering the Quest count", () => {
  const owners = pluginSources()
    .filter(({ src }) => /questIndicator|\bquests\b.*count/i.test(src))
    .map(({ plugin }) => plugin)
  expect([...new Set(owners)]).toEqual(["quests"])
})

test("the repo-local boundary rule lives in the OpenCode skill, not the global prompt", () => {
  const skill = readFileSync(join(root, "skills", "opencode", "SKILL.md"), "utf8")
  expect(skill).toMatch(/one plugin/i)
  expect(skill).toMatch(/directory names its owner|cross-plugin imports/i)
  expect(skill).toMatch(/vendored\/published|published package/i)
  if (existsSync(join(root, "AGENTS.md"))) {
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).not.toMatch(/one plugin/i)
  }
})

test("every cross-plugin quest import uses a declared public surface", () => {
  for (const { file, plugin, src } of pluginSources()) {
    for (const specifier of imports(src)) {
      const target = importTarget(file, specifier)
      if (ownerOf(target) !== "quests" || plugin === "quests") continue
      expect(`${file} -> ${target}: ${publicSurfaces.has(withoutExtension(target))}`)
        .toBe(`${file} -> ${target}: true`)
    }
  }
})

test("every registered entrypoint has one explicit owner", () => {
  for (const entry of [...set.serverEntrypoints, ...set.tuiEntrypoints]) {
    expect(`${entry} classified: ${ownerOf(entry) !== undefined}`).toBe(`${entry} classified: true`)
    expect(set.entrypointOwners[entry]).toBe(ownerOf(entry))
    expect(existsSync(join(root, entry))).toBe(true)
  }
  expect(set.serverEntrypoints).toContain("quest/server.ts")
  expect(set.entrypointOwners["plugins-active/favorite-router.ts"]).toBe("harness")
})

test("stable TUI bootstraps resolve implementations inside owned directories", () => {
  const usage = readFileSync(join(root, "tui-bootstrap", "usage", "tui.tsx"), "utf8")
  const quests = readFileSync(join(root, "tui-bootstrap", "quests", "tui.tsx"), "utf8")
  expect(usage).toMatch(/usage[\\/]+tui-active[\\/]+usage\.tsx/)
  expect(quests).toMatch(/quest[\\/]+tui-active[\\/]+quests\.tsx/)
  expect(usage).not.toMatch(/generations/)
  expect(quests).not.toMatch(/generations/)
})

test("declared public surfaces point at real owned modules", () => {
  for (const surface of set.publicSurfaces) {
    expect(existsSync(join(root, surface))).toBe(true)
    expect(ownerOf(surface)).toBeDefined()
  }
})


test("legacy discovery files contain only exports and every package server lives under its owner", () => {
  for(const file of sourceFiles("plugins-active")) {
    const source = readFileSync(join(root,file),"utf8").replace(/\/\*[\s\S]*?\*\//g, "").trim()
    expect(source.split(/\r?\n/).every(line => /^export (?:\*|\{ default \}) from ["'][^"']+["'];?$/.test(line.trim()))).toBe(true)
  }
  for(const owner of ["quest","models","usage","papercut","harnesses"]) {
    const manifest=JSON.parse(readFileSync(join(root,owner,"plugin.json"),"utf8"))
    expect(manifest.server).toBe(owner+"/server.ts")
  }
})
