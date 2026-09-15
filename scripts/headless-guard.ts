import { existsSync, readdirSync, readFileSync, lstatSync } from "node:fs"
import { dirname, join, relative, resolve, isAbsolute } from "node:path"
import { hiddenExecFileSync } from "./windows-process"

const root = join(import.meta.dir, "..")
const allow = new Set([
  "scripts/windows-process.ts",
  "scripts/headless-guard.ts",
  // The probe injects spawn into superviseForeground, which supplies windowsHide.
  "scripts/production-reliability-probe.ts",
  // The explicit service control uses detached Win32_Process.Create, not a shell window.
  "scripts/restart-opencode.ps1",
  // Archived shell-forensics analyzers match command strings; neither starts processes.
  "setup/files/.agents/skills-disabled/2026-09-07-trim/claude/shell-forensics/scripts/analyze.py",
  "setup/files/.agents/skills-disabled/2026-09-07-trim/claude/shell-forensics/scripts/extract.py",
])
const extensions = /\.(?:ts|tsx|js|ps1|py|bat|cmd)$/i
const unsafe = [
  /(?<!\.)\b(?:spawn|spawnSync|exec|execFile|execFileSync)\s*\(/,
  /\bBun\.spawn(?:Sync)?\s*\(/,
  /\bsubprocess\.(?:run|Popen|call|check_output)\s*\(/,
  /\bStart-Process\b/i,
  /\bcmd(?:\.exe)?\s+\/c\b/i,
]
/** Root-relative ownership boundaries, never a blanket hidden-directory exclusion. */
export function repositoryBoundaries(root: string): Set<string> {
  const boundaries = new Set([".worktrees", ".claude/worktrees", ".visual-e2e", "tmp", "run", "logs", ".cache"])
  try {
    const out = String(hiddenExecFileSync("git", ["-C", root, "worktree", "list", "--porcelain", "-z"], { stdio: ["ignore", "pipe", "pipe"], timeout: 2000 }))
    for (const field of out.split("\0")) {
      if (!field.startsWith("worktree ")) continue
      const rel = relative(resolve(root), resolve(field.slice(9))).replaceAll("\\", "/")
      if (rel && rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel)) boundaries.add(rel)
    }
  } catch (error) {
    // A .git file also counts: linked worktrees must fail closed on inventory
    // errors. Check ancestors by name only; never scan outside this repository.
    for (let dir = resolve(root);; dir = dirname(dir)) {
      if (existsSync(join(dir, ".git"))) throw new Error(`Cannot inventory repository worktree boundaries: ${String(error)}`)
      if (dirname(dir) === dir) break
    }
    // Only genuinely non-Git directories can rely on explicit boundaries alone.
  }
  // Host skill junctions are external references, not deployable source. Only
  // exclude links in these namespaces; ordinary local skills remain checked.
  for (const namespace of [".claude/skills", ".agents/skills"]) {
    const path = join(root, namespace)
    if (!existsSync(path)) continue
    const info = lstatSync(path)
    if (info.isSymbolicLink()) { boundaries.add(namespace); continue }
    if (!info.isDirectory()) continue
    for (const name of readdirSync(path)) {
      if (lstatSync(join(path, name)).isSymbolicLink()) boundaries.add(`${namespace}/${name}`)
    }
  }
  return boundaries
}

export function checkHeadless(root: string): string[] {
  const failures: string[] = [], boundaries = repositoryBoundaries(root)
  function walk(dir: string) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name), rel = relative(root, p).replaceAll("\\", "/")
      if (boundaries.has(rel) || ["node_modules", ".git", ".candidates", ".opencode", "generations"].includes(name)) continue
      const info = lstatSync(p)
      if (info.isSymbolicLink()) { failures.push(`${rel}: source link is not traversed`); continue }
      if (info.isDirectory()) { walk(p); continue }
      if (!extensions.test(name) || allow.has(rel) || /start_opencode\.bat$/i.test(rel)) continue
      const text = readFileSync(p, "utf8")
      for (const rule of unsafe) if (rule.test(text) && !/windowsHide\s*:\s*true|CreateNoWindow\s*=\s*\$true|hiddenExecFile|HEADLESS_EXEC/.test(text)) failures.push(`${rel}: unsafe process API ${rule}`)
    }
  }
  walk(root)
  return failures
}
if (import.meta.main) {
  const failures = checkHeadless(root)
  if (failures.length) { console.error(failures.join("\n")); process.exit(1) }
  console.log("PASS: background process callsites satisfy headless policy")
}
