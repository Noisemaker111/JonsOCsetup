import { resolveHostExecutable } from '../project-router/executable.mjs'
/** Real native dispatch acceptance. Uses only this command's isolated --standalone host. */
import { join, resolve } from "node:path"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { Database } from "bun:sqlite"
import { QuestStore } from "../quest/store"
import { projectIdentity } from "../quest/project"
import { agentForModel } from "../quest/spawn"
import { reasoningEffortFor } from "../orchestration/dispatch"
const root = resolve(import.meta.dir, "..")
const configRoot = join(homedir(), ".config", "opencode")
const requested = process.argv[2] ?? "cliproxyapi/gpt-6-astra"
const [model, variant, ...extra] = requested.split("#")
if (extra.length || !model) throw new Error("Expected provider/model or provider/model#reasoning")
agentForModel(model) // Reject unpinned routes before starting a host.
const [providerID, modelID] = model.split("/")
const expected = reasoningEffortFor(providerID!, modelID!, variant)
const cwd = join(root, ".visual-e2e", `native-dispatch-${Date.now()}`)
mkdirSync(cwd, { recursive: true })
const store = new QuestStore(cwd)
const quest = store.create({ id: "01j00000000000000000000998", title: "Native model route probe", objective: "Reply exactly DISPATCH_ROUTE_OK without editing files or calling tools.", kind: "investigation", project: projectIdentity(cwd), stages: [{ id: "probe", title: "Verify the exact native route", detail: "Reply exactly DISPATCH_ROUTE_OK without editing files or calling tools.", status: "pending", needs: [] }] })
const prompt = `Use existing Quest ${quest.id}. Call quest action=run with id=${quest.id} and run={model:"${requested}"}. Wait for the worker result. Do not create another Quest.`
const proc = Bun.spawn([resolveHostExecutable(), "run", "--standalone", "--auto", "--agent", "quest-giver", "-m", "cliproxyapi/gpt-5.6-sol", prompt], {
  // Every real home, or the check writes into one of them: the ledger and log were redirected
  // and the session database, telemetry and state were not.
  cwd, env: { ...process.env, OPENCODE_CONFIG_DIR: configRoot, OPENCODE_QUEST_ROOT: cwd, OPENCODE_ORCHESTRATION_LEDGER: join(cwd, "orchestration.jsonl"), OPENCODE_DB: join(cwd, "host.db"), OPENCODE_TELEMETRY_FILE: join(cwd, "requests.jsonl"), XDG_STATE_HOME: join(cwd, "state"), CLAUDE_CODE_BRIDGE_PORT: "0" },
  stdin: "ignore", stdout: "pipe", stderr: "pipe", windowsHide: true,
})
const timer = setTimeout(() => proc.kill(), 150000)
try {
  const [code, out, err] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  const session = store.read(quest.id)?.sessions.find((row) => `${row.providerID}/${row.modelID}` === model && row.reasoningEffort === expected.reasoningEffort)
  const db = new Database(join(homedir(), ".local/share/opencode/opencode.db"), { readonly: true })
  const rows = db.query("select m.type,m.data from session_message m join session_v2 s on s.id=m.session_id where s.id in (?,?) order by m.time_created").all(session?.parentID ?? "", session?.openCodeSessionId ?? "") as { type: string; data: string }[]
  db.close()
  const messages = rows.map((row) => ({ type: row.type, data: JSON.parse(row.data) }))
  const observed = messages.filter((row) => row.type === "assistant").map((row) => ({ agent: row.data.agent, model: row.data.model, content: row.data.content }))
  const checks = {
    completed: code === 0 && session?.state === "completed" && observed.some((row) => row.agent === agentForModel(model) && JSON.stringify(row.content).includes("DISPATCH_ROUTE_OK")),
    ledger: session?.reasoningEffort === expected.reasoningEffort && (session?.fast === true) === expected.fast,
    observed: observed.some((row) => `${row.model?.providerID}/${row.model?.id}` === model),
    exactRequest: session?.model === requested,
    hostAgent: observed.some((row) => row.agent === agentForModel(model) && `${row.model?.providerID}/${row.model?.id}` === model && row.model?.variant === variant),
  }
  const ok = Object.values(checks).every(Boolean)
  const report = join(cwd, "report.json")
  writeFileSync(report, JSON.stringify({ ok, code, requested, model, variant, checks, session, observed, out, err, activation: JSON.parse(readFileSync(join(configRoot, "plugin-activation.json"), "utf8")) }, null, 2))
  console.log(JSON.stringify({ ok, requested, checks, report }, null, 2))
  process.exitCode = ok ? 0 : 1
} finally { clearTimeout(timer) }
