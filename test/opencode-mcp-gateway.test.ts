import { expect, test } from "bun:test"
import { join } from "node:path"

const wrapper = join(import.meta.dir, "..", "harnesses", "opencode-mcp-stdio.mjs")

test("mcp_agent_status ignores a prior completed turn while a continuation runs", async () => {
  let messages: unknown[] = []
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname
      if (path.endsWith("/message")) return Response.json({ data: messages })
      if (path.endsWith("/session/ses_test")) return Response.json({ data: { id: "ses_test", title: "model - task", model: { providerID: "openai", id: "model" } } })
      return new Response("not found", { status: 404 })
    },
  })
  const status = async () => {
    const child = Bun.spawn(["node", wrapper], {
      env: { ...process.env, OPENCODE_SERVER_URL: `http://127.0.0.1:${server.port}` },
      stdin: "pipe", stdout: "pipe", stderr: "pipe",
      windowsHide: true,
    })
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "agent_status", arguments: { sessionID: "ses_test" } } }) + "\n")
    child.stdin.end()
    const output = await new Response(child.stdout).text()
    expect(await child.exited).toBe(0)
    return JSON.parse(output.trim()).result.content[0].text as string
  }
  try {
    const old = { type: "assistant", finish: "stop", time: { completed: 1 }, content: [{ type: "text", text: "old result" }] }
    messages = [{ type: "user", time: { created: 3 }, text: "continue" }, old]
    expect(await status()).toContain("ses_test: running")
    messages = [{ type: "assistant", finish: "tool-calls", time: { completed: 4 }, content: [] }, { type: "user", time: { created: 3 } }, old]
    expect(await status()).toContain("ses_test: running")
    messages = [{ type: "assistant", finish: "stop", time: { completed: 5 }, content: [{ type: "text", text: "new result" }] }, { type: "user", time: { created: 3 } }, old]
    expect(await status()).toContain("ses_test: completed")
  } finally {
    server.stop(true)
  }
})

test("mcp_agent rejects a bare model ID before creating a session", async () => {
  const child = Bun.spawn(["node", wrapper], {
    env: { ...process.env, OPENCODE_SERVER_URL: "http://127.0.0.1:1" },
    stdin: "pipe", stdout: "pipe", stderr: "pipe",
    windowsHide: true,
  })
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "agent", arguments: { questID: "quest_12345678", model: "grok-4.6", task: "work" } } }) + "\n")
  child.stdin.end()
  const response = JSON.parse((await new Response(child.stdout).text()).trim())
  expect(await child.exited).toBe(0)
  expect(response.result.isError).toBe(true)
  expect(response.result.content[0].text).toContain("explicit provider/model is required")
})

test("mcp prefers config-dir live 4096 over state --service port", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const home = mkdtempSync(join(tmpdir(), "mcp-home-"))
  mkdirSync(join(home, ".config", "opencode"), { recursive: true })
  mkdirSync(join(home, ".local", "state", "opencode"), { recursive: true })
  writeFileSync(join(home, ".config", "opencode", "service.json"), JSON.stringify({ password: "secret" }))
  writeFileSync(join(home, ".local", "state", "opencode", "service.json"), JSON.stringify({ url: "http://127.0.0.1:49374", password: "other", pid: 1 }))
  const prevHome = process.env.HOME
  const prevUrl = process.env.OPENCODE_SERVER_URL
  const prevFile = process.env.OPENCODE_SERVICE_FILE
  process.env.HOME = home
  delete process.env.OPENCODE_SERVER_URL
  process.env.OPENCODE_SERVICE_FILE = join(home, ".config", "opencode", "service.json")
  try {
    const { discoverService } = await import("../harnesses/opencode-mcp-stdio.mjs")
    const svc = discoverService()
    expect(svc.url).toBe("http://127.0.0.1:4096")
    expect(svc.password).toBe("secret")
  } finally {
    if (prevHome === undefined) delete process.env.HOME
    else process.env.HOME = prevHome
    if (prevUrl === undefined) delete process.env.OPENCODE_SERVER_URL
    else process.env.OPENCODE_SERVER_URL = prevUrl
    if (prevFile === undefined) delete process.env.OPENCODE_SERVICE_FILE
    else process.env.OPENCODE_SERVICE_FILE = prevFile
    rmSync(home, { recursive: true, force: true })
  }
})

test("normalizeModel parses provider/model#variant", async () => {
  const { normalizeModel } = await import("../harnesses/opencode-mcp-stdio.mjs")
  expect(normalizeModel("cliproxyapi/gpt-5.6-luna#max")).toEqual({ providerID: "cliproxyapi", id: "gpt-5.6-luna", variant: "max" })
  expect(normalizeModel("openai/gpt-5.6-luna-fast", "max")).toEqual({ providerID: "openai", id: "gpt-5.6-luna-fast", variant: "max" })
  expect(normalizeModel("grok-4.6")).toBeNull()
})

test("chipLabel is the bare live line: (quest title, model, reasoning[, fast]), unknown parts omitted", async () => {
  const { chipLabel } = await import("../harnesses/opencode-mcp-stdio.mjs")
  expect(chipLabel("Ship it", { providerID: "openai", id: "gpt-5.6-sol", variant: "xhigh" })).toBe("(Ship it, openai/gpt-5.6-sol, xhigh)")
  expect(chipLabel("Ship it", { providerID: "openai", id: "gpt-5.6-luna-fast", variant: "medium" })).toBe("(Ship it, openai/gpt-5.6-luna-fast, medium, fast)")
  expect(chipLabel("Ship it", { providerID: "openai", id: "gpt-5.6-luna-fast" })).toBe("(Ship it, openai/gpt-5.6-luna-fast, max, fast)")
  // No variant and no lane default: omitted, never a placeholder.
  expect(chipLabel("Ship it", { providerID: "grok-sub", id: "grok-4.6" })).toBe("(Ship it, grok-sub/grok-4.6)")
  expect(chipLabel("Ship it", null)).toBe("(Ship it)")
})

test("chipLabel agrees with the TS subagentChipLabel on every shared face, including lane defaults", async () => {
  const { chipLabel } = await import("../harnesses/opencode-mcp-stdio.mjs")
  const { reasoningEffortFor, subagentChipLabel } = await import("../orchestration/dispatch")
  const cases = [
    { title: "Ship it", model: { providerID: "openai", id: "gpt-5.6-sol", variant: "high" } },
    { title: "Ship it", model: { providerID: "openai", id: "gpt-5.6-luna", variant: "max-fast" } },
    { title: "Ship it", model: { providerID: "openai", id: "gpt-5.6-luna-fast", variant: "medium" } },
    { title: "Ship it", model: { providerID: "cliproxyapi", id: "gpt-5.6-sol" } },
    { title: "Ship it", model: { providerID: "openai", id: "gpt-5.6-luna-fast" } },
    { title: "Ship it", model: { providerID: "grok-sub", id: "grok-4.6" } },
  ]
  for (const { title, model } of cases) {
    const reasoning = reasoningEffortFor(model.providerID, model.id, model.variant)
    const ts = subagentChipLabel({ title }, { providerID: model.providerID, modelID: model.id, reasoningEffort: reasoning.reasoningEffort, fast: reasoning.fast })
    expect(chipLabel(title, model)).toBe(ts)
  }
})

test("session_start does not require a Quest and sends model+variant", async () => {
  let created: any
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (request.method === "POST" && url.pathname.endsWith("/session") && !url.pathname.includes("/prompt")) {
        created = await request.json()
        return Response.json({ data: { id: "ses_desk1", agent: created.agent, model: created.model, title: created.title } })
      }
      if (request.method === "POST" && url.pathname.endsWith("/prompt")) {
        return Response.json({ data: { id: "msg_1", type: "user" } })
      }
      return new Response("not found", { status: 404 })
    },
  })
  const child = Bun.spawn(["node", wrapper], {
    env: { ...process.env, OPENCODE_SERVER_URL: `http://127.0.0.1:${server.port}` },
    stdin: "pipe", stdout: "pipe", stderr: "pipe",
    windowsHide: true,
  })
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "session_start", arguments: { model: "cliproxyapi/gpt-5.6-luna#max", text: "ping" } } }) + "\n")
  child.stdin.end()
  const output = await new Response(child.stdout).text()
  expect(await child.exited).toBe(0)
  server.stop(true)
  const text = JSON.parse(output.trim()).result.content[0].text as string
  expect(text).toContain("Session: ses_desk1")
  expect(created.model).toEqual({ providerID: "cliproxyapi", id: "gpt-5.6-luna", variant: "max" })
  expect(created.agent).toBe("build")
})

test("prefers explicit 4096 url over password-only config", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const home = mkdtempSync(join(tmpdir(), "mcp-home-"))
  mkdirSync(join(home, ".config", "opencode"), { recursive: true })
  mkdirSync(join(home, ".local", "state", "opencode"), { recursive: true })
  writeFileSync(join(home, ".config", "opencode", "service.json"), JSON.stringify({ password: "stale" }))
  writeFileSync(join(home, ".local", "state", "opencode", "service.json"), JSON.stringify({ url: "http://127.0.0.1:4096", password: "live", pid: 1 }))
  const prevHome = process.env.HOME
  const prevUrl = process.env.OPENCODE_SERVER_URL
  const prevFile = process.env.OPENCODE_SERVICE_FILE
  process.env.HOME = home
  delete process.env.OPENCODE_SERVER_URL
  process.env.OPENCODE_SERVICE_FILE = join(home, ".local", "state", "opencode", "service.json")
  try {
    const { discoverService } = await import("../harnesses/opencode-mcp-stdio.mjs")
    const svc = discoverService()
    expect(svc.url).toBe("http://127.0.0.1:4096")
    expect(svc.password).toBe("live")
  } finally {
    if (prevHome === undefined) delete process.env.HOME
    else process.env.HOME = prevHome
    if (prevUrl === undefined) delete process.env.OPENCODE_SERVER_URL
    else process.env.OPENCODE_SERVER_URL = prevUrl
    if (prevFile === undefined) delete process.env.OPENCODE_SERVICE_FILE
    else process.env.OPENCODE_SERVICE_FILE = prevFile
    rmSync(home, { recursive: true, force: true })
  }
})

test("checkinQuestion asks complete or not without review", async () => {
  const { checkinQuestion } = await import("../harnesses/opencode-mcp-stdio.mjs")
  const q = checkinQuestion("0001n9hvpqh4vjea804w7t51wf")
  expect(q).toContain("COMPLETE or NOT_COMPLETE")
  expect(q).toContain("0001n9hvpqh4vjea804w7t51wf")
  expect(q).toContain("No Grok reviewer")
})

test("session_checkin asks the session if the quest is complete", async () => {
  let asked = ""
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (request.method === "POST" && url.pathname.endsWith("/prompt")) {
        const body = await request.json() as { text?: string }
        asked = String(body.text || "")
        return Response.json({ data: { id: "msg_q", type: "user" } })
      }
      if (url.pathname.endsWith("/message")) {
        return Response.json({ data: [
          { type: "assistant", finish: "stop", time: { completed: 2 }, content: [{ type: "text", text: "COMPLETE\nZULU42" }] },
          { type: "user", time: { created: 1 }, text: asked },
        ] })
      }
      return new Response("not found", { status: 404 })
    },
  })
  const child = Bun.spawn(["node", wrapper], {
    env: { ...process.env, OPENCODE_SERVER_URL: `http://127.0.0.1:${server.port}` },
    stdin: "pipe", stdout: "pipe", stderr: "pipe",
    windowsHide: true,
  })
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "session_checkin", arguments: { sessionID: "ses_check1", questID: "q1" } } }) + "\n")
  child.stdin.end()
  const output = await new Response(child.stdout).text()
  expect(await child.exited).toBe(0)
  server.stop(true)
  const text = JSON.parse(output.trim()).result.content[0].text as string
  expect(asked).toContain("COMPLETE or NOT_COMPLETE")
  expect(asked).toContain("q1")
  expect(text).toContain("COMPLETE")
  expect(text).toContain("ZULU42")
})

test("desk wait defaults keep the parent in the loop until COMPLETE", async () => {
  const {
    parseWaitMs, parseMaxSteers, DEFAULT_WAIT_MS, DEFAULT_MAX_STEERS, isLiveSessionID,
    shouldAllowPermission, questVerdict, steerQuestion,
  } = await import("../harnesses/opencode-mcp-stdio.mjs")
  expect(parseWaitMs(undefined)).toBe(DEFAULT_WAIT_MS)
  expect(parseWaitMs(undefined)).toBeGreaterThan(0)
  expect(parseWaitMs(0)).toBe(0)
  expect(parseMaxSteers(undefined)).toBe(DEFAULT_MAX_STEERS)
  expect(DEFAULT_MAX_STEERS).toBeGreaterThan(8)
  expect(isLiveSessionID("ses_wait1")).toBe(false)
  expect(isLiveSessionID("ses_valid1")).toBe(false)
  expect(isLiveSessionID("ses_desk1")).toBe(false)
  expect(isLiveSessionID("ses_liveparent000001")).toBe(true)
  expect(shouldAllowPermission({ action: "external_directory" })).toBe(true)
  expect(shouldAllowPermission({ action: "shell" })).toBe(false)
  expect(questVerdict("NOT_COMPLETE\nstill working")).toBe("NOT_COMPLETE")
  expect(questVerdict("COMPLETE\ndone-check: tests")).toBe("COMPLETE")
  expect(steerQuestion("q1")).toContain("q1")
  expect(steerQuestion("q1")).not.toMatch(/luna|hy3/i)
})

async function callDeskTool(port: number, name: string, args: Record<string, unknown>, extraEnv: Record<string, string> = {}) {
  const child = Bun.spawn(["node", wrapper], {
    env: {
      ...process.env,
      OPENCODE_SERVER_URL: `http://127.0.0.1:${port}`,
      OPENCODE_DESK_DRIVER: "0",
      ...extraEnv,
    },
    stdin: "pipe", stdout: "pipe", stderr: "pipe",
    windowsHide: true,
  })
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) + "\n")
  child.stdin.end()
  const output = await new Response(child.stdout).text()
  expect(await child.exited).toBe(0)
  return JSON.parse(output.trim())
}

test("synthetic ses_wait1 is not waited, steered, or sent to a stop webhook", async () => {
  const hits = { prompt: 0, wait: 0, permission: 0, webhook: 0 }
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/hook") { hits.webhook++; return new Response("ok") }
      if (request.method === "POST" && url.pathname.endsWith("/prompt")) { hits.prompt++; return Response.json({ data: { id: "msg_1" } }) }
      if (request.method === "POST" && url.pathname.endsWith("/wait")) { hits.wait++; return new Response(null, { status: 204 }) }
      if (url.pathname.includes("/permission")) { hits.permission++; return Response.json({ data: [] }) }
      return new Response("not found", { status: 404 })
    },
  })
  try {
    const response = await callDeskTool(server.port, "session_prompt", { sessionID: "ses_wait1", text: "continue" }, {
      OPENCODE_SESSION_STOP_WEBHOOK: `http://127.0.0.1:${server.port}/hook`,
    })
    const text = response.result.content[0].text as string
    expect(text).toContain("ses_wait1")
    expect(text).toContain("Run: ignored")
    expect(hits.prompt).toBe(1)
    expect(hits.wait).toBe(0)
    expect(hits.permission).toBe(0)
    expect(hits.webhook).toBe(0)
  } finally {
    server.stop(true)
  }
})

test("session_prompt wait=0 returns immediately without waitForIdle", async () => {
  const hits = { wait: 0, prompt: 0 }
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (request.method === "POST" && url.pathname.endsWith("/prompt")) { hits.prompt++; return Response.json({ data: { id: "msg_1" } }) }
      if (request.method === "POST" && url.pathname.endsWith("/wait")) { hits.wait++; return new Response(null, { status: 204 }) }
      return new Response("not found", { status: 404 })
    },
  })
  try {
    const response = await callDeskTool(server.port, "session_prompt", {
      sessionID: "ses_liveparent000001",
      text: "ping",
      wait: 0,
    })
    expect(response.result.content[0].text).toContain("Run: immediate")
    expect(hits.prompt).toBe(1)
    expect(hits.wait).toBe(0)
  } finally {
    server.stop(true)
  }
})

test("desk session_start waits, auto-allows external_directory, steers, and fans out children", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const lockDir = mkdtempSync(join(tmpdir(), "desk-lock-"))
  const LIVE = "ses_liveparent000001"
  const CHILD = "ses_livechild00000001"
  const hits = { wait: [] as string[], prompts: [] as string[], replies: [] as unknown[], children: 0, webhook: 0 }
  const allowed = new Set<string>()
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const session = url.pathname.match(/\/session\/(ses_[A-Za-z0-9_-]+)/)?.[1]
      if (url.pathname === "/hook") { hits.webhook++; return new Response("ok") }
      if (request.method === "POST" && url.pathname.endsWith("/session") && !url.pathname.includes("/prompt") && !url.pathname.includes("/wait")) {
        const created = await request.json() as { agent?: string; model?: unknown; title?: string }
        return Response.json({ data: { id: LIVE, agent: created.agent, model: created.model, title: created.title } })
      }
      if (request.method === "POST" && url.pathname.endsWith("/prompt")) {
        const body = await request.json() as { text?: string; delivery?: string }
        hits.prompts.push(`${session}:${body.delivery || "admit"}:${body.text || ""}`)
        return Response.json({ data: { id: "msg_p" } })
      }
      if (request.method === "POST" && url.pathname.endsWith("/wait")) {
        hits.wait.push(session || "")
        return new Response(null, { status: 204 })
      }
      if (request.method === "GET" && url.pathname.endsWith("/permission")) {
        if (session === LIVE && !allowed.has(LIVE)) {
          return Response.json({ data: [{ id: "per_ext1", action: "external_directory", resources: ["/work/*"] }] })
        }
        return Response.json({ data: [] })
      }
      if (request.method === "POST" && url.pathname.endsWith("/reply")) {
        const body = await request.json()
        hits.replies.push(body)
        allowed.add(session || "")
        return new Response(null, { status: 204 })
      }
      if (request.method === "GET" && url.pathname.endsWith("/session") && url.searchParams.get("parentID") === LIVE) {
        hits.children++
        return Response.json({ data: [{ id: CHILD }] })
      }
      if (url.pathname.endsWith("/message")) {
        const steered = hits.prompts.some((row) => row.startsWith(`${session}:steer:`))
        const text = steered ? "COMPLETE\ndone-check: tests" : "NOT_COMPLETE\nstill working"
        return Response.json({ data: [
          { type: "assistant", finish: "stop", time: { completed: 2 }, content: [{ type: "text", text }] },
          { type: "user", time: { created: 1 } },
        ] })
      }
      return new Response("not found", { status: 404 })
    },
  })
  try {
    const response = await callDeskTool(server.port, "session_start", {
      model: "cliproxyapi/grok-4.6",
      text: "do the quest",
      questID: "quest_desk_parent1",
    }, {
      OPENCODE_DESK_LOCK_DIR: lockDir,
      OPENCODE_SESSION_STOP_WEBHOOK: `http://127.0.0.1:${server.port}/hook`,
    })
    const text = response.result.content[0].text as string
    expect(text).toContain(`Session: ${LIVE}`)
    expect(text).toContain("Run: complete")
    expect(text).toContain("COMPLETE")
    expect(text).not.toContain("Run: immediate")
    expect(hits.wait).toContain(LIVE)
    expect(hits.wait).toContain(CHILD)
    expect(hits.replies).toContainEqual({ reply: "always" })
    expect(hits.prompts.some((row) => row.startsWith(`${LIVE}:steer:`) && row.includes("quest_desk_parent1"))).toBe(true)
    expect(hits.prompts.some((row) => row.startsWith(`${CHILD}:steer:`))).toBe(true)
    expect(hits.children).toBeGreaterThan(0)
    expect(hits.webhook).toBeGreaterThan(0)
  } finally {
    server.stop(true)
    rmSync(lockDir, { recursive: true, force: true })
  }
}, { timeout: 15_000 })

test("desk move rejection or wrong reported directory never sends a prompt", async () => {
  for (const reject of [true, false]) {
    let prompts = 0
    const server = Bun.serve({ port: 0, async fetch(request) {
      const path = new URL(request.url).pathname
      if (path === "/api/session" && request.method === "POST") return Response.json({ data: { id: "ses_binding", location: { directory: "C:/wrong" } } })
      if (path.endsWith("/move")) return reject ? new Response("move rejected", { status: 409 }) : Response.json({ data: {} })
      if (path.endsWith("/ses_binding")) return Response.json({ data: { id: "ses_binding", location: { directory: "C:/wrong" } } })
      if (path.endsWith("/prompt")) { prompts++; return Response.json({ data: {} }) }
      return new Response("not found", { status: 404 })
    } })
    try {
      const result = await callDeskTool(server.port, "session_start", { model: "cliproxyapi/gpt-5.6-sol", cwd: "C:/intended", text: "Edit", wait: 0 })
      expect(prompts).toBe(0)
      expect(JSON.stringify(result)).toMatch(/move rejected|Workspace binding failed/)
    } finally { server.stop(true) }
  }
})
