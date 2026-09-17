/**
 * The Quest API receipt directory, and the one rule that keeps it small.
 *
 * A receipt says "this process, at this port, with this credential". It was written when a backend
 * started and removed only by `dispose()`, which does not run when a host is killed, crashes, or is a
 * launch preparation that ends. That is how one machine reached 306 receipts: 212 written before the
 * current boot, 92 naming processes that no longer exist, one naming a live process whose port
 * refused, and one real server the client never got to because the other 305 had spent the discovery
 * budget. So a host now writes one receipt at a name derived from its own identity -- a restart
 * replaces it instead of adding to it -- and whoever reads or writes this directory deletes the
 * receipts whose process is gone.
 *
 * Both the in-host server and the installed CLI import this: one registry, one set of rules.
 */
import { readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { uptime } from 'node:os'
import { join } from 'node:path'

/** One receipt per host process per ledger, at a name that a restart of either reuses. */
export function receiptName(pid, runtime) {
  return 'host-' + pid + '-' + createHash('sha256').update(String(runtime)).digest('hex').slice(0, 12) + '.json'
}

/**
 * Whether the process that wrote a receipt can still be serving it.
 *
 * Windows throws EPERM from `process.kill(pid, 0)` for a process owned by another user or for a PID
 * the system has reused, and the old client rethrew that as a discovery failure -- so a reused PID
 * counted as an error and consumed a probe slot. EPERM means the process exists and cannot be
 * signalled, which is "alive, cannot signal": keep it, probe it, and let its answer decide.
 */
export function processLiveness(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return 'gone'
  try { process.kill(pid, 0); return 'alive' } catch (error) {
    if (error.code === 'ESRCH') return 'gone'
    if (error.code === 'EPERM') return 'unsignalable'
    return 'unsignalable'
  }
}

export const bootedAt = () => Date.now() - uptime() * 1000

/**
 * Every usable receipt, newest first, with the dead ones deleted on the way past.
 *
 * A receipt written before this boot describes a service that no longer exists whatever its recorded
 * PID now belongs to, so it goes; so does one whose PID is gone, and one that cannot be parsed or
 * does not speak this version, because neither can ever be connected to again.
 */
export function readRegistry(directory) {
  let names
  try { names = readdirSync(directory).filter(name => name.endsWith('.json')) } catch { return { endpoints: [], removed: 0, rejected: [] } }
  const boot = bootedAt(), endpoints = [], rejected = []
  let removed = 0
  for (const name of names) {
    const path = join(directory, name)
    let mtimeMs, endpoint
    try { mtimeMs = statSync(path).mtimeMs } catch { continue }
    const drop = (reason) => { rejected.push(reason); try { unlinkSync(path) ; removed++ } catch (error) { if (error.code !== 'ENOENT') rejected.push('could not remove ' + name + ': ' + error.code) } }
    if (mtimeMs < boot) { drop('written before this boot'); continue }
    try { endpoint = JSON.parse(readFileSync(path, 'utf8')) } catch { drop('unreadable'); continue }
    if (endpoint?.version !== 2) { drop('older discovery format'); continue }
    if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint.url ?? '') || typeof endpoint.token !== 'string') { drop('malformed endpoint'); continue }
    const liveness = processLiveness(endpoint.pid)
    if (liveness === 'gone') { drop('process ' + endpoint.pid + ' is gone'); continue }
    endpoints.push({ ...endpoint, path, mtimeMs, liveness })
  }
  endpoints.sort((a, b) => (b.startedAt ?? b.mtimeMs) - (a.startedAt ?? a.mtimeMs) || b.mtimeMs - a.mtimeMs)
  return { endpoints, removed, rejected }
}
