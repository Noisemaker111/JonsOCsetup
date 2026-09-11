/**
 * Catch the ways a file quietly stops being version controlled.
 *
 * Two real occurrences on 2026-09-11 motivated this. An ignore rule written as `.claude/` matched at
 * any depth, not just the root, and was silently swallowing `setup/files/.claude/CLAUDE.md` — a
 * hand-written file the setup manifest installs. Nothing failed; the file simply would not have been
 * there. And `cliproxyapi/search-shim.ts`, the source of the Alt+Space search bar, had never been
 * tracked in any branch: the repo carried a committed patch against it that could not apply, because
 * the file it patched did not exist here.
 *
 * A third showed up the moment this check first ran: those same shim files were tracked and, at the
 * same time, still listed in `.git/info/exclude` from before they were tracked. That file is
 * local-only, so the contradiction was invisible to CI — which is precisely how this class of drift
 * survives a green pipeline.
 *
 * None of this is a test of behaviour, so none of it belongs in the core suite. These are properties
 * of the repository, and a property nobody checks is a property that drifts.
 */
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..")
const git = (...argv) => {
  const run = spawnSync("git", ["-C", root, ...argv], { encoding: "utf8", windowsHide: true, timeout: 120000 })
  if (run.status !== 0) throw new Error(`git ${argv.join(" ")} failed: ${run.stderr?.trim() || run.error?.message || "unknown"}`)
  return run.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
}

const failures = []
const list = paths => paths.map(path => "      " + path).join("\n")

// A tracked file that also matches an ignore rule is contradictory state. Either the rule is too
// broad and the next sibling silently disappears, or the rule outlived the decision to track.
const swallowed = git("ls-files", "-i", "-c", "--exclude-standard")
if (swallowed.length) failures.push(
  `${swallowed.length} tracked file(s) are also matched by an ignore rule:\n${list(swallowed)}\n` +
  "    Either the rule is too broad, and a sibling added beside them vanishes silently, or the rule\n" +
  "    is stale because the file has since been tracked. Check .gitignore and .git/info/exclude —\n" +
  "    the latter is local-only, which is how this state survives a green CI.")

// Credentials must never become tracked. The store lives in the data directory by design; a copy
// landing here would be published to the public mirror on the next release.
const SECRET = /(^|\/)(auth\.json|credentials?\.json|\.env(\..+)?|.*\.(pem|key|pfx|p12)|.*token.*\.json)$/i
const secrets = git("ls-files").filter(path => SECRET.test(path))
if (secrets.length) failures.push(`credential-shaped file(s) are tracked and would reach the public mirror:\n${list(secrets)}`)

// A committed patch naming only paths the repo does not contain can never apply. That is how the
// search-shim fix sat unappliable for days while its source stayed untracked.
const tracked = new Set(git("ls-files"))
for (const patch of git("ls-files", "*.patch", "*.diff")) {
  const show = spawnSync("git", ["-C", root, "show", `HEAD:${patch}`], { encoding: "utf8", windowsHide: true, timeout: 60000 })
  if (show.status !== 0) continue
  const targets = [...show.stdout.matchAll(/^\+\+\+ b\/(.+)$/gm)].map(match => match[1].trim()).filter(name => name && name !== "/dev/null")
  const missing = targets.filter(name => !tracked.has(name))
  if (targets.length && missing.length === targets.length) failures.push(
    `${patch} patches only paths this repository does not track, so it can never apply:\n${list(missing)}\n` +
    "    Track the source it fixes, or delete the patch.")
}

if (failures.length) {
  console.error("repo hygiene\n")
  for (const failure of failures) console.error("  FAIL  " + failure + "\n")
  process.exit(1)
}
console.error(`repo hygiene: ${tracked.size} tracked files, no silently ignored source, no tracked credentials, no unappliable patches`)
