import { expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
import { QuestWorkspaces } from "../quest/workspaces"

test("parallel worker files stay isolated, diffs remain attributed, cleanup preserves work", () => {
  const scratch = mkdtempSync(join(tmpdir(), "quest-workspaces-")), main = join(scratch, "main")
  mkdirSync(main)
  const git = (cwd: string, ...args: string[]) => {
    const result = spawnSync("git", ["-C", cwd, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", ...args], { encoding: "utf8", windowsHide: true })
    if (result.status !== 0) throw new Error(result.stderr)
    return result.stdout.trim()
  }
  try {
    git(main, "init")
    writeFileSync(join(main, "same.txt"), "base\n")
    git(main, "add", "same.txt"); git(main, "commit", "-m", "base")
    const manager = new QuestWorkspaces(join(scratch, "runtime"))
    const a = manager.create({ runID: "worker-a", questID: "quest", directory: main })
    const b = manager.create({ runID: "worker-b", questID: "quest", directory: a.path })
    expect(b.path.startsWith(a.path)).toBe(false)
    writeFileSync(join(a.path, "same.txt"), "worker a\n")
    writeFileSync(join(b.path, "same.txt"), "worker b\n")
    writeFileSync(join(a.path, "new.txt"), "new\n")
    expect(readFileSync(join(main, "same.txt"), "utf8")).toBe("base\n")
    expect(manager.collect(a.runID).changes?.files).toContainEqual({ path: "same.txt", additions: 1, deletions: 1, untracked: false })
    expect(manager.collect(a.runID).changes?.files).toContainEqual({ path: "new.txt", additions: 1, deletions: 0, untracked: true })
    expect(manager.collect(b.runID).changes?.files).toHaveLength(1)
    expect(manager.cleanup(a.runID)).toMatchObject({ removed: false, reason: "Uncommitted work is preserved" })
    const indexBefore = git(a.path, "diff", "--cached", "--binary")
    const continued = manager.create({ runID: "continued", questID: "quest", directory: main, inheritRunIDs: [a.runID] })
    expect(readFileSync(join(continued.path, "same.txt"), "utf8")).toBe("worker a\n")
    expect(readFileSync(join(continued.path, "new.txt"), "utf8")).toBe("new\n")
    expect(git(a.path, "diff", "--cached", "--binary")).toBe(indexBefore)
    expect(git(a.path, "ls-files", "--others", "--exclude-standard")).toBe("new.txt")
    writeFileSync(join(continued.path, "same.txt"), "continued work\n")
    const next = manager.create({ runID: "next", questID: "quest", directory: main, inheritRunIDs: [a.runID, continued.runID] })
    expect(readFileSync(join(next.path, "same.txt"), "utf8")).toBe("continued work\n")
    expect(next.inheritedRunIDs).toContain(a.runID)
    expect(() => manager.create({ runID: "conflict", questID: "quest", directory: main, inheritRunIDs: [a.runID, b.runID] })).toThrow("conflict")
    expect(existsSync(manager.get("conflict")!.path)).toBe(true)
    expect(readFileSync(join(a.path, "same.txt"), "utf8")).toBe("worker a\n")
    expect(readFileSync(join(b.path, "same.txt"), "utf8")).toBe("worker b\n")
    expect(() => manager.create({ runID: "wrong-owner", questID: "other", directory: main, inheritRunIDs: [a.runID] })).toThrow("ownership")
    git(a.path, "add", "."); git(a.path, "commit", "-m", "worker a")
    expect(manager.collect(a.runID).changes?.commits).toHaveLength(1)
    expect(manager.cleanup(a.runID)).toMatchObject({ removed: false, reason: "Unintegrated commits are preserved" })
    git(main, "merge", "--ff-only", a.branch)
    expect(manager.cleanup(a.runID).removed).toBe(true)
    expect(existsSync(a.path)).toBe(false)
    expect(manager.get(a.runID)?.integration).toMatchObject({workerHead:git(main,"rev-parse","HEAD"),projectHead:git(main,"rev-parse","HEAD"),method:"ancestor"})
    const retained = manager.collect(a.runID).changes!
    expect(retained.available).toBe(false)
    expect(retained.commits).toHaveLength(1)
    expect(retained.files).toHaveLength(2)
    const afterCleanup=manager.create({runID:"after-cleanup",questID:"quest",directory:main,inheritRunIDs:[a.runID]})
    expect(readFileSync(join(afterCleanup.path,"same.txt"),"utf8")).toBe("worker a\n")
    expect(manager.collect(afterCleanup.runID).changes?.files).toEqual([])
    git(main,"checkout","--detach",a.base)
    expect(()=>manager.create({runID:"missing-integration",questID:"quest",directory:main,inheritRunIDs:[a.runID]})).toThrow("does not retain")
    expect(existsSync(b.path)).toBe(true)
    expect(() => manager.create({ runID: "../escape", questID: "quest", directory: main })).toThrow("Invalid run identity")
  } finally { rmSync(scratch, { recursive: true, force: true }) }
}, 60000)

test("initial dirty checkout state is copied without being attributed as worker edits",()=>{
 const root=mkdtempSync(join(tmpdir(),"quest-dirty-")),main=join(root,"main");mkdirSync(main);const git=(args:string[])=>{const p=spawnSync("git",["-C",main,"-c","user.name=Fixture","-c","user.email=fixture@example.invalid",...args],{encoding:"utf8",windowsHide:true});if(p.status!==0)throw Error(p.stderr);return p.stdout}
 try{git(["init"]);writeFileSync(join(main,"file.txt"),"base");git(["add","."]);git(["commit","-m","base"]);writeFileSync(join(main,"file.txt"),"user changes");writeFileSync(join(main,"untracked.txt"),"user draft");const before=git(["diff","--cached"]),manager=new QuestWorkspaces(join(root,"runtime")),a=manager.create({runID:"first",questID:"q",directory:main});expect(readFileSync(join(a.path,"file.txt"),"utf8")).toBe("user changes");expect(readFileSync(join(a.path,"untracked.txt"),"utf8")).toBe("user draft");expect(manager.collect(a.runID).changes?.files).toEqual([]);writeFileSync(join(a.path,"file.txt"),"worker result");const b=manager.create({runID:"second",questID:"q",directory:main,inheritRunIDs:[a.runID]});expect(readFileSync(join(b.path,"file.txt"),"utf8")).toBe("worker result");expect(readFileSync(join(main,"file.txt"),"utf8")).toBe("user changes");expect(git(["diff","--cached"])).toBe(before);expect(manager.collect(b.runID).changes?.files.map(f=>f.path)).toEqual(["file.txt"]);expect(existsSync(join(b.path,".claude","worktrees"))).toBe(false)
 }finally{rmSync(root,{recursive:true,force:true})}
},60000)

test("snapshots work when the entire worker parent is ignored, preserving user indexes",()=>{
 const scratch=mkdtempSync(join(tmpdir(),"quest-ignored-parent-")),main=join(scratch,"main");mkdirSync(main)
 const git=(...args:string[])=>{const r=spawnSync("git",["-C",main,"-c","user.name=Test","-c","user.email=test@example.invalid",...args],{encoding:"utf8",windowsHide:true});if(r.status!==0)throw new Error(r.stderr);return r.stdout}
 try{git("init");writeFileSync(join(main,".gitignore"),".claude/\n");writeFileSync(join(main,"code.txt"),"before");git("add",".");git("commit","-m","base");writeFileSync(join(main,"code.txt"),"user edit");writeFileSync(join(main,"new.txt"),"user file");const index=git("diff","--cached","--binary"),manager=new QuestWorkspaces(join(scratch,"runtime")),worker=manager.create({runID:"ignored-parent",questID:"q",directory:main});expect(readFileSync(join(worker.path,"code.txt"),"utf8")).toBe("user edit");expect(readFileSync(join(worker.path,"new.txt"),"utf8")).toBe("user file");expect(git("diff","--cached","--binary")).toBe(index);expect(manager.collect(worker.runID).changes?.files).toHaveLength(0)}finally{rmSync(scratch,{recursive:true,force:true})}
},60000)
