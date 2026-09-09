#!/usr/bin/env bun
import { QuestStore } from "./store"
import { questRoot } from "./root"
import { generateQuestIndex, readAllQuests } from "./index"
import { requestFingerprint } from "./privacy"
import { inferQuestKind } from "./schema"
import { previewMigration } from "./migration"
import { applyMigration } from "./migration-apply"
import { summarizeBoard, summarizeQuest } from "./board"
import { runQuestCommand } from "./commands"
const root = questRoot(), store = new QuestStore(root), args = process.argv.slice(2)
// Disclose which ledger answered, so a wrong-root situation is visible in
// output instead of a silent guess -- same discipline as the native `quest`
// tool's ledgerRoot field.
const withRoot = (value: unknown) => (value && typeof value === "object" && !Array.isArray(value)) ? { ...value, ledgerRoot: root } : value
function print(value: unknown) { console.log(JSON.stringify(withRoot(value), null, 2)) }
function printCompact(value: unknown) { console.log(JSON.stringify(withRoot(value))) }
function quests() { return readAllQuests(root).flatMap((x) => x.quest ? [x.quest] : []) }
const cmd = args.shift() ?? "list"
if(cmd==="api"){const input=JSON.parse(await Bun.stdin.text());console.log(JSON.stringify(await (await import("./cli-api")).runTypedQuestCLI(input)))}
else if (cmd === "create" || cmd === "admit" || cmd === "prepend") {
  const title = args.join(" ") || "Untitled Quest"
  print(store.admit({ title, objective: title, kind: inferQuestKind(title), requestFingerprint: requestFingerprint({ title, objective: title }) }))
} else if (cmd === "view") print(runQuestCommand(store, "view", args[0]))
else if (cmd === "accept" || cmd === "assign") print(runQuestCommand(store, "accept", args[0], { owner: args[1] }))
else if (cmd === "execute" || cmd === "start" || cmd === "start-session") print(runQuestCommand(store, "start-session", args[0], { sessionID: args[1], callID: args[2], role: args[3] ?? "worker" }))
else if (cmd === "resume" || cmd === "reopen") print(runQuestCommand(store, "reopen", args[0], { reason: "Explicitly reopened", nextAction: "Assign an exact linked session" }))
else if (cmd === "abandon") print(runQuestCommand(store, "abandon", args[0], { reason: args.slice(1).join(" ") || undefined }))
else if (cmd === "archive") print(runQuestCommand(store, "archive", args[0], { reason: args.slice(1).join(" ") || undefined }))
else if (cmd === "delete") print(runQuestCommand(store, "delete", args[0], { confirmed: args.includes("--confirm") }))
else if (cmd === "turn-in" || cmd === "turn in") print(runQuestCommand(store, "turn-in", args[0], { reason: args.slice(1).join(" ") || "Explicitly turned in by user" }))
else if (cmd === "complete") print(runQuestCommand(store, "complete", args[0]))
else if (cmd === "refresh" || cmd === "get") printCompact(store.read(args[0]))
else if (cmd === "step") {
  // Harness-CLI worker path (Claude Code/Codex/Grok): no in-process `quest`
  // tool exists there, so this CLI is the native equivalent of
  // quest(action="step") for a subprocess caller. Keep the argument order in
  // step with opencode-mcp-stdio.mjs's `quest` tool.
  const api = (await import("./agent-api")).createQuestAgentAPI(root)
  if(!args[2])throw new Error("Explicit step state is required")
  printCompact(api.step(args[0], args[1], args[2], args.slice(3).join(" ") || undefined))
}
else if (cmd === "evidence") {
  const api = (await import("./agent-api")).createQuestAgentAPI(root)
  printCompact(api.evidence(args[0], args[1], args.slice(2).join(" ")))
}
else if (cmd === "report") {
  // Apply a whole `STEP <id>: done — evidence` / `TESTS: cmd — passed` block
  // in one call instead of one step/evidence CLI invocation per line.
  const api = (await import("./agent-api")).createQuestAgentAPI(root)
  printCompact(api.report(args[0], args.slice(1).join(" ")))
}
else if (cmd === "mappings" || cmd === "map" || cmd === "claims") {
  // Keep the terminal escape hatch equivalent to quest(action=mappings). The
  // old fall-through printed board summaries, which hid the exact owner and
  // file claims an agent must inspect before editing or staging.
  const api = (await import("./agent-api")).createQuestAgentAPI(root)
  printCompact(api.mappings(args[0] ? { questID: args[0] } : {}))
}
else if (cmd === "index") console.log(generateQuestIndex(root))
else if (cmd === "migrate-preview") print(previewMigration(root))
else if (cmd === "migrate-apply") print(applyMigration(root))
else if (cmd === "list" || cmd === "board") printCompact(summarizeBoard(quests(), args[0]))
else print(quests().map(summarizeQuest))
