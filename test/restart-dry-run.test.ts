import { expect, test } from "bun:test"
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { hiddenExecFileSync } from "../scripts/windows-process"
import { readSourceCommit, stageCandidate } from "../scripts/plugin-deploy"

const repo = join(import.meta.dir, "..")
test("Restart retains selected release despite dirty or newer source", () => {
  const root = mkdtempSync(join(repo, ".candidates", "restart-test-"))
  const git = (...args: string[]) => String(hiddenExecFileSync("git", ["-C", root, ...args], { stdio: ["ignore", "pipe", "pipe"] })).trim()
  try {
    mkdirSync(join(root, "scripts"))
    mkdirSync(join(root, "project-router"))
    copyFileSync(join(repo, "project-router/executable.mjs"), join(root, "project-router/executable.mjs"))
    copyFileSync(join(repo, "scripts/restart-opencode.ps1"), join(root, "scripts/restart-opencode.ps1"))
    writeFileSync(join(root, ".gitignore"), "generations/\n.candidates/\nrun/\n")
    git("init"); git("add", ".gitignore", "scripts/restart-opencode.ps1", "project-router/executable.mjs"); git("commit", "-m", "fixture initial")
    const candidate = stageCandidate(root, "fixture")
    const deployed = readSourceCommit(candidate)
    expect(deployed).toBe(git("rev-parse", "HEAD"))
    mkdirSync(join(root, "generations/gen-test"), { recursive: true })
    copyFileSync(join(candidate, ".deployment-source.json"), join(root, "generations/gen-test/.deployment-source.json"))
    writeFileSync(join(root, "plugin-activation.json"), JSON.stringify({ activeGeneration: "gen-test" }))
    git("add", "plugin-activation.json"); git("commit", "-m", "record pointer without source changes")
    const dryRun = (...args: string[]) => JSON.parse(String(hiddenExecFileSync("pwsh", ["-NoProfile", "-File", join(root, "scripts/restart-opencode.ps1"), "-DryRun", "-SessionID", "ses_restart_fixture", ...args], { cwd: root, timeout: 20000 })))
    expect(dryRun()).toMatchObject({ wouldDeploy: false, relaunchArgs: ["--session", "ses_restart_fixture"] })
    writeFileSync(join(root, "plugin-activation.json"), JSON.stringify({ activeGeneration: "gen-test", updated: "after deploy" }))
    expect(dryRun().wouldDeploy).toBe(false)
    git("add", "plugin-activation.json"); git("commit", "-m", "record updated pointer")
    mkdirSync(join(root,".claude/worktrees/worker"),{recursive:true})
    writeFileSync(join(root,".claude/worktrees/worker/private.txt"),"owned worker state")
    expect(dryRun().wouldDeploy).toBe(false)
    writeFileSync(join(root, "worker.ts"), "export const changed = true\n")
    expect(dryRun().wouldDeploy).toBe(false)
    git("add", "worker.ts"); git("commit", "-m", "committed after staging")
    expect(git("status", "--porcelain", "--", ".", ":!.claude/worktrees")).toBe("")
    expect(dryRun()).toMatchObject({ wouldDeploy: false, reason: "-NoDeploy" })
    expect(dryRun("-NoDeploy").wouldDeploy).toBe(false)
    writeFileSync(join(root, "generations/gen-test/.deployment-source.json"), "{}")
    expect(dryRun().wouldDeploy).toBe(false)
  } finally {
    // Fixed fixture prefix, resolved inside this repository's staging directory.
    rmSync(root, { recursive: true, force: true })
  }
}, 60000)
import {existsSync,readFileSync} from 'node:fs'
test('generation staging keeps compatibility skills but excludes owned worktrees',()=>{const root=mkdtempSync(join(repo,'.candidates','stage-worktree-test-'));try{mkdirSync(join(root,'.claude/worktrees/worker'),{recursive:true});mkdirSync(join(root,'.claude/skills/keep'),{recursive:true});writeFileSync(join(root,'.claude/worktrees/worker/private.txt'),'worker state');writeFileSync(join(root,'.claude/skills/keep/SKILL.md'),'keep skill');const candidate=stageCandidate(root,'fixture');expect(existsSync(join(candidate,'.claude/worktrees'))).toBe(false);expect(readFileSync(join(candidate,'.claude/skills/keep/SKILL.md'),'utf8')).toBe('keep skill')}finally{rmSync(root,{recursive:true,force:true})}})
