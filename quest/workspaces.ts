import {workspaceBootstrap} from "./workspace-bootstrap"
import {coordination} from "./coordination"
import type {QuestStore} from "./store"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync, unlinkSync, readdirSync, lstatSync, readlinkSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { projectIdentity, sourceCheckout, physicalDirectory, type ProjectIdentity } from "./project"
import { acquireLock } from "./locking"

export type Changes = { available: boolean; files: { path: string; additions: number | null; deletions: number | null; untracked: boolean }[]; commits: string[]; at: string; error?: string }
export type Workspace = { source?:string; version: 1; runID: string; questID: string; projectID: string; root: string; path: string; branch: string; base: string; comparisonTree?:string; changes?: Changes; removed?: boolean; mode?: "shared" | "worktree" | "research"; fileScopes?: string[]; sharedReleased?: boolean; allocationVersion?: 2; physicalRunID?: string; claimedRunID?: string; preparedHead?: string; preparedStamp?: string; preparedBootstrap?: string; preparationMs?: number; bootstrapComplete?: boolean; inheritedRunIDs?: string[]; integration?:{workerHead:string;projectHead:string;verifiedAt:string;method:"ancestor"} }
const inside = (root: string, path: string) => { const rel = relative(root, path); return !!rel && !rel.startsWith("..") && !isAbsolute(rel) }
function git(cwd: string, args: string[]): string {
  const out = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 })
  if (out.status !== 0) throw new Error("Git " + args[0] + " failed: " + (out.stderr || out.error?.message || "unknown error").trim())
  return out.stdout
}
function worktreeExclusions(root:string) {
  return git(root,["worktree","list","--porcelain","-z"]).split("\0")
    .filter(field=>field.startsWith("worktree ")).map(field=>field.slice(9))
    .filter(path=>inside(resolve(root),resolve(path)))
    .map(path=>":(exclude,literal)"+relative(root,path).replaceAll("\\","/")).sort()
}
export class QuestWorkspaces {
  constructor(readonly runtime: string) {}
  private file(runID: string) {
    if (!/^[a-z0-9-]{1,80}$/.test(runID)) throw new Error("Invalid run identity")
    return join(this.runtime, "workspaces", runID + ".json")
  }
  private save(value: Workspace) {
    const file = this.file(value.runID); mkdirSync(dirname(file), { recursive: true })
    const tmp = file + "." + process.pid + ".tmp"
    writeFileSync(tmp, JSON.stringify(value, null, 2)); renameSync(tmp, file)
  }
  get(runID: string): Workspace | undefined {
    const file = this.file(runID)
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined
  }
  createResearch(input:{runID:string;questID:string;directory:string;project:ProjectIdentity}):Workspace {
    this.file(input.runID)
    const source=physicalDirectory(input.directory),project=projectIdentity(source)
    if(project.id!==input.project.id)throw new Error("Research directory belongs to another project")
    const lock=acquireLock(this.runtime,"workspace-"+input.runID,{timeoutMs:0})
    try{
      const prior=this.get(input.runID)
      if(prior){if(prior.mode!=="research"||prior.questID!==input.questID||prior.path!==source)throw new Error("Research workspace identity conflicts");this.verify(prior);return prior}
      const value:Workspace={version:1,runID:input.runID,questID:input.questID,projectID:project.id,root:project.root,source,path:source,branch:"",base:"",mode:"research",bootstrapComplete:true}
      this.save(value);return value
    }finally{lock.release()}
  }
  create(input: { runID: string; questID: string; directory: string; project?:ProjectIdentity; bootstrap?: string[]; inheritRunIDs?: string[]; skipPrepared?: boolean }): Workspace {
    this.file(input.runID)
    const lock = acquireLock(this.runtime, "workspace-" + input.runID, {timeoutMs:0})
    try {
      const {project,source} = sourceCheckout(input.directory,input.project)
      input={...input,bootstrap:workspaceBootstrap(source,input.bootstrap)}
      const prior = this.get(input.runID)
      if (prior) {
        if (prior.projectID !== project.id || prior.questID !== input.questID || prior.removed || physicalDirectory(prior.source??prior.root)!==source) throw new Error("Run workspace identity conflicts with existing ownership")
        this.verify(prior); if (!prior.bootstrapComplete) throw new Error("Workspace bootstrap is incomplete; repair it before resuming edits"); return prior
      }
      const ready = source===physicalDirectory(project.root) && !input.skipPrepared && !input.inheritRunIDs?.length ? this.takePrepared(input, project) : undefined
      if (ready) return ready
      const root = project.root
      const base = git(source, ["rev-parse", "HEAD"]).trim()

      const parent = join(root, ".claude", "worktrees")
      mkdirSync(parent, { recursive: true })
      if (!inside(realpathSync(root), realpathSync(parent))) throw new Error("Worktree directory resolves outside the owning project")
      const path = join(parent, "quest-" + input.runID), branch = "quest/" + input.runID
      if (existsSync(path)) throw new Error("Workspace path exists without runtime ownership; preserving it")
      git(root, ["worktree", "add", "-b", branch, path, base])
      const value: Workspace = { version: 1, allocationVersion: 2, runID: input.runID, questID: input.questID, projectID: project.id, root, path, branch, base, bootstrapComplete: false, preparedBootstrap: input.skipPrepared ? JSON.stringify(input.bootstrap??[]) : undefined }
      value.source=source
      this.save(value)
      if(git(source,["ls-files","--unmerged"]).trim())throw new Error("Resolve selected checkout conflicts before creating an editing worker; workspace retained")
      value.comparisonTree=this.applySnapshot(source,base,path)
      this.save(value)
      const sources = (input.inheritRunIDs ?? []).map(runID => {
        const source = this.get(runID)
        if (!source || source.questID !== input.questID || source.projectID !== project.id) throw new Error("Dependency workspace is unavailable or has different ownership: " + runID)
        if(source.removed){
          if(!source.integration)throw new Error("Removed dependency has no verified integration: "+runID)
          const retained=spawnSync("git",["-C",root,"merge-base","--is-ancestor",source.integration.workerHead,base],{windowsHide:true})
          if(retained.status!==0)throw new Error("Current project does not retain the removed dependency commit: "+runID)
          return source
        }
        this.verify(source)
        if(source.mode==="research")return source
        if (git(source.path, ["ls-files", "--unmerged"]).trim()) throw new Error("Resolve dependency conflicts before starting another worker: " + runID)
        return source
      })
      // Sources already included in a later dependency need not be applied twice.
      const independent = sources.filter(source => !sources.some(other => other.runID !== source.runID && other.inheritedRunIDs?.includes(source.runID)))
      for (const source of independent.filter(source=>!source.removed&&source.mode!=="shared"&&source.mode!=="research")) this.applySnapshot(source.path, source.comparisonTree??source.base, path)
      value.inheritedRunIDs = [...new Set(sources.flatMap(source => [source.runID, ...(source.inheritedRunIDs ?? [])]))]
      this.save(value)
      input={...input,bootstrap:workspaceBootstrap(path,input.bootstrap)}
      if (input.bootstrap?.length) {
        const result = spawnSync(input.bootstrap[0], input.bootstrap.slice(1), { timeout: 120000, cwd: path, encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 })
        if (result.status !== 0) throw new Error("Workspace bootstrap failed; workspace retained: " + (result.stderr || result.error?.message || "unknown failure"))
      }
      value.bootstrapComplete = true; this.save(value)
      this.verify(value); return value
    } finally { lock.release() }
  }


  createShared(input:{runID:string;questID:string;directory:string;project?:ProjectIdentity;files?:string[];inheritRunIDs?:string[];store:QuestStore}):Workspace {
    if(process.env.OPENCODE_RELEASE_CHANNEL === "dev")throw new Error("Dev sessions use an isolated ledger and must use isolated worktrees; shared checkout writes could bypass stable ownership")
    const lock=acquireLock(this.runtime,"workspace-"+input.runID,{timeoutMs:0})
    try {
      const {project,source}=sourceCheckout(input.directory,input.project),prior=this.get(input.runID)
      if(prior){if(prior.mode!=="shared"||prior.questID!==input.questID||prior.projectID!==project.id||prior.sharedReleased||physicalDirectory(prior.source??prior.root)!==source)throw new Error("Existing workspace assignment must be reconciled");this.verify(prior);return prior}
      for(const runID of input.inheritRunIDs??[]){
        const source=this.get(runID);if(!source||source.projectID!==project.id||source.questID!==input.questID)throw new Error("Dependency workspace ownership is unavailable")
        if(source.mode==="research")continue
        if(source.mode==="shared"){if(physicalDirectory(source.path)!==physicalDirectory(input.directory))throw new Error("Shared dependency belongs to another checkout; integrate it first");continue}
        if(source.removed){if(!source.integration)throw new Error("Dependency integration is unverified");const retained=spawnSync("git",["-C",input.directory,"merge-base","--is-ancestor",source.integration.workerHead,"HEAD"],{windowsHide:true});if(retained.status!==0)throw new Error("Shared checkout does not contain the dependency commit");continue}
        this.verify(source)
        if(git(source.path,["status","--porcelain","--untracked-files=all"]).trim())throw new Error("Integrate isolated dependency changes before running shared")
        const retained=spawnSync("git",["-C",input.directory,"merge-base","--is-ancestor",git(source.path,["rev-parse","HEAD"]).trim(),"HEAD"],{windowsHide:true})
        if(retained.status!==0)throw new Error("Integrate isolated dependency commits before running shared")
      }
      const join=coordination(input.store,{directory:source,sessionID:"quest-run:"+input.runID,host:"opencode"})({action:"join",title:"Quest "+input.questID,questID:input.questID,scopes:input.files??["."],activity:"Shared worker assignment"})
      if(!join.acquired)throw new Error("Shared workspace file conflict; inspect quest_workspace reservations before retrying: "+JSON.stringify((join as any).conflicts.map((x:any)=>({title:x.title,scopes:x.scopes}))))
      try {
        const fileScopes=join.participants.find(x=>x.id===join.participantID)!.scopes
        const base=git(source,["rev-parse","HEAD"]).trim(),branch=git(source,["symbolic-ref","--short","HEAD"]).trim()
        const value:Workspace={version:1,mode:"shared",runID:input.runID,questID:input.questID,projectID:project.id,root:project.root,source,path:source,base,branch,fileScopes,bootstrapComplete:true,comparisonTree:this.applySnapshot(source,base,undefined,fileScopes)}
        this.save(value);return value
      }catch(error){coordination(input.store,{directory:source,sessionID:"quest-run:"+input.runID,host:"opencode"})({action:"release",activity:"Known prelaunch failure"});throw error}
    }finally{lock.release()}
  }
  releaseShared(runID:string,store:QuestStore,reason:string) {
    const value=this.get(runID);if(value?.mode!=="shared"||value.sharedReleased)return
    this.collect(runID)
    coordination(store,{directory:value.path,sessionID:"quest-run:"+runID,host:"opencode"})({action:"release",activity:reason})
    value.changes=this.get(runID)?.changes;value.sharedReleased=true;this.save(value)
  }

  private sourceStamp(root:string) {
    const hash=createHash("sha256").update(git(root,["rev-parse","HEAD"]))
    const scopes=[".",":(exclude,glob)**/.claude/worktrees/**",...worktreeExclusions(root)]
    hash.update(git(root,["diff","--binary","HEAD","--",...scopes]))
    for(const name of git(root,["ls-files","--others","--exclude-standard","-z","--",...scopes]).split("\0").filter(Boolean)) {
      const path=join(root,name),link=lstatSync(path).isSymbolicLink();if(!link&&!inside(realpathSync(root),realpathSync(path)))throw new Error("Untracked source resolves outside project")
      const data=Buffer.from(link?readlinkSync(path):readFileSync(path));hash.update(name+"\0"+data.length+":");hash.update(data)
    }
    return hash.digest("hex")
  }
  private allocations(projectID:string) {
    const directory=join(this.runtime,"workspaces")
    return existsSync(directory)?readdirSync(directory).filter(x=>x.endsWith(".json")).map(x=>JSON.parse(readFileSync(join(directory,x),"utf8")) as Workspace).filter(x=>x.allocationVersion===2&&x.projectID===projectID&&!x.physicalRunID&&!x.removed&&(!x.claimedRunID||!this.get(x.claimedRunID)?.removed)).length:0
  }
  preparationStatus(projectID:string) {
    const file=join(this.runtime,"preparation-status-"+projectID+".json")
    const last=existsSync(file)?JSON.parse(readFileSync(file,"utf8")):undefined
    const pointer=this.readPool(projectID),value=pointer&&this.get(pointer.runID)
    return {last,spare:value&&!value.claimedRunID&&!value.removed?{base:value.preparedHead,bootstrapComplete:!!value.bootstrapComplete,freshness:"rechecked at assignment"}:null,retainedNewAllocations:this.allocations(projectID),spareLimit:1}
  }
  private poolFile(projectID:string) { return join(this.runtime,"prepared-"+projectID+".json") }
  private readPool(projectID:string): {runID:string} | undefined {
    const path=this.poolFile(projectID);return existsSync(path)?JSON.parse(readFileSync(path,"utf8")):undefined
  }
  private fresh(value:Workspace,root:string,bootstrap?:string[]) {
    if(physicalDirectory(value.source??value.root)!==physicalDirectory(root))return false
    this.verify(value)
    return value.bootstrapComplete && value.preparedHead===git(root,["rev-parse","HEAD"]).trim()
      && value.preparedBootstrap===JSON.stringify(bootstrap??[]) && value.preparedStamp===this.sourceStamp(root)
      && git(value.path,["rev-parse","HEAD"]).trim()===value.base && !git(value.path,["diff","--name-only",value.comparisonTree??value.base,"--"]).trim() && !git(value.path,["ls-files","--others","--exclude-standard"]).trim()
  }
  /** One unassigned spare. Dirty/unknown preparation is retained instead of overwritten. */
  prepare(input:{directory:string;bootstrap?:string[]}) {
    const {project,source}=sourceCheckout(input.directory)
    try{input={...input,bootstrap:workspaceBootstrap(source,input.bootstrap)}}catch(error){return {state:"unconfigured",reason:String(error)}}
    if(source!==physicalDirectory(project.root))return {state:"unsupported",reason:"Prepared reuse is disabled for selected linked checkouts; allocation snapshots that exact checkout on demand"}
    let lock;try{lock=acquireLock(this.runtime,"prepared-"+project.id,{timeoutMs:0})}catch{return {state:"busy"}}
    try {
      if(git(project.root,["ls-files","--unmerged"]).trim())return {state:"conflict",reason:"Resolve coordinator conflicts before preparing a snapshot"}
      if(existsSync(join(project.root,".gitmodules")))return {state:"unsupported",reason:"Submodules require explicit workspace bootstrap; prepared reuse is disabled"}
      const prior=this.readPool(project.id),old=prior&&this.get(prior.runID)
      if(prior&&!old)return {state:"unknown",reason:"Interrupted allocation retained; inspect before another preparation"}
      if(old&&!old.claimedRunID&&!old.removed){
        if(!old.bootstrapComplete&&old.base===git(project.root,["rev-parse","HEAD"]).trim()&&old.preparedBootstrap===JSON.stringify(input.bootstrap??[]))return {state:"failed",runID:old.runID,reason:"Previous bootstrap failed; repair its inputs before retrying"}
        if(this.fresh(old,project.root,input.bootstrap))return {state:"ready",runID:old.runID}
        this.verify(old)
        const unchanged=git(old.path,["rev-parse","HEAD"]).trim()===old.base && !git(old.path,["diff","--name-only",old.comparisonTree??old.base,"--"]).trim() && !git(old.path,["ls-files","--others","--exclude-standard"]).trim()
        if(!unchanged)return {state:"preserved",reason:"Unassigned spare was modified; preserving it for inspection"}
        // Exact unassigned snapshot only. verify checks the resolved path remains inside its owner.
        git(old.root,["worktree","remove","--force",old.path]);old.removed=true;this.save(old)
      }
      const stamp=this.sourceStamp(project.root),started=Date.now(),head=git(project.root,["rev-parse","HEAD"]).trim()
      const runID="warm-"+crypto.randomUUID().replaceAll("-","").slice(0,10)
      // Persist intention first: a crash cannot create a second unowned spare on retry.
      writeFileSync(this.poolFile(project.id),JSON.stringify({runID}))
      let value:Workspace
      try {value=this.create({...input,runID,questID:"__prepared__",skipPrepared:true})}
      catch(error){
        const path=join(project.root,".claude","worktrees","quest-"+runID)
        if(!this.get(runID)&&!existsSync(path))unlinkSync(this.poolFile(project.id))
        throw error
      }
      value.preparedStamp=stamp;value.preparedHead=head;value.preparedBootstrap=JSON.stringify(input.bootstrap??[]);value.preparationMs=Date.now()-started;this.save(value)
      if(!this.fresh(value,project.root,input.bootstrap))return {state:"stale",runID}
      return {state:"ready",runID,milliseconds:value.preparationMs}
    } finally {lock.release()}
  }
  private takePrepared(input:{runID:string;questID:string;bootstrap?:string[]},project:{id:string;root:string}):Workspace|undefined {
    let lock;try{lock=acquireLock(this.runtime,"prepared-"+project.id,{timeoutMs:0})}catch{return undefined}
    try {
      const pointer=this.readPool(project.id),value=pointer&&this.get(pointer.runID)
      if(!value||value.claimedRunID||value.removed)return undefined
      if(!this.fresh(value,project.root,input.bootstrap))return undefined
      // Mark the physical allocation consumed before writing the assignment. Interrupted claims stay retained.
      value.claimedRunID=input.runID;this.save(value)
      const assigned:Workspace={...value,runID:input.runID,questID:input.questID,physicalRunID:value.runID,claimedRunID:undefined}
      this.save(assigned);this.verify(assigned);return assigned
    }finally{lock.release()}
  }
  assertPreparedSource(value:Workspace) {
    const {source}=sourceCheckout(value.source??value.root,{id:value.projectID,root:value.root})
    if(value.physicalRunID && (git(source,["rev-parse","HEAD"]).trim()!==value.preparedHead||this.sourceStamp(source)!==value.preparedStamp))
      throw new Error("Project changed after prepared workspace assignment; worker was not prompted. Preserve workspace and retry with a fresh snapshot")
  }

  /** A temporary Git index captures tracked and untracked files without changing the source index or branch. */
  private applySnapshot(source: string, base: string, target?: string, scopes:string[]=["."]) {
    const index = join(this.runtime, "snapshot-" + process.pid + "-" + crypto.randomUUID() + ".index")
    const run = (args: string[], input?: string) => {
      const out = spawnSync("git", ["-C", source, ...args], { input, env: { ...process.env, GIT_INDEX_FILE: index, GIT_LITERAL_PATHSPECS: "1" }, encoding: "utf8", windowsHide: true, maxBuffer: 32 * 1024 * 1024 })
      if (out.status !== 0) throw new Error("Dependency snapshot failed: " + (out.stderr || out.error?.message))
      return out.stdout.trim()
    }
    const head=git(source,["rev-parse","HEAD"]).trim()
    const excluded=worktreeExclusions(source)
    // Include HEAD paths removed from the real index by staged deletions.
    const selectedFiles=()=>git(source,["ls-files","--cached","--with-tree="+head,"--others","--exclude-standard","-z","--",...scopes.map(scope=>":(literal)"+scope),":(exclude,glob)**/.claude/worktrees/**",...excluded])
    const paths=selectedFiles()
    try {
      run(["read-tree", head])
      if(paths)run(["add","-A","--pathspec-from-file=-","--pathspec-file-nul"],paths)
      const tree=run(["write-tree"])
      // Rebuild from the same baseline: the first add removed deleted entries,
      // so adding those literal paths again to that index would fail to match.
      run(["read-tree", head])
      if(paths)run(["add","-A","--pathspec-from-file=-","--pathspec-file-nul"],paths)
      const changed=selectedFiles()!==paths?"file list":run(["write-tree"])!==tree?"content":git(source,["rev-parse","HEAD"]).trim()!==head?"HEAD":JSON.stringify(worktreeExclusions(source))!==JSON.stringify(excluded)?"worktree registration":undefined
      if(changed)throw new Error("Source changed during workspace snapshot ("+changed+"); retry after edits settle")
      if(!target)return tree
      const diff = spawnSync("git", ["-C", source, "diff", "--binary", "--full-index", base, tree, "--"], { windowsHide: true, maxBuffer: 32 * 1024 * 1024 })
      if (diff.status !== 0) throw new Error("Could not read dependency snapshot")
      if (!diff.stdout.length) return tree
      const applied = spawnSync("git", ["-C", target, "apply", "--3way", "--index", "--whitespace=nowarn", "-"], { input: diff.stdout, encoding: "utf8", windowsHide: true, maxBuffer: 32 * 1024 * 1024 })
      if (applied.status !== 0) throw new Error("Dependency changes conflict; source and destination workspaces retained for recovery: " + applied.stderr.trim())
      return tree
    } finally { if (existsSync(index)) unlinkSync(index) }
  }
  verify(value: Workspace) {
    const owned = this.get(value.runID)
    if(value.mode==="research"){if(!owned||owned.mode!=="research"||owned.questID!==value.questID||owned.path!==value.path||physicalDirectory(value.path)!==physicalDirectory(value.source??value.root)||projectIdentity(value.path).id!==value.projectID)throw new Error("Research directory binding changed");return}
    if(value.mode==="shared"){if(!owned||owned.mode!=="shared"||owned.path!==value.path||owned.questID!==value.questID||physicalDirectory(value.path)!==physicalDirectory(value.source??value.root)||projectIdentity(value.path).id!==value.projectID||git(value.path,["symbolic-ref","--short","HEAD"]).trim()!==value.branch)throw new Error("Shared checkout ownership or branch changed");return}
    const expected = resolve(value.root, ".claude", "worktrees", "quest-" + (value.physicalRunID ?? value.runID))
    if (!owned || owned.path !== value.path || owned.questID !== value.questID || resolve(value.path) !== expected || !inside(realpathSync(value.root), realpathSync(value.path))) throw new Error("Workspace ownership or path mismatch")
    if (value.physicalRunID && this.get(value.physicalRunID)?.claimedRunID !== value.runID) throw new Error("Prepared workspace assignment mismatch")
    if (projectIdentity(value.path).id !== value.projectID) throw new Error("Worker workspace belongs to a different project")
    if (git(value.path, ["symbolic-ref", "--short", "HEAD"]).trim() !== value.branch) throw new Error("Worker branch changed; preserving workspace for inspection")
  }
  collect(runID: string): Workspace {
    const value = this.get(runID)
    if (!value) throw new Error("Unknown owned workspace")
    if(value.mode==="shared"&&value.sharedReleased)return value
    if(value.mode==="research"){this.verify(value);value.changes={available:true,files:[],commits:[],at:new Date().toISOString()};this.save(value);return value}
    const scopes=value.mode==="shared"?value.fileScopes??["."]:["."]
    const at = new Date().toISOString()
    if (!existsSync(value.path) || value.removed) {
      value.changes = { available: false, files: value.changes?.files ?? [], commits: value.changes?.commits ?? [], at, error: "Workspace unavailable; showing retained change records" }
      this.save(value); return value
    }
    this.verify(value)
    const files: Changes["files"] = git(value.path, ["diff", "--numstat", "--no-renames", "-z", value.comparisonTree??value.base, "--",...scopes]).split("\0").filter(Boolean).map(row => {
      const first = row.indexOf("\t"), second = row.indexOf("\t", first + 1)
      const a = row.slice(0, first), d = row.slice(first + 1, second)
      return { path: row.slice(second + 1), additions: a === "-" ? null : Number(a), deletions: d === "-" ? null : Number(d), untracked: false }
    })
    for (const name of git(value.path, ["ls-files", "--others", "--exclude-standard", "-z","--",...scopes]).split("\0").filter(Boolean)) {
      const path = join(value.path, name)
      let count: number | null = null
      // Do not follow an untracked symlink outside the owned workspace.
      try { if (inside(realpathSync(value.path), realpathSync(path))) {
        const data = readFileSync(path)
        if (!data.includes(0)) count = data.length ? data.toString("utf8").split("\n").length - (data.at(-1) === 10 ? 1 : 0) : 0
      }
      } catch { /* A broken or unreadable untracked link is retained with unknown size. */ }
      files.push({ path: name, additions: count, deletions: 0, untracked: true })
    }
    value.changes = { available: true, files, commits: value.mode==="shared"?[]:git(value.path, ["rev-list", value.base + "..HEAD"]).trim().split("\n").filter(Boolean), at }
    this.save(value); return value
  }
  cleanup(runID: string): { removed: boolean; reason: string } {
    this.file(runID)
    if(this.get(runID)?.mode==="shared")return {removed:false,reason:"Shared project checkout is never removed"}
    const lock = acquireLock(this.runtime, "workspace-" + runID)
    try {
      const value = this.collect(runID)
      if(value.mode==="research")return {removed:false,reason:"Research uses the original read-only directory; it is never removed"}
      if (value.removed) return { removed: true, reason: "Already removed; retained records available" }
      if (!value.changes?.available) return { removed: false, reason: "Workspace unavailable; retaining records" }
      if (git(value.path, ["status", "--porcelain", "--untracked-files=all"]).trim()) return { removed: false, reason: "Uncommitted work is preserved" }
      const head = git(value.path, ["rev-parse", "HEAD"]).trim()
      const projectHead = git(value.root,["rev-parse","HEAD"]).trim()
      const integrated = spawnSync("git", ["-C", value.root, "merge-base", "--is-ancestor", head, projectHead], { windowsHide: true })
      if (integrated.status !== 0) return { removed: false, reason: "Unintegrated commits are preserved" }
      value.integration={workerHead:head,projectHead,verifiedAt:new Date().toISOString(),method:"ancestor"};this.save(value)
      git(value.root, ["worktree", "remove", value.path])
      value.removed = true; this.save(value)
      return { removed: true, reason: "Clean workspace removed after integration; commits and changes retained" }
    } finally { lock.release() }
  }
}
