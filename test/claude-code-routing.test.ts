import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { claudeCodeTaskTool, claudeCodeTool, resolveClaudeCodeWorkerName } from "../plugins-active/claude-code-task"
import { pickModel, spawnFailoverBefore } from "../models/model-routing"
import { formatAgentLabel, normalizeTaskDisplay } from "../orchestration/orchestration"

// The harness intercept itself is covered by claude-code-task.test.ts, which
// ships with opencode-harness. These are the cross-plugin contracts — routing,
// orchestration labels and host config — and stay in the config repo.

test("Claude aliases resolve to the honest harness agent", () => {
  for (const name of ["claude", "claude code", "harness", "claude-code-harness"]) expect(resolveClaudeCodeWorkerName(name)).toBe("claude-code")
  expect(resolveClaudeCodeWorkerName("anthropic" as string)).toBeUndefined()
  expect(formatAgentLabel("claude-code-harness")).toBe("Claude Code (Harness)")
  expect(pickModel("please use claude code", []).agent).toBe("claude-code")
  const task = { agent: "claude-code", description: "run tests" }
  normalizeTaskDisplay(task)
  expect(task.description).toBe("Claude Code (Harness) — run tests")
})

test("legacy direct harness tools exist as library helpers but are disabled in the host", () => {
  expect(claudeCodeTaskTool.name).toBe("claude_code_task")
  expect(claudeCodeTool.name).toBe("claude_code")
  const config = readFileSync(join(import.meta.dir, "..", "opencode.jsonc"), "utf8")
  const router = readFileSync(join(import.meta.dir, "..", "harnesses", "server.ts"), "utf8")
  expect(config).toContain('"claude-code"')
  expect(config).toMatch(/"claude_code_task"\s*:\s*false/)
  expect(config).toMatch(/"claude_code"\s*:\s*false/)
  expect(router).not.toMatch(/draft\.add\((?:claudeCodeTaskTool|claudeCodeTool)\)/)
  expect(router).not.toContain('"claude-code-intercept"')
})

test("quota failover never rewrites a claude-code Task onto a chat model", () => {
  const weekly = { updated: new Date().toISOString(), sources: [{ id: "opencode-go", windows: [{ label: "7d", used: 1, cap: 1, pct: 100, status: "rate-limited" }], apiCapHit: true }] }
  const input = { agent: "claude-code", description: "use the harness", model: "opencode/x-preview-f-free" }
  spawnFailoverBefore({ tool: "task", sessionID: "ses_test", id: "call_test", input }, weekly as any)
  expect(input.agent).toBe("claude-code")
  expect(input.model).toBe("opencode/x-preview-f-free")
})
