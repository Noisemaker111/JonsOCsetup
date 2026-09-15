/**
 * Run the core suite, and make every test in it justify its seat.
 *
 * The suite was a hardcoded file list in package.json, so each change appended to it and nothing
 * ever removed: four files this morning, six by tonight. A cap would be arbitrary -- some months
 * genuinely need another invariant -- and a hardcoded list is what let it drift in the first place.
 *
 * So the bar is justification rather than a number. A test file joins the suite by declaring the
 * production defect it prevents and the real occurrence that proved the defect is possible. A file
 * that cannot name what broke does not belong in the suite that guards production, and a file that
 * names something generic is not naming anything.
 *
 * Discovery, not enumeration: the suite is whatever declares itself, so removing a test needs no
 * second edit and adding one is a claim the author has to write down.
 */
import { readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

// Runs under node, where import.meta.dir does not exist.
const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..")
const dir = join(root, "test")
const PREVENTS = /@core-prevents\s+(.+)/
const OBSERVED = /@core-observed\s+(.+)/
/** Words that describe testing rather than a defect; a claim built only from these says nothing. */
const EMPTY = /^(tests?|checks?|verifies|covers|ensures|validates|behaviour|behavior|correctness|regressions?|it works|todo|tbd|n\/?a)\b/i

const files = readdirSync(dir).filter(name => name.endsWith(".test.ts")).sort()
const included = [], rejected = [], undeclared = []
const claims = new Map()

for (const name of files) {
  const text = readFileSync(join(dir, name), "utf8")
  const prevents = PREVENTS.exec(text)?.[1]?.trim()
  const observed = OBSERVED.exec(text)?.[1]?.trim()
  if (!prevents && !observed) { undeclared.push(name); continue }
  const fail = reason => rejected.push({ name, reason })
  if (!prevents) fail("declares @core-observed without @core-prevents")
  else if (!observed) fail("declares @core-prevents without @core-observed")
  else if (prevents.length < 25) fail("@core-prevents is too short to name a defect")
  else if (EMPTY.test(prevents)) fail(`@core-prevents describes testing, not a defect: "${prevents.slice(0, 60)}"`)
  else if (observed.length < 20) fail("@core-observed does not record what actually happened")
  else if (claims.has(prevents)) fail(`@core-prevents duplicates ${claims.get(prevents)}`)
  else { claims.set(prevents, name); included.push({ name, prevents, observed }) }
}

for (const entry of included) console.error(`  core   ${entry.name}\n         prevents ${entry.prevents}`)
for (const name of undeclared) console.error(`  skipped ${name} — no @core-prevents/@core-observed, so it is not part of the core suite`)
for (const entry of rejected) console.error(`  REJECT  ${entry.name} — ${entry.reason}`)
console.error(`\n${included.length} core tests, ${undeclared.length} outside the suite, ${rejected.length} rejected\n`)

if (rejected.length) {
  console.error("A core test names the production defect it prevents and the occurrence that proved it real.")
  process.exit(1)
}
if (!included.length) { console.error("No core tests declared; the suite cannot be empty."); process.exit(1) }

// Bun defaults to a 5s per-test timeout. Several core invariants shell out to git, which on a
// checkout carrying dozens of worktrees takes longer than that here while passing in CI — a red
// local run that says nothing about the code. Generous but bounded, and overridable.
const timeout = process.env.OPENCODE_CORE_TIMEOUT ?? "90000"
const run = spawnSync("bun", ["test", "--timeout", timeout, ...included.map(e => join("test", e.name))], { cwd: root, stdio: "inherit", windowsHide: true })
process.exit(run.status ?? 1)
