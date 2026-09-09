import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"
import { redact } from "./privacy"

export const QUEST_ASSETS_DIRNAME = "quests-assets" as const

export type QuestArtifact = {
  name: string
  /** Repo-relative path of the stored capture, e.g. `.opencode/quests-assets/<questID>/before-board.png`. */
  path?: string
  uri?: string
  /** Free-form chain label: "before", "after", or "revision N". */
  label?: string
  revision?: number
  at: string
  verified: boolean
  digest?: string
}

/**
 * Canonical per-quest asset directory. It hangs off the canonical ledger
 * root (the same projectRoot the QuestStore is constructed with — see
 * quest/root.ts: never cwd, only OPENCODE_QUEST_ROOT
 * or home), so every session deterministically resolves the same directory
 * for a Quest: `<root>/.opencode/quests-assets/<questID>/`.
 */
export function questAssetsDir(projectRoot: string, questID: string): string {
  return join(projectRoot, ".opencode", QUEST_ASSETS_DIRNAME, questID)
}

/** Deterministically create (mkdir -p) the per-quest asset directory and return it. */
export function ensureQuestAssetsDir(projectRoot: string, questID: string): string {
  const dir = questAssetsDir(projectRoot, questID)
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Capture convention for UI quests (step: capture-convention-for-ui):
 * before the first edit capture a `before` shot, then after each revision
 * capture `revision N` / the final `after` shot, so one Quest carries the
 * whole before -> after chain instead of scattered screenshots.
 */
export const UI_CAPTURE_CONVENTION =
  "UI capture convention: before the first edit record label=before; " +
  "after each revision record label=revision N (N = 1, 2, …); " +
  "when the surface is accepted record label=after. " +
  "Every capture is an evidence-added event with kind=artifacts and a labeled " +
  "path under .opencode/quests-assets/<questID>/, so the board detail can " +
  "render the before -> after chain for the Quest."

function labelRevision(label: string | undefined, revision: unknown): number | undefined {
  if (Number.isSafeInteger(revision)) return revision as number
  const match = /^revision\s+(\d+)$/i.exec(String(label ?? "").trim())
  return match ? Number.parseInt(match[1], 10) : undefined
}

/** Normalize one raw evidence value into a canonical QuestArtifact. Throws on invalid input. */
export function normalizeArtifact(value: unknown): QuestArtifact {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : undefined
  if (!raw) throw new Error("artifact evidence must be an object with at least a name or path")
  const name = typeof raw.name === "string" && raw.name.trim()
    ? redact(raw.name.trim(), 300)
    : typeof raw.path === "string" && raw.path.trim()
      ? redact(basename(raw.path.trim()), 300)
      : typeof raw.uri === "string" && raw.uri.trim()
        ? redact(basename(raw.uri.trim()), 300)
        : undefined
  if (!name) throw new Error("artifact evidence requires a name (or path/uri to derive one from)")
  const label = typeof raw.label === "string" && raw.label.trim() ? redact(raw.label.trim().slice(0, 60), 60) : undefined
  const revision = labelRevision(label, raw.revision)
  const at = typeof raw.at === "string" && raw.at ? raw.at : new Date().toISOString()
  return {
    name,
    path: typeof raw.path === "string" && raw.path.trim() ? redact(raw.path.trim().replace(/\\/g, "/"), 500) : undefined,
    uri: typeof raw.uri === "string" && raw.uri.trim() ? redact(raw.uri.trim(), 500) : undefined,
    label,
    revision,
    at,
    verified: raw.verified === true,
    digest: typeof raw.digest === "string" && raw.digest ? redact(raw.digest, 200) : undefined,
  }
}

/** Sort a before -> revision(s) -> after chain for board display. */
export function artifactChain(artifacts: QuestArtifact[]): QuestArtifact[] {
  const rank = (artifact: QuestArtifact): number => {
    const label = (artifact.label ?? "").toLowerCase().trim()
    if (label === "before") return -1_000_000
    if (label === "after") return 1_000_000
    return artifact.revision ?? 0
  }
  return [...artifacts].sort((a, b) =>
    rank(a) - rank(b) || String(a.at).localeCompare(String(b.at)) || a.name.localeCompare(b.name),
  )
}

/** One board-detail row per artifact: `before — <path>`, `revision 1 — <path>`, … */
export function artifactLine(artifact: QuestArtifact): string {
  const target = artifact.path ?? artifact.uri ?? artifact.name
  return `${artifact.label ?? "artifact"} — ${target}`
}

/** Compact chain summary for the detail header, e.g. `before -> revision 1 -> after`. */
export function artifactChainSummary(artifacts: QuestArtifact[]): string {
  return artifactChain(artifacts).map((artifact) => artifact.label ?? artifact.name).join(" -> ")
}

export type CaptureInput = {
  name?: string
  label: string
  revision?: number
  /** Copy this existing file into the per-quest assets dir under a deterministic name. */
  sourcePath?: string
  /** Or write these bytes as the capture (together with `ext`, default `.png`). */
  bytes?: Uint8Array
  ext?: string
  verified?: boolean
}

/**
 * Capture convention helper: store one UI capture under the per-quest assets
 * dir (deterministic filename `<label>-<basename>`) and return the canonical
 * artifact value to record with `evidence(kind="artifacts")`. Creates the
 * assets dir deterministically; pure filesystem + pure object, no store I/O
 * (the caller journals it so the canonical ledger stays the only writer).
 */
export function buildCaptureArtifact(projectRoot: string, questID: string, input: CaptureInput, at = new Date().toISOString()): QuestArtifact {
  const label = input.label.trim()
  if (!label) throw new Error("capture requires a label (before, after, or revision N)")
  const dir = ensureQuestAssetsDir(projectRoot, questID)
  const safeLabel = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "capture"
  let filename: string
  if (input.sourcePath) {
    filename = `${safeLabel}-${basename(input.sourcePath)}`
    const destination = join(dir, filename)
    if (destination !== input.sourcePath && !existsSync(destination)) copyFileSync(input.sourcePath, destination)
    else if (destination !== input.sourcePath) copyFileSync(input.sourcePath, destination)
  } else if (input.bytes) {
    const ext = input.ext ?? ".png"
    filename = `${safeLabel}-${(input.name ?? "capture").replace(/[^a-z0-9._-]+/gi, "-")}${(input.name ?? "").includes(".") ? "" : ext}`
    writeFileSync(join(dir, filename), input.bytes)
  } else {
    throw new Error("capture requires sourcePath or bytes")
  }
  return normalizeArtifact({
    name: input.name ?? filename,
    path: [".opencode", QUEST_ASSETS_DIRNAME, questID, filename].join("/"),
    label,
    revision: input.revision ?? labelRevision(label, undefined),
    at,
    verified: input.verified === true,
  })
}
