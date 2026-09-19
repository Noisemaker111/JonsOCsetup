/**
 * The fast contract for Quest Web and the OpenCode2 server beneath it.
 *
 * Full product verification happens through quest.jonsoc.com. These tests retain only invariants
 * whose failure could corrupt a Quest, cross an authority boundary, expose data, or make the hosted
 * product unable to reach its server. Historical CLI, TUI, reporting, and implementation-shape
 * checks do not join this command.
 */
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const groups = {
  hostedContract: [
    "quest-api-contract.test.ts",
    "quest-api-discovery-registry.test.ts",
    "quest-update-returns-saved-quest.test.ts",
    "quest-archive-any-contract-version.test.ts",
    "quest-project-repoint.test.ts",
    "quest-gone-project-folder.test.ts",
  ],
  persistenceAndState: [
    "quest-lock-publication.test.ts",
    "quest-surface-reachability.test.ts",
    "quest-worker-verification.test.ts",
    "server-plugin-lifecycle.test.ts",
  ],
  securityAndAuthority: [
    "quest-artifact-preview.test.ts",
    "recovery-loader.test.ts",
    "quest-permission-length-not-authority.test.ts",
    "model-selection-policy.test.ts",
    "exhausted-window-refusal.test.ts",
  ],
  usage: ["account-refresh-owner.test.ts"],
}

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..")
const files = Object.values(groups).flat().map(name => `test/${name}`)
const timeout = process.env.OPENCODE_CORE_TIMEOUT ?? "90000"
const run = spawnSync("bun", ["test", "--timeout", timeout, ...files], {
  cwd: root,
  encoding: "utf8",
  windowsHide: true,
})
const output = `${run.stdout ?? ""}${run.stderr ?? ""}`

if ((run.status ?? 1) !== 0) {
  process.stderr.write(output)
  process.exit(run.status ?? 1)
}

const summary = output.split(/\r?\n/).filter(line =>
  /^\s*\d+ (?:pass|fail|expect\(\) calls)|^Ran \d+ tests?/.test(line)
)
console.log(`Quest Web/OpenCode2 core: ${files.length} files`)
console.log(summary.join("\n"))
