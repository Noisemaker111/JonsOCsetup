import { expect, test } from "bun:test"
import {
  assertKillAllowed,
  DEFAULT_COMMAND_TIMEOUT_MS,
  isIsolatedStandalone,
  isProtectedDesktopProcess,
  startCommandWatchdog,
  terminateWatchedChild,
} from "../scripts/command-watchdog.ts"

test("default command timeout is 900s", () => {
  expect(DEFAULT_COMMAND_TIMEOUT_MS).toBe(900_000)
})

test("desktop TUI and clipboard are protected; isolated --standalone is not", () => {
  expect(isProtectedDesktopProcess({ name: "opencode2.exe", commandLine: "opencode2.exe tui" })).toBe(true)
  expect(isProtectedDesktopProcess({ name: "wt.exe", commandLine: "wt.exe" })).toBe(true)
  expect(isProtectedDesktopProcess({ name: "conhost.exe", commandLine: "conhost.exe" })).toBe(true)
  expect(isProtectedDesktopProcess({ name: "OpenTUI Clipboard", commandLine: "OpenTUI Clipboard" })).toBe(true)
  expect(isIsolatedStandalone("opencode2.exe --standalone C:\\tmp\\opencode-usage-isolated")).toBe(true)
  expect(isProtectedDesktopProcess({
    name: "opencode2.exe",
    commandLine: "opencode2.exe --standalone C:\\tmp\\opencode-usage-isolated",
  })).toBe(false)
})

test("assertKillAllowed refuses live TUI without both --standalone and isolated temp name", () => {
  expect(() => assertKillAllowed({ pid: 1, name: "opencode2", commandLine: "opencode2.exe --standalone" })).toThrow(/refused to kill/)
  expect(() => assertKillAllowed({ pid: 2, name: "bun", commandLine: "bun test" })).not.toThrow()
})

test("paths containing opencode as a directory or temp prefix are not desktop TUI", () => {
  expect(isProtectedDesktopProcess({
    name: "C:\\Users\\Jk101\\.bun\\bin\\bun.exe",
    commandLine: "C:\\Users\\Jk101\\.bun\\bin\\bun.exe C:\\tmp\\opencode-claude-cancel\\fake-claude.mjs",
  })).toBe(false)
  expect(isProtectedDesktopProcess({
    name: "bun.exe",
    commandLine: "bun.exe C:\\Users\\Jk101\\.config\\opencode\\scripts\\foreground-supervisor.ts",
  })).toBe(false)
  expect(() => assertKillAllowed({
    pid: 3,
    name: "C:\\Users\\Jk101\\.bun\\bin\\bun.exe",
    commandLine: "C:\\Users\\Jk101\\.bun\\bin\\bun.exe C:\\tmp\\opencode-claude-cancel\\fake.mjs",
  })).not.toThrow()
})

test("startCommandWatchdog terminates after timeout and cancel prevents it", async () => {
  const timers: Array<{ fn: () => void; ms: number }> = []
  const clock = {
    setTimeout: ((fn: () => void, ms: number) => {
      timers.push({ fn, ms })
      return timers.length as unknown as ReturnType<typeof setTimeout>
    }) as typeof setTimeout,
    clearTimeout: ((id: ReturnType<typeof setTimeout>) => {
      const idx = Number(id) - 1
      if (timers[idx]) timers[idx] = { fn: () => {}, ms: 0 }
    }) as typeof clearTimeout,
  }
  const killed: number[] = []
  const child = { pid: 4242, kill: () => true }
  const watchdog = startCommandWatchdog(child, {
    timeoutMs: 50,
    clock,
    terminate: async (c) => { if (c.pid) killed.push(c.pid) },
  })
  expect(timers[0]?.ms).toBe(50)
  expect(watchdog.timedOut()).toBe(false)
  timers[0]!.fn()
  await Promise.resolve()
  expect(watchdog.timedOut()).toBe(true)
  expect(killed).toEqual([4242])

  const cancelled = startCommandWatchdog(child, {
    timeoutMs: 50,
    clock,
    terminate: async (c) => { if (c.pid) killed.push(c.pid) },
  })
  cancelled.cancel()
  const pending = timers[1]
  pending?.fn()
  await Promise.resolve()
  expect(cancelled.timedOut()).toBe(false)
  expect(killed).toEqual([4242])
})

test("terminateWatchedChild refuses protected desktop pid", async () => {
  const child = { pid: 99, kill: () => true }
  await expect(terminateWatchedChild(child, {
    inspect: () => ({ pid: 99, name: "opencode2.exe", commandLine: "opencode2.exe tui" }),
    terminate: async () => { throw new Error("should not terminate") },
  })).rejects.toThrow(/refused to kill/)
})
