import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { randomBytes } from "node:crypto"
import { setTimeout as delay } from "node:timers/promises"

const START = `${Math.floor(Date.now() - process.uptime() * 1000)}-${process.pid}`
function sleep(ms: number) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) }
function alive(pid: number): boolean { try { process.kill(pid, 0); return true } catch { return false } }
export type HeldLock = { path: string; nonce: string; heartbeat(): void; release(): void }

export class LockBusyError extends Error {
  constructor(name:string) { super(`lock timeout: ${name}`); this.name='LockBusyError' }
}

export function acquireLock(runtimeRoot: string, name: string, options: { timeoutMs?: number; staleMs?: number; isAlive?: (pid: number, start: string) => boolean } = {}): HeldLock {
  const path = join(runtimeRoot, "locks", `${name}.lock`), owner = join(path, "owner.json"), started = Date.now(), nonce = randomBytes(12).toString("hex")
  const timeout = options.timeoutMs ?? 15_000, stale = options.staleMs ?? 30_000, isAlive = options.isAlive ?? ((pid: number, start: string) => pid === process.pid ? start === START : alive(pid))
  mkdirSync(join(runtimeRoot, "locks"), { recursive: true })
  while (true) {
    try {
      mkdirSync(path)
      const heartbeat = () => writeFileSync(owner, JSON.stringify({ pid: process.pid, processStart: START, nonce, heartbeat: Date.now() }), "utf8")
      heartbeat()
      return { path, nonce, heartbeat, release: () => { try { const current = JSON.parse(readFileSync(owner, "utf8")); if (current.nonce === nonce) rmSync(path, { recursive: true, force: true }) } catch {} } }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      try {
        const data = JSON.parse(readFileSync(owner, "utf8")), age = Date.now() - Number(data.heartbeat ?? statSync(path).mtimeMs)
        if (age > stale && !isAlive(Number(data.pid), String(data.processStart))) rmSync(path, { recursive: true, force: true })
      } catch { /* Unknown owner is not safely breakable until timeout. */ }
      if (Date.now() - started >= timeout) throw new LockBusyError(name)
      sleep(5)
    }
  }
}

export function withLocks<T>(runtimeRoot: string, names: string[], action: () => T): T {
  const ordered = [...new Set(names)].sort((a, b) => a === "index" ? 1 : b === "index" ? -1 : a.localeCompare(b)), held: HeldLock[] = []
  try { for (const name of ordered) held.push(acquireLock(runtimeRoot, name)); return action() }
  finally { for (const lock of held.reverse()) lock.release() }
}

/** Long-running tools must yield while another tool holds the same workspace. */
export async function acquireLockAsync(runtimeRoot:string,name:string,signal:AbortSignal):Promise<HeldLock> {
  for (;;) {
    signal.throwIfAborted()
    try { return acquireLock(runtimeRoot,name,{timeoutMs:0}) }
    catch(error) { if(!(error instanceof LockBusyError))throw error }
    await delay(50,undefined,{signal})
  }
}
