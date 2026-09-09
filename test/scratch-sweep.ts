/** Isolated test state; cleanup is explicit and never scans shared TEMP. */
import { readdirSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

// Read the checkout under test, never the user's live configuration.
process.env.OPENCODE_CONFIG_DIR = resolve(import.meta.dir, "..")
process.env.OPENCODE_ACCESS_POLICY = join(process.env.OPENCODE_CONFIG_DIR, "models", "access-policy.json")

// Every test run gets its own orchestration ledger. Before this, the
// claude-code-task tool under test appended real rows to
// ~/.local/state/opencode/orchestration.jsonl and the watchdog replayed them.
process.env.OPENCODE_ORCHESTRATION_LEDGER ??= join(tmpdir(), `ledger-test-${process.pid}`, "orchestration.jsonl")
// Worktree tests must not inherit the user's live shared-checkout preference.
process.env.OPENCODE_QUEST_SETTINGS ??= join(tmpdir(), `ledger-test-${process.pid}`, "quest-settings.json")

const PREFIXES = [
  "quest-", "cc-state-", "papercut-", "artifact-gate-", "capacity-",
  "opencode-", "plugin-loader-", "usage-", "ledger-", "scope-",
]
/** Age threshold for explicit cleanup of a caller-owned scratch root. */
const GRACE_MS = 10 * 60 * 1000

export function sweepScratch(root: string, now = Date.now()): number {
  let removed = 0
  let entries: string[]
  try { entries = readdirSync(root) } catch { return 0 }
  for (const name of entries) {
    if (!PREFIXES.some((p) => name.startsWith(p))) continue
    const full = join(root, name)
    try {
      const info = statSync(full)
      if (!info.isDirectory() || now - info.mtimeMs < GRACE_MS) continue
      rmSync(full, { recursive: true, force: true })
      removed++
    } catch { /* in use, or vanished under us */ }
  }
  return removed
}

// Never sweep shared TEMP on startup: age does not prove another process ended.
// sweepScratch is used only with an explicit, task-owned fixture root.

/**
 * Point routing state at a scratch file for the whole run.
 *
 * blockLane writes real lane blocks, and its default target is the user's own
 * ~/.local/state/opencode/capacity.json. A test that exercised a failover was
 * therefore blocking a lane in live state and changing which model the user's
 * next session would pick — and leaking that state into later tests in the
 * same run, which is how one case's failover decided another case's fallback.
 *
 * Set here, in the preload, because CAPACITY_FILE is resolved at import time.
 */
if (!process.env.OPENCODE_CAPACITY_FILE) {
  process.env.OPENCODE_CAPACITY_FILE = join(tmpdir(), `capacity-test-${process.pid}.json`)
}

// Account API tests never discover real credentials or refresh the live usage cache.
process.env.OPENCODE_ACCOUNT_DISCOVERY_ROOT ??= join(tmpdir(), "usage-accounts-test-" + process.pid)
process.env.OPENCODE_ACCOUNT_USAGE_FILE ??= join(process.env.OPENCODE_ACCOUNT_DISCOVERY_ROOT, "account-usage.json")
process.env.OPENCODE_USAGE_CACHE_FILE ??= join(process.env.OPENCODE_ACCOUNT_DISCOVERY_ROOT, "usage-cache.json")

// Request telemetry must never read or mutate live conversation history in tests.
process.env.OPENCODE_TELEMETRY_FILE ??= join(process.env.OPENCODE_ACCOUNT_DISCOVERY_ROOT, "requests.jsonl")

// On-demand rollout harvesting must never inspect real Codex sessions in tests.
process.env.CODEX_HOME = join(process.env.OPENCODE_ACCOUNT_DISCOVERY_ROOT, "codex")

// Native host counter backfill must not inspect the real session database.
process.env.OPENCODE_DB = join(process.env.OPENCODE_ACCOUNT_DISCOVERY_ROOT, "host.db")
