// Local search + launch bar. Models only used when the PC search has nothing useful.
// bun ~/.config/opencode/cliproxyapi/search-shim.ts

import { homedir } from "node:os"
import { join, basename } from "node:path"
import { readdir, readFile, stat } from "node:fs/promises"

const PORT = Number(process.env.SEARCH_SHIM_PORT ?? 8320)
const CLIPROXY = process.env.CLIPROXY_URL ?? "http://127.0.0.1:8317/v1"
const GROKPROXY = process.env.GROK_SUB_PROXY_URL ?? "http://127.0.0.1:3011/v1"
const DEFAULT_MODEL = process.env.SEARCH_SHIM_MODEL ?? "claude-haiku-4-5-20251001"
const KEY = "local"
const HOME = homedir()
const PROJECT_ROOT = join(HOME, "Projects")

type ChatMsg = { role: "system" | "user" | "assistant"; content: string }
type Hit = {
  name: string
  path?: string
  launch: string
  kind: "app" | "game" | "folder" | "file"
}

let index: Hit[] = []

function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

function needle(q: string) {
  return norm(q)
    .replace(/^(where is|where are|wheres|where's|find|locate|open|run|launch|start|go to|show me|show)\s+/, "")
    .replace(/\s+(at|located|installed|folder|directory|path)$/, "")
    .replace(/\s+at$/, "")
    .trim()
}

function intent(q: string): "where" | "run" | "ask" {
  const n = q.trim().toLowerCase()
  if (/^(open|run|launch|start|play)\b/.test(n)) return "run"
  if (/^(where|find|locate)\b/.test(n) || /\bat$/.test(n)) return "where"
  if (/\?$/.test(n) || /^(what|how|why|who|when)\b/.test(n)) return "ask"
  return "where"
}

function score(name: string, q: string) {
  const a = norm(name)
  const b = q
  if (!b) return 0
  if (a === b) return 100
  if (a.startsWith(b)) return 85
  if (a.includes(b)) return 70
  const toks = b.split(" ").filter((t) => t.length > 1)
  if (toks.length && toks.every((t) => a.includes(t))) return 65
  const compact = (s: string) => s.replace(/ /g, "")
  if (compact(a).includes(compact(b))) return 55
  return 0
}

function searchHits(q: string, limit = 12): Hit[] {
  const n = needle(q)
  if (n.length < 2) {
    if (/\bprojects?\b/.test(norm(q))) return index.filter((h) => h.path?.startsWith(PROJECT_ROOT)).slice(0, limit)
    return []
  }
  return index
    .map((h) => ({ h, s: Math.max(score(h.name, n), h.path ? score(basename(h.path), n) : 0) }))
    .filter((x) => x.s >= 55)
    .sort((a, b) => {
      if (b.s !== a.s) return b.s - a.s
      const run = (h: Hit) => (h.launch.startsWith("steam://") || h.kind === "app" ? 1 : 0)
      return run(b.h) - run(a.h)
    })
    .slice(0, limit)
    .map((x) => x.h)
}

function formatHits(hits: Hit[]) {
  return hits
    .map((h) => {
      const loc = h.path || h.launch
      return `${h.name}\n  ${loc}`
    })
    .join("\n")
}

function shouldLaunch(q: string, hits: Hit[]) {
  if (!hits[0]) return false
  const i = intent(q)
  if (i === "run") return true
  if (i === "where" || i === "ask") return false
  const n = needle(q)
  const top = norm(hits[0].name)
  return (hits[0].kind === "game" || hits[0].kind === "app") && (top === n || top.startsWith(n) || n.startsWith(top))
}

function decide(q: string) {
  const hits = searchHits(q)
  return { hits, launch: shouldLaunch(q, hits) }
}

function systemPrompt(hits: Hit[], launched?: string) {
  const found = hits.length ? `\nPC search hits:\n${formatHits(hits)}` : "\nNo local hits."
  const ran = launched ? `\nAlready launched: ${launched}` : ""
  return `You are the AI search bar on Jon's Windows PC. Always answer. 1-3 short sentences. Use PC search hits when present — real paths, never "check Documents/Desktop/This PC". If something was launched, confirm it. Projects root: ${PROJECT_ROOT}.${found}${ran}`
}

async function addDir(kind: Hit["kind"], dir: string, name?: string) {
  try {
    if ((await stat(dir)).isDirectory()) {
      index.push({ name: name || basename(dir), path: dir, launch: dir, kind })
    }
  } catch {}
}

async function loadSteam() {
  const vdf = "C:\\Program Files (x86)\\Steam\\steamapps\\libraryfolders.vdf"
  let libs = ["C:\\Program Files (x86)\\Steam"]
  try {
    const txt = await readFile(vdf, "utf8")
    for (const m of txt.matchAll(/"path"\s+"([^"]+)"/g)) libs.push(m[1].replace(/\\\\/g, "\\"))
    libs = [...new Set(libs)]
  } catch {}
  for (const lib of libs) {
    const common = join(lib, "steamapps", "common")
    const apps = join(lib, "steamapps")
    try {
      for (const name of await readdir(common)) {
        if (name.startsWith(".") || name.startsWith("Steam")) continue
        await addDir("game", join(common, name), name)
      }
    } catch {}
    try {
      for (const f of await readdir(apps)) {
        if (!/^appmanifest_\d+\.acf$/.test(f)) continue
        const txt = await readFile(join(apps, f), "utf8")
        const id = f.match(/\d+/)?.[0]
        const name = txt.match(/"name"\s+"([^"]+)"/)?.[1]
        const installdir = txt.match(/"installdir"\s+"([^"]+)"/)?.[1]
        if (!id || !name) continue
        const path = installdir ? join(common, installdir) : undefined
        index.push({ name, path, launch: `steam://rungameid/${id}`, kind: "game" })
      }
    } catch {}
  }
}

async function loadProjects() {
  await addDir("folder", PROJECT_ROOT, "Projects")
  try {
    for (const name of await readdir(PROJECT_ROOT)) {
      if (name.startsWith(".")) continue
      await addDir("folder", join(PROJECT_ROOT, name), name)
    }
  } catch {}
}

async function loadStartApps() {
  try {
    const ps = Bun.spawn(
      ["powershell", "-NoProfile", "-Command", "Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress"],
      { stdout: "pipe", stderr: "pipe", windowsHide: true },
    )
    const text = await new Response(ps.stdout).text()
    const parsed = JSON.parse(text)
    const arr = Array.isArray(parsed) ? parsed : [parsed]
    for (const a of arr) {
      if (!a?.Name || !a?.AppID) continue
      const id = String(a.AppID)
      index.push({
        name: String(a.Name),
        launch: id.startsWith("steam://") ? id : `shell:AppsFolder\\${id}`,
        kind: id.startsWith("steam://") ? "game" : "app",
      })
    }
  } catch (e) {
    console.log("[search-shim] start apps failed", e)
  }
}

async function buildIndex() {
  index = []
  await loadSteam()
  await loadProjects()
  await loadStartApps()
  const seen = new Set<string>()
  index = index.filter((h) => {
    const k = `${h.kind}|${norm(h.name)}|${h.launch}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  console.log(`[search-shim] indexed ${index.length} items`)
}

function runHit(hit: Hit) {
  const target = hit.launch
  if (target.startsWith("steam://") || target.startsWith("shell:")) {
    Bun.spawn(["cmd.exe", "/c", "start", "", target], { stdout: "ignore", stderr: "ignore", windowsHide: true })
    return
  }
  Bun.spawn(["explorer.exe", target], { stdout: "ignore", stderr: "ignore", windowsHide: true })
}

function upstreamFor(model: string): string {
  return /^grok/i.test(model) ? GROKPROXY : CLIPROXY
}

async function probe(url: string): Promise<boolean> {
  const base = url.replace(/\/v1$/, "")
  for (const path of ["/v1/models", "/ping", "/health"]) {
    try {
      const r = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(1200) })
      if (r.ok) return true
    } catch {}
  }
  return false
}

async function models() {
  const out: { id: string; via: string }[] = []
  const seen = new Set<string>()
  const pull = async (url: string, via: string) => {
    try {
      const r = await fetch(`${url}/models`, { headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(2500) })
      if (!r.ok) return
      const j = (await r.json()) as { data?: { id: string }[] }
      for (const m of j.data ?? []) {
        if (seen.has(m.id)) continue
        seen.add(m.id)
        out.push({ id: m.id, via })
      }
    } catch {}
  }
  await pull(CLIPROXY, "cliproxyapi")
  await pull(GROKPROXY, "grok-sub")
  if (!seen.has("grok-4.6")) out.unshift({ id: "grok-4.6", via: "grok-sub" })
  return out
}

function extractPrompt(msg: any): string {
  if (!msg || typeof msg !== "object") return ""
  if (typeof msg.text === "string" && msg.text.trim()) return msg.text
  const c = msg.content
  if (typeof c === "string") return c
  if (Array.isArray(c)) return c.map((p) => (typeof p === "string" ? p : p?.text || "")).filter(Boolean).join("\n")
  return ""
}

async function complete(model: string, messages: ChatMsg[], onDelta: (t: string) => void): Promise<string> {
  const url = `${upstreamFor(model)}/chat/completions`
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: true, max_tokens: 256 }),
  })
  if (!r.ok || !r.body) throw new Error(`${r.status} ${(await r.text().catch(() => r.statusText)).slice(0, 300)}`)
  const reader = r.body.getReader()
  const dec = new TextDecoder()
  let buf = ""
  let full = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const parts = buf.split("\n")
    buf = parts.pop() ?? ""
    for (const line of parts) {
      const s = line.trim()
      if (!s.startsWith("data:")) continue
      const data = s.slice(5).trim()
      if (!data || data === "[DONE]") continue
      try {
        const t = JSON.parse(data).choices?.[0]?.delta?.content ?? ""
        if (t) {
          full += t
          onDelta(t)
        }
      } catch {}
    }
  }
  return full
}

const PAGE = `<!doctype html>
<meta charset="utf-8">
<title>Ask</title>
<style>
  :root { color-scheme: dark; }
  html,body { margin:0; height:100%; font:14px/1.4 "Segoe UI Variable","Segoe UI",sans-serif; color:#f3f3f3; }
  body { display:flex; align-items:flex-start; justify-content:center; padding:10vh 16px; background:#11161c; }
  .shell { width:min(760px,100%); background:#1c1c1ccc; backdrop-filter:blur(28px); border:1px solid #ffffff22; border-radius:16px; box-shadow:0 24px 80px #0008; overflow:hidden; }
  .bar { display:flex; gap:10px; align-items:center; padding:14px 16px; border-bottom:1px solid #ffffff14; }
  .bar input { flex:1; background:transparent; border:0; outline:0; color:inherit; font:16px inherit; }
  select, button { background:#ffffff12; color:inherit; border:1px solid #ffffff18; border-radius:8px; padding:6px 10px; cursor:pointer; }
  .hint { padding:8px 16px; color:#b9c0c7; font-size:12px; }
  .hits { padding:0 12px 12px; display:flex; flex-direction:column; gap:6px; }
  .hit { display:flex; gap:8px; align-items:center; text-align:left; padding:8px 10px; border-radius:10px; border:1px solid #ffffff14; background:#ffffff08; width:100%; }
  .hit:hover, .hit.active { background:#2b6cb055; border-color:#6ab; }
  .hit b { min-width:52px; font-size:11px; opacity:.7; text-transform:uppercase; }
  .hit span { flex:1; }
  .hit small { opacity:.55; font-size:11px; }
  .out { padding:4px 16px 16px; white-space:pre-wrap; }
</style>
<div class="shell">
  <div class="bar">
    <input id="q" autofocus placeholder="Ask this PC — search, run, anything. Enter = AI." />
    <select id="model"></select>
    <button id="ask">Ask</button>
  </div>
  <div class="hint">Enter = AI (Haiku, with live PC hits) · click a row to launch now</div>
  <div class="hits" id="hits"></div>
  <div class="out" id="out"></div>
</div>
<script>
const q = document.getElementById('q');
const out = document.getElementById('out');
const hitsEl = document.getElementById('hits');
const model = document.getElementById('model');
let hits = [];
let active = 0;
fetch('/models').then(r=>r.json()).then(list => {
  const prefer = ['claude-haiku-4-5-20251001','gpt-5.6-luna','grok-4.6','gpt-5.6-sol'];
  const ids = [...new Set([...prefer.filter(p => list.some(x => x.id===p)), ...list.map(x=>x.id)])];
  model.innerHTML = ids.map(id => '<option>'+id+'</option>').join('');
  model.value = '${DEFAULT_MODEL}';
}).catch(()=>{ model.innerHTML = '<option>${DEFAULT_MODEL}</option>'; });

function render() {
  hitsEl.innerHTML = hits.map((h,i) => {
    const loc = (h.path || h.launch || '').replace(/[<>]/g,'');
    return '<button class="hit'+(i===active?' active':'')+'" data-i="'+i+'"><b>'+h.kind+'</b><span>'+h.name.replace(/[<>]/g,'')+'<br><small>'+loc+'</small></span></button>';
  }).join('');
}
async function lookup() {
  const text = q.value.trim();
  if (text.length < 2) { hits = []; render(); return; }
  const s = await fetch('/search?q='+encodeURIComponent(text)).then(r=>r.json());
  hits = s.hits || [];
  active = 0;
  render();
}
function run(h) {
  if (!h) return;
  fetch('/run', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(h) });
  out.textContent = 'Launching '+h.name;
}
async function askAi() {
  const text = q.value.trim();
  if (!text) return;
  out.textContent = '';
  const res = await fetch('/v1/chat/completions', {
    method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ model: model.value, stream:true, messages:[{role:'user', content:text}] })
  });
  if (!res.ok || !res.body) { out.textContent = 'error '+res.status; return; }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    buf += dec.decode(value, {stream:true});
    const lines = buf.split('\\n'); buf = lines.pop() || '';
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith('data:')) continue;
      const data = s.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try { const t = JSON.parse(data).choices?.[0]?.delta?.content || ''; if (t) out.textContent += t; } catch {}
    }
  }
}
q.addEventListener('input', lookup);
hitsEl.addEventListener('click', e => {
  const b = e.target.closest('[data-i]');
  if (!b) return;
  run(hits[+b.dataset.i]);
});
q.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active+1, hits.length-1); render(); }
  if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active-1, 0); render(); }
  if (e.key === 'Enter') { e.preventDefault(); askAi(); }
});
document.getElementById('ask').onclick = askAi;
</script>`

const sessions = new Map<unknown, { history: ChatMsg[]; model: string }>()

const server = Bun.serve({
  port: PORT,
  idleTimeout: 255,
  async fetch(req, server) {
    const url = new URL(req.url)
    if (url.pathname === "/copilot" && server.upgrade(req)) return undefined
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } })
    }
    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        defaultModel: DEFAULT_MODEL,
        indexed: index.length,
        cliproxy: await probe(CLIPROXY),
        grok: await probe(GROKPROXY),
      })
    }
    if (url.pathname === "/models") return Response.json(await models())
    if (url.pathname === "/search") {
      const q = url.searchParams.get("q") || ""
      return Response.json({ q, ...decide(q) })
    }
    if (url.pathname === "/run" && req.method === "POST") {
      const hit = (await req.json()) as Hit
      if (!hit?.launch && !hit?.path) return Response.json({ error: "hit" }, { status: 400 })
      runHit({ ...hit, launch: hit.launch || hit.path || "" })
      return Response.json({ ok: true, launched: hit.name })
    }
    if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
      const body = (await req.json()) as { model?: string; messages?: ChatMsg[]; stream?: boolean }
      const model = body.model || DEFAULT_MODEL
      const lastUser = [...(body.messages ?? [])].reverse().find((m) => m.role === "user")?.content ?? ""
      const d = decide(lastUser)
      let launched: string | undefined
      if (d.launch && d.hits[0]) {
        runHit(d.hits[0])
        launched = d.hits[0].name
      }
      const messages: ChatMsg[] = [{ role: "system", content: systemPrompt(d.hits, launched) }, ...(body.messages ?? [])]
      if (body.stream === false) {
        let full = ""
        await complete(model, messages, (t) => { full += t })
        return Response.json({
          id: "shim",
          object: "chat.completion",
          choices: [{ index: 0, message: { role: "assistant", content: full }, finish_reason: "stop" }],
        })
      }
      const stream = new ReadableStream({
        async start(controller) {
          const send = (obj: unknown) => controller.enqueue(`data: ${JSON.stringify(obj)}\n\n`)
          try {
            await complete(model, messages, (t) => {
              send({ id: "shim", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: t } }] })
            })
            controller.enqueue("data: [DONE]\n\n")
          } catch (e) {
            send({ error: { message: String(e) } })
          }
          controller.close()
        },
      })
      return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } })
    }
    return new Response("not found", { status: 404 })
  },
  websocket: {
    open(ws) {
      sessions.set(ws, { history: [{ role: "system", content: systemPrompt([], undefined) }], model: DEFAULT_MODEL })
    },
    close(ws) {
      sessions.delete(ws)
    },
    async message(ws, raw) {
      let msg: any
      try { msg = JSON.parse(String(raw)) } catch { return }
      if (msg.event === "setOptions" || msg.event === "reportLocalConsents") return
      const prompt = extractPrompt(msg)
      if (!prompt.trim()) return
      const data = sessions.get(ws) ?? { history: [{ role: "system", content: systemPrompt([], undefined) }] as ChatMsg[], model: DEFAULT_MODEL }
      const d = decide(prompt)
      const id = crypto.randomUUID()
      const sendText = (t: string) => ws.send(JSON.stringify({ event: "appendText", text: t, messageId: id }))
      let launched: string | undefined
      if (d.launch && d.hits[0]) {
        runHit(d.hits[0])
        launched = d.hits[0].name
      }
      data.history[0] = { role: "system", content: systemPrompt(d.hits, launched) }
      data.history.push({ role: "user", content: prompt })
      try {
        let acc = ""
        await complete(data.model, data.history, (t) => { acc += t; sendText(t) })
        data.history.push({ role: "assistant", content: acc })
        ws.send(JSON.stringify({ event: "done", messageId: id }))
      } catch (e) {
        sendText(String(e))
        ws.send(JSON.stringify({ event: "done", messageId: id }))
      }
    },
  },
})

await buildIndex()
console.log(`[search-shim] http://127.0.0.1:${server.port}  items=${index.length}`)
