import { statSync, existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join, isAbsolute } from 'node:path'
import { physicalDirectory, projectIdentity } from '../quest/router-public'
import { RouterError, redact } from './host'
import {repositoryURL} from './remote'

export type Target = { id: string; root: string; directory: string; name: string; hostID?: string; remote?: string }
export type Selection = { revision: number; targets: Target[]; pin?: Target; aliases: Record<string, Target>; asked: boolean }
export const emptySelection = (): Selection => ({ revision: 0, targets: [], aliases: {}, asked: false })
/**
 * A target directory is the operating system's own spelling of the path, never the caller's.
 *
 * Node's `realpathSync` resolves links but leaves Windows path case exactly as it was typed, and a
 * selector arrives lowercased often enough (spoken paths, git's own output, a shell that was cd'd
 * with a small drive letter). The host walks a session's directory up to the home directory by
 * string equality, so `c:\users\jk101\...` under a `C:\Users\Jk101` home never reaches the stop and
 * recurses past the drive root: its instruction sources die with a stack overflow and the session
 * fails with "Instruction initialization blocked by unavailable sources: core/instructions". Only
 * the native realpath answers with the spelling the host will compare against.
 */
export function verifyTarget(directory: string): Target {
  if (!isAbsolute(directory)) throw new RouterError('ABSOLUTE_PATH_REQUIRED', 'Choose an absolute project/worktree directory')
  try {
    const real = physicalDirectory(directory)
    return { ...projectIdentity(real), directory: real, name: basename(real) }
  } catch { throw new RouterError('DIRECTORY_UNAVAILABLE', 'Project identity cannot be verified; choose its current absolute directory') }
}
export const targetKey = (t: Target) => process.platform === 'win32' ? t.directory.toLowerCase() : t.directory
export function revalidate(target: Target) {
  const current = verifyTarget(target.directory)
  if (current.id !== target.id || targetKey(current) !== targetKey(target)) throw new RouterError('IDENTITY_CHANGED', 'Destination identity changed; select it again')
  return { ...target, ...current }
}
export function instructions(target: Target) {
  const paths: string[] = []; let current = target.directory
  for (let i = 0; i < 40; i++) {
    paths.unshift(join(current, 'AGENTS.md')); const parent = dirname(current); if (parent === current) break; current = parent
  }
  let budget = 24000
  return paths.filter(existsSync).map(path => {
    const size = statSync(path).size
    if (size > budget) throw new RouterError('INSTRUCTIONS_LIMIT', 'Destination instructions exceed the routing budget; inspect them explicitly before routing')
    const text = readFileSync(path, 'utf8'); budget -= size; return { path, text: redact(text, 24000) }
  })
}
/** Recency ranks discovery only; never grants target authority. */
export function resolveTargets(state: Selection, known: Target[], input: { selectors?: string[]; discussion?: boolean }) {
  if (input.discussion) return { state: 'discussion' as const, targets: [] }
  const selectors = input.selectors?.filter(s => s.trim()) ?? []
  if (!selectors.length) {
    const targets = state.pin ? [state.pin] : state.targets
    if (targets.length) return { state: 'resolved' as const, targets: targets.map(revalidate), reason: 'Verified conversation selection' }
  }
  const targets: Target[] = [], candidates: Target[] = []
  for (const selector of selectors) {
    if (isAbsolute(selector)) { targets.push(verifyTarget(selector)); continue }
    const remote=/^(https:\/\/|ssh:\/\/|git@)/.test(selector)?repositoryURL(selector).identity:selector
    const exact = known.filter(t => t.id === selector || t.remote === remote)
    const alias = Object.hasOwn(state.aliases,selector.toLowerCase())?state.aliases[selector.toLowerCase()]:undefined
    const matches = exact.length ? exact : alias ? [alias] : known.filter(t => t.name.toLowerCase() === selector.toLowerCase())
    if (matches.length === 1) targets.push(revalidate(matches[0])); else candidates.push(...matches)
    if (matches.length !== 1) return { state: state.asked ? 'unresolved' as const : 'clarify' as const, targets: [], candidates: [...new Map(candidates.map(t => [targetKey(t), t])).values()].slice(0, 20), reason: 'Choose one full directory for each explicit target; no work has started' }
  }
  if (!targets.length) return { state: state.asked ? 'unresolved' as const : 'clarify' as const, targets: [], candidates: known.slice(0, 20), reason: 'Choose a project directory; recent activity alone does not select one' }
  return { state: 'resolved' as const, targets: [...new Map(targets.map(t => [targetKey(t), t])).values()], reason: 'Explicit user selector' }
}
