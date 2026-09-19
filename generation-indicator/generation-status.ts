/**
 * generation-status — which prepared release this process actually loaded, and how far
 * origin/agents has moved past it.
 *
 * Everything here is file reads only, with one explicit exception: aheadCount spawns git through
 * channel-prepare's commitsBehind, and only when the ref tip has moved away from the loaded commit
 * and no cache entry covers that exact pair. The steady-state render path is therefore free of git
 * spawns: tip equal to the loaded commit costs one ref-file read, and a repeated poll of an
 * unchanged tip costs one cache-file read.
 *
 * No TUI imports live here; the core suite exercises this module directly, and the footer in
 * tui-active/ is a thin render over it. No module-level side effects: every function is safe to
 * import from anywhere.
 */
import { readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { atomic, commitsBehind } from "../scripts/channel-prepare.mjs"

/** The ref the maintained source checkout tracks; the indicator measures distance from it. */
export const REMOTE_REF = "refs/remotes/origin/agents"

export type LoadedIdentity = {
  channel: string | undefined
  generation: string | undefined
  configDir: string
  commit: string | undefined
  subject: string | undefined
  ref: string | undefined
  resolved: string | undefined
}

/**
 * The identity of the code this process actually loaded, from the receipts the launcher copies
 * into the launch config root — file reads only, never a git spawn.
 *
 * A plain source checkout (`oc --here` with no prepared release) has no channel-release.json;
 * that is the normal "nothing to show" case, not an error. When a generation receipt exists its
 * recorded source commit must equal the release's commit: quest/source-binding.ts applies the
 * same cross check for its own purpose, and an identity the two receipts cannot back up together
 * is reported as nothing rather than as something wrong.
 */
export function loadedGeneration(env: NodeJS.ProcessEnv = process.env): LoadedIdentity | undefined {
  const configDir = env.OPENCODE_CONFIG_DIR
  if (!configDir) return undefined
  const channel = env.OPENCODE_RELEASE_CHANNEL
  const generation = env.OPENCODE_PLUGIN_GENERATION
  let release: any
  try {
    release = JSON.parse(readFileSync(join(configDir, "channel-release.json"), "utf8"))
  } catch {
    return undefined
  }
  if (!release || typeof release !== "object") return undefined
  if (generation) {
    let source: any
    try {
      source = JSON.parse(readFileSync(join(configDir, "generations", generation, ".deployment-source.json"), "utf8"))
    } catch {
      return undefined
    }
    if (!source || source.commit !== release.commit) return undefined
  }
  return {
    channel,
    generation,
    configDir,
    commit: release.commit,
    subject: release.subject,
    ref: release.ref,
    resolved: release.resolved,
  }
}

export type RefTip = { sha: string; mtimeMs: number }

/**
 * The commit a ref currently names, read straight out of .git — no git spawn. Loose ref first,
 * then packed-refs (lines look like `<sha> refs/remotes/origin/agents`; `^` peel lines after
 * annotated tags are skipped). Missing or unreadable files mean "cannot tell", never a throw.
 */
export function readRemoteRefTip(repositoryDir: string, ref: string = REMOTE_REF): RefTip | undefined {
  const loose = join(repositoryDir, ".git", ref)
  try {
    const sha = readFileSync(loose, "utf8").trim()
    if (/^[0-9a-f]{40}$/i.test(sha)) return { sha, mtimeMs: statSync(loose).mtimeMs }
  } catch { /* no readable loose ref: fall through to packed-refs */ }
  try {
    const packed = join(repositoryDir, ".git", "packed-refs")
    const text = readFileSync(packed, "utf8")
    const suffix = " " + ref
    for (const line of text.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("^")) continue
      if (!trimmed.endsWith(suffix)) continue
      const sha = trimmed.slice(0, trimmed.length - suffix.length).trim()
      if (/^[0-9a-f]{40}$/i.test(sha)) return { sha, mtimeMs: statSync(packed).mtimeMs }
    }
  } catch { /* no readable packed-refs either */ }
  return undefined
}

export type AheadCount = {
  count: number | undefined
  refSha: string
  asOf: number
  source: "current" | "cache" | "git"
}

type AheadCache = { refSha: string; loadedCommit: string; count: number }

function readAheadCache(cacheFile: string): AheadCache | undefined {
  try {
    const parsed = JSON.parse(readFileSync(cacheFile, "utf8"))
    if (parsed && typeof parsed.refSha === "string" && typeof parsed.loadedCommit === "string" && typeof parsed.count === "number") return parsed
  } catch { /* a missing or corrupt cache is a cache miss */ }
  return undefined
}

/**
 * How many merges the ref tip is ahead of the loaded commit, safe to call from a render loop.
 *
 * The tip moving is observed from the ref file itself, so a stale cached count is never served
 * after a fetch. `asOf` is the ref file's mtime — when the tip was last observed to move — in all
 * three sources. commitsBehind can return undefined (the loaded commit is not an ancestor, or the
 * repository is in trouble); that is reported without caching, so the next poll tries again.
 */
export function aheadCount({ repositoryDir, loadedCommit, ref = REMOTE_REF, cacheFile }: {
  repositoryDir: string
  loadedCommit: string | undefined
  ref?: string
  cacheFile: string
}): AheadCount | undefined {
  const tip = readRemoteRefTip(repositoryDir, ref)
  if (!tip) return undefined
  if (tip.sha === loadedCommit) return { count: 0, refSha: tip.sha, asOf: tip.mtimeMs, source: "current" }
  const cache = readAheadCache(cacheFile)
  if (cache && cache.refSha === tip.sha && cache.loadedCommit === loadedCommit) {
    return { count: cache.count, refSha: tip.sha, asOf: tip.mtimeMs, source: "cache" }
  }
  const count = commitsBehind(repositoryDir, loadedCommit, ref)
  if (count !== undefined) atomic(cacheFile, { refSha: tip.sha, loadedCommit, count })
  return { count, refSha: tip.sha, asOf: tip.mtimeMs, source: "git" }
}

/** State shared across immutable plugin generations lives under the state home, never in them. */
export function defaultCacheFile(): string {
  return join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local/state"), "opencode", "generation-ahead-cache.json")
}

/**
 * The default maintained-source checkout, same default channel-prepare's sourceRepository() uses.
 * This is the plain path with no canonicalizing git spawn; the TUI resolves through
 * sourceRepository() once at setup and only lands here when that resolution fails.
 */
export function defaultSourceRepository(): string {
  return join(homedir(), "Projects", "JonsOCsetup")
}

/**
 * Fit a label at a word boundary, with an ellipsis when shortened.
 *
 * Vendored from quest/tui-active/quest-board.tsx's fitTitle rather than imported: quest/tui-active/*
 * is owned by quests and out of scope for this plugin (also currently being rewritten elsewhere),
 * and fitTitle is not a surface plugin-set.json declares for cross-plugin import. Behavior kept
 * identical on purpose — the renderer's own ellipsis is a middle cut with no word-boundary setting,
 * which is exactly the defect this exists to avoid.
 */
export function fitTitle(title: string, max: number): string {
  const clean = title.replace(/\s+/g, " ").trim()
  if (max <= 1) return "…"
  if (clean.length <= max) return clean
  const words = clean.split(" ")
  let out = ""
  for (const word of words) {
    const next = out ? `${out} ${word}` : word
    if (next.length > max - 1) break
    out = next
  }
  if (!out) out = clean.slice(0, max - 1)
  return `${out.replace(/[\s,;:·—–-]+$/, "")}…`
}

/**
 * The part of the line that matters and must never be cut: what state agents is in. Undefined when
 * the state is unknowable, so the caller can fall back to naming only what is running.
 */
export function indicatorState({ count, asOf }: { count: number | undefined; asOf?: number }): string | undefined {
  if (count === undefined) return undefined
  const time = asOf ? new Date(asOf).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : undefined
  if (count === 0) return "Up to date with agents" + (time ? " as of " + time : "")
  return "agents is " + count + " merge" + (count === 1 ? "" : "s") + " ahead" + (time ? " as of " + time : "") + " · relaunch oc"
}

/** What is running, named: the subject with a short hash directly next to it. Nothing invented. */
export function subjectLabel({ subject, commit }: { subject: string | undefined; commit: string | undefined }): string {
  const hash = commit ? commit.slice(0, 7) : undefined
  return (subject ?? "") + (hash ? " (" + hash + ")" : "")
}

/**
 * The one footer line. The state leads and is never shortened; only the subject that follows it is
 * fit to whatever room `width` leaves, on a word boundary, so a narrow composer row cuts the name of
 * what is running rather than the fact Jon actually needs — the one middle-cut originally did.
 * `width` is the box's own measured width (in cells), not the terminal's; omit it to render
 * unshortened (used by the core suite, which has no render context to measure).
 */
export function formatIndicator({ subject, commit, count, asOf, width }: {
  subject: string | undefined
  commit: string | undefined
  count: number | undefined
  asOf?: number
  width?: number
}): string {
  const state = indicatorState({ count, asOf })
  const label = subjectLabel({ subject, commit })
  if (!state) return "Running: " + label
  if (width === undefined) return state + " · " + label
  const separator = " · "
  const room = width - state.length - separator.length
  return state + separator + fitTitle(label, Math.max(8, room))
}
