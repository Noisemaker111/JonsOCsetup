import { expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ClaudeCodeCliError, runClaudeCodeChat } from "../plugins-active/claude-code-task"
import {
  assertClaudeCodeNotRelayed,
  BridgeStreamError,
  ensureClaudeCodeFavoriteList,
  handleClaudeCodeChatCompletions,
  installClaudeCodeSession,
  interceptClaudeCodeSession,
  lastUserPrompt,
  persistClaudeCodeFavorite,
  prepareClaudeCodeContext,
  remainingText,
  sessionModelRef,
} from "../plugins-active/claude-code-session"
import { pickAvailableModel } from "../models/model-router"
import { ensureClaudeCodeCatalog } from "../models/model-catalog"
import { pickModel } from "../plugins-active/favorite-router"

async function withIsolatedSessionState<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env.LOCALAPPDATA
  const isolatedRoot = await mkdtemp(join(tmpdir(), "cc-session-state-"))
  process.env.LOCALAPPDATA = isolatedRoot
  try {
    return await run()
  } finally {
    if (previous === undefined) delete process.env.LOCALAPPDATA
    else process.env.LOCALAPPDATA = previous
    await rm(isolatedRoot, { recursive: true, force: true })
  }
}

test("last user prompt and session model refs resolve picker identity", () => {
  expect(lastUserPrompt([{ role: "system", content: "ignore" }, { role: "user", content: "hello from picker" }])).toBe("hello from picker")
  expect(sessionModelRef({ model: "claude-code/sonnet" })).toEqual({ providerID: "claude-code", modelID: "sonnet" })
  expect(sessionModelRef({ model: { providerID: "claude-code", id: "opus" } })).toEqual({ providerID: "claude-code", modelID: "opus" })
})

test("session intercept sends the user turn to the official CLI and never pins x-preview", async () => {
  let received: { prompt?: string; model?: string; sessionKey?: string } | undefined
  const result = await interceptClaudeCodeSession({
    sessionID: "ses_chat",
    cwd: process.cwd(),
    model: { providerID: "claude-code", id: "sonnet" },
    messages: [{ role: "user", content: "hello from picker" }],
  }, async (input) => {
    received = input
    return { text: "from-cli", runID: "r1", output: "from-cli" }
  })
  expect(received).toMatchObject({ prompt: "hello from picker", model: "sonnet", sessionKey: "ses_chat" })
  expect(JSON.stringify(received)).not.toContain("x-preview")
  expect(result).toMatchObject({ text: "from-cli" })
})

test("session model claude-code/* fails loud if a relay model is pinned", () => {
  expect(() => assertClaudeCodeNotRelayed("claude-code/claude", "opencode/x-preview-f-free")).toThrow(/must not pin a relay model/i)
  expect(() => assertClaudeCodeNotRelayed("claude-code/claude", "openai/gpt-5.6-luna-fast")).toThrow(/must not pin a relay model/i)
  expect(() => assertClaudeCodeNotRelayed("claude-code/claude", "claude-code/sonnet")).not.toThrow()
})

test("chat completions missing CLI fails loud with no silent fallback", async () => {
  const result = await handleClaudeCodeChatCompletions(
    { model: "claude", messages: [{ role: "user", content: "hi" }] },
    { "x-opencode-session-id": "ses_chat" },
    async () => {
      throw new ClaudeCodeCliError("blocked", "client-not-started: Claude Code CLI was not found. Install and authenticate Claude Code normally.")
    },
  )
  expect(result.status).toBe(503)
  expect(result.body).toMatch(/CLI was not found/)
  expect(result.body).not.toMatch(/x-preview|glm-5|luna/)
})

test("chat completions return the CLI text as an OpenAI-compatible completion", async () => {
  const result = await handleClaudeCodeChatCompletions(
    { model: "claude-code/claude", messages: [{ role: "user", content: "ping" }], stream: false },
    {},
    async (input) => {
      expect(input.prompt).toBe("ping")
      expect(input.model).toBeUndefined()
      return { text: "pong-from-cli", runID: "r2", output: "pong-from-cli" }
    },
  )
  expect(result.status).toBe(200)
  const body = JSON.parse(result.body) as { choices: Array<{ message: { content: string } }> }
  expect(body.choices[0].message.content).toBe("pong-from-cli")
})

// ---- Incremental SSE streaming --------------------------------------------

const SSE_MODEL = "claude-code/claude"

/** Parse a stream the way a client does: split on blank lines. */
function sseEvents(body: string): string[] {
  return body.split("\n\n").map((chunk) => chunk.trim()).filter(Boolean)
}

test("a streamed bridge turn emits thinking, text, tool and the terminal tail in order", async () => {
  const result = await handleClaudeCodeChatCompletions(
    { model: SSE_MODEL, messages: [{ role: "user", content: "stream me" }], stream: true },
    {},
    // A stand-in for the CLI run: emits the harness's normalized events live,
    // then returns the terminal text (which repeats the streamed content).
    async (input, context) => {
      expect(input.prompt).toBe("stream me")
      context.onEvent?.({ kind: "thinking", text: "pondering " })
      context.onEvent?.({ kind: "thinking", text: "deeply" })
      context.onEvent?.({ kind: "tool", name: "Bash", text: "ls" })
      context.onEvent?.({ kind: "text", text: "Hello " })
      context.onEvent?.({ kind: "text", text: "world" })
      return { text: "Hello world, done", runID: "r3", output: "" }
    },
  )
  expect(result.status).toBe(200)
  expect(result.contentType).toContain("text/event-stream")
  expect(result.stream).toBeTypeOf("function")

  const chunks: string[] = []
  await result.stream!((chunk) => chunks.push(chunk))
  const events = sseEvents(chunks.join(""))
  expect(events[events.length - 1]).toBe("data: [DONE]")

  const deltas = events.slice(0, -1).map((event) => JSON.parse(event.slice("data: ".length)) as { model: string; choices: Array<{ delta: Record<string, unknown>; finish_reason: string | null }> })
  // Blank-line separation: every event between [DONE] and the first parse
  // cleanly as one `data:` line each.
  expect(deltas.every((d) => d.model === SSE_MODEL)).toBe(true)
  const flat = deltas.flatMap((d) => d.choices[0].delta)
  expect(flat[0]).toEqual({ reasoning_content: "pondering " })
  expect(flat[1]).toEqual({ reasoning_content: "deeply" })
  // harness-json-to-oc: tool `Bash: ls` -> `$ ls` (Image 2)
  expect(flat[2]).toEqual({ content: "$ ls\n" })
  expect(flat[3]).toEqual({ content: "Hello " })
  expect(flat[4]).toEqual({ content: "world" })
  // The terminal text is only extended, never re-sent in full.
  expect(flat[5]).toEqual({ content: ", done" })
  const finish = deltas[deltas.length - 1]
  expect(finish.choices[0].delta).toEqual({})
  expect(finish.choices[0].finish_reason).toBe("stop")
})

test("a streaming turn that fails before any output keeps the mapped error status", async () => {
  const result = await handleClaudeCodeChatCompletions(
    { model: SSE_MODEL, messages: [{ role: "user", content: "hi" }], stream: true },
    {},
    async () => {
      throw new ClaudeCodeCliError("blocked", "client-not-started: Claude Code CLI was not found. Install and authenticate Claude Code normally.")
    },
  )
  await expect(result.stream!(() => {})).rejects.toMatchObject({ name: "BridgeStreamError", response: { status: 503 } })
})

test("a streaming turn that fails after output delivers the failure inside the stream", async () => {
  const result = await handleClaudeCodeChatCompletions(
    { model: SSE_MODEL, messages: [{ role: "user", content: "hi" }], stream: true },
    {},
    async (_input, context) => {
      context.onEvent?.({ kind: "text", text: "partial" })
      throw new ClaudeCodeCliError("failed", "provider: Claude Code failed (error_during_execution).")
    },
  )
  const chunks: string[] = []
  await result.stream!((chunk) => chunks.push(chunk))
  const events = sseEvents(chunks.join(""))
  const deltas = events.slice(0, -1).map((event) => JSON.parse(event.slice("data: ".length)) as { choices: Array<{ delta: Record<string, unknown>; finish_reason: string | null }> })
  expect(events[events.length - 1]).toBe("data: [DONE]")
  const flat = deltas.flatMap((d) => d.choices[0].delta)
  expect(flat).toEqual([{ content: "partial" }, { content: "\n[error] provider: Claude Code failed (error_during_execution)." }, {}])
  expect(deltas[deltas.length - 1].choices[0].finish_reason).toBe("stop")
})

test("the terminal text is never re-sent when the deltas already streamed it", () => {
  expect(remainingText("Hello world", "")).toBe("Hello world")
  expect(remainingText("Hello world", "Hello ")).toBe("world")
  expect(remainingText("Hello world", "Hello world")).toBe("")
  // Diverged shapes (a plain-text CLI's trimmed stdout) add nothing: the
  // deltas already carry the answer and re-sending doubles it.
  expect(remainingText("Hello world", "Hello world\n")).toBe("")
  expect(remainingText("", "partial")).toBe("")
})

test("runClaudeCodeChat missing executable fails loud", async () => {
  await withIsolatedSessionState(async () => {
    await expect(runClaudeCodeChat({ prompt: "hi", executable: "definitely-not-a-claude-client" })).rejects.toThrow(/client-not-started|CLI was not found/)
  })
})

test("prepareClaudeCodeContext strips OpenCode tools and fails loud when the CLI is missing", () => {
  const tools = { bash: true, edit: true }
  try {
    prepareClaudeCodeContext({ model: "claude-code/claude", tools })
  } catch (error) {
    expect(String(error)).toMatch(/CLI was not found|client-not-started/)
  }
  expect(Object.keys(tools)).toHaveLength(0)
  expect(() => prepareClaudeCodeContext({ model: "claude-code/claude", input: { model: "opencode/x-preview-f-free" } })).toThrow(/must not pin a relay model/i)
})

test("persistClaudeCodeFavorite prepends claude-code/claude without dropping existing rows", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cc-fav-"))
  const file = join(directory, "model.json")
  await writeFile(file, JSON.stringify({ favorite: [{ providerID: "grok-sub", modelID: "grok-4.6" }], recent: [] }))
  try {
    expect(persistClaudeCodeFavorite([file])).toBe(true)
    const parsed = JSON.parse(await readFile(file, "utf8")) as { favorite: Array<{ providerID: string; modelID: string }> }
    expect(parsed.favorite[0]).toEqual({ providerID: "claude-code", modelID: "claude" })
    expect(parsed.favorite.some((row) => row.providerID === "grok-sub")).toBe(true)
    expect(persistClaudeCodeFavorite([file])).toBe(false)
    expect(ensureClaudeCodeFavoriteList([{ providerID: "claude-code", modelID: "claude" }])).toEqual([{ providerID: "claude-code", modelID: "claude" }])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("installClaudeCodeSession registers context hooks without binding the bridge in tests", async () => {
  const hooks: string[] = []
  await installClaudeCodeSession({
    session: {
      hook: async (name: string) => {
        hooks.push(name)
      },
    },
    catalog: { transform: async () => undefined },
  }, async () => ({ text: "ok", runID: "r", output: "ok" }), { listen: false, favoriteFiles: [] })
  expect(hooks).toContain("context")
  expect(hooks).toContain("http.request")
})

test("auto pickModel/pickAvailableModel never select claude-code as a chat model", () => {
  const picked = pickModel("implement the feature", [
    { providerID: "claude-code", modelID: "claude" },
    { providerID: "opencode-go", modelID: "muse-spark-1.2-contributor" },
  ])
  expect(picked.model).not.toMatch(/claude-code/)
  expect(picked.agent).not.toBe("claude-code")
  const catalog = ensureClaudeCodeCatalog([
    { providerID: "opencode-go", modelID: "muse-spark-1.2-contributor", name: "Muse", lane: "go-quota", priceOutput: 0.2, capabilities: { tools: true } },
  ])
  expect(catalog.some((model) => model.providerID === "claude-code")).toBe(true)
  const available = pickAvailableModel("implement the feature", catalog.filter((model) => model.providerID !== "claude-code"))
  expect(available?.model.providerID).toBe("opencode-go")
})

test("user-named Claude Code still routes Task to the official CLI agent", () => {
  const picked = pickModel("please use claude code", [{ providerID: "claude-code", modelID: "claude" }])
  expect(picked.agent).toBe("claude-code")
  expect(picked.model).toBeUndefined()
})
