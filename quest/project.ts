import { realpathSync, statSync } from "node:fs"
import { isAbsolute, resolve } from "node:path"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"

const identityTimeoutMs=15000
function identityGit(directory:string,args:string[]) {
  const result=spawnSync("git",["-C",directory,...args],{encoding:"utf8",windowsHide:true,timeout:identityTimeoutMs,maxBuffer:262144})
  const code=(result.error as NodeJS.ErrnoException|undefined)?.code
  if(code==="ETIMEDOUT")throw new Error(`Git identity ${args[0]} timed out after ${identityTimeoutMs}ms; source binding was not established. Wait for filesystem load to settle and retry explicitly`)
  if(result.error)throw new Error(`Git identity ${args[0]} capability failed (${code??result.error.name}); verify Git is available and the selected checkout is accessible`)
  if(result.signal)throw new Error(`Git identity ${args[0]} interrupted (${result.signal}); source binding was not established`)
  return result
}

export type ProjectIdentity = { id: string; root: string }
export const physicalDirectory = (directory:string) => {
  if(typeof directory!=="string"||!isAbsolute(directory))throw new Error("An absolute host-derived directory is required")
  const path=realpathSync.native(directory)
  if(!statSync(path).isDirectory())throw new Error("Source directory is unavailable")
  return path
}
/** Keep canonical ledger identity separate from the physical selected checkout. */
export function sourceCheckout(directory:string, expected?:ProjectIdentity) {
  const physical=physicalDirectory(directory),project=projectIdentity(physical)
  if(expected&&(project.id!==expected.id||physicalDirectory(project.root)!==physicalDirectory(expected.root)))throw new Error("Source checkout belongs to a different project")
  const out=identityGit(physical,["rev-parse","--show-toplevel"])
  if(out.status!==0)throw new Error("Cannot establish selected Git checkout")
  const source=physicalDirectory(out.stdout.trim())
  return {project,source}
}
export function verifySourceBinding(context:{project:ProjectIdentity;directory?:string},directory:string) {
  const bound=context.directory&&(process.platform==="win32"?resolve(context.directory).toLowerCase():resolve(context.directory))
  if(!bound||bound!==(process.platform==="win32"?physicalDirectory(directory).toLowerCase():physicalDirectory(directory)))throw new Error("Selected source directory changed; explicitly authorize the destination again")
  const project=projectIdentity(directory)
  if(project.id!==context.project.id||physicalDirectory(project.root)!==physicalDirectory(context.project.root))throw new Error("Source checkout belongs to a different project")
}
/** Resolve only the trusted session directory; the ledger is never an input. */
export function projectIdentity(directory: string): ProjectIdentity {
  if (typeof directory !== "string" || !isAbsolute(directory)) throw new Error("Project requires an absolute trusted session directory")
  let root = physicalDirectory(directory)
  if (!statSync(root).isDirectory()) throw new Error("Project directory is unavailable")
  const git = identityGit(root,["rev-parse", "--is-inside-work-tree"])
  if (git.status === 0 && git.stdout.trim() === "true") {
    const listing = identityGit(root,["worktree", "list", "--porcelain", "-z"])
    if (listing.status !== 0) throw new Error("Cannot resolve the owning Git project")
    const first = listing.stdout.split("\0").find(line => line.startsWith("worktree "))?.slice(9)
    if (!first || !isAbsolute(first)) throw new Error("Git did not report the main project path")
    root = physicalDirectory(first)
  } else if (git.error || (git.status !== 0 && !/not a git repository/i.test(git.stderr))) {
    throw new Error("Cannot establish Git project identity; check repository access")
  }
  const key = process.platform === "win32" ? resolve(root).toLowerCase() : resolve(root)
  return { id: createHash("sha256").update(key).digest("hex"), root }
}
