/**
 * The Quest board on the command line.
 *
 * Everything this does lives in `quest-api.mjs` as functions; this file only parses argv, prints and
 * picks an exit code. Code Mode and anything else composing calls should import the API directly
 * rather than spawning a process and parsing text back:
 *
 *   import { openBoard } from "<home>/.agents/quest-api.mjs"
 *
 * Output is deliberately terse — an agent reads it, and every token printed is paid for again on
 * every later turn of that agent's session. `--json` gives the same data machine-shaped.
 *
 * Exit codes: 0 done, 1 error, 2 usage, 3 contended (someone else holds that step).
 */
import { openBoard, BoardError } from "./quest-api.mjs"

const EXIT = { ok: 0, error: 1, usage: 2, held: 3 }
const CODE_EXIT = { usage: EXIT.usage, held: EXIT.held }

/** `--flag value`, `--flag=value`, `--flag` (true), `--` ends flags. Everything else is positional. */
function parseArgv(argv) {
  const positional = [], flags = {}
  const valued = new Set(["as", "project", "limit", "lease", "note", "result", "kind"])
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (token === "--") { positional.push(...argv.slice(i + 1)); break }
    if (!token.startsWith("--")) { positional.push(token); continue }
    const [name, inline] = token.slice(2).split(/=(.*)/s)
    if (inline !== undefined) flags[name] = inline
    else if (valued.has(name)) flags[name] = argv[++i]
    else flags[name] = true
  }
  return { positional, flags }
}

const truncate = (text, max) => { const value = String(text ?? "").replace(/\s+/g, " ").trim(); return value.length > max ? value.slice(0, max - 1) + "…" : value }
function age(iso) {
  const ms = Date.now() - Date.parse(iso ?? "")
  if (!Number.isFinite(ms) || ms < 0) return "-"
  const m = Math.round(ms / 60000)
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`
}
const write = (text) => process.stdout.write(text.endsWith("\n") ? text : text + "\n")
const holderTag = (holder) => holder ? ` @${holder.agent}${holder.harness && holder.harness !== holder.agent ? `/${holder.harness}` : ""} ${age(holder.since)}${holder.stale ? " stale" : ""}` : ""
const stepRow = (step) => `${step.n} ${step.status.padEnd(7)} ${step.id} ${truncate(step.title, 72)}${holderTag(step.holder)}`
const questRow = (quest) => {
  const holders = [...new Set(quest.steps.map((s) => s.holder?.agent).filter(Boolean))]
  return `${quest.id} ${quest.lane.padEnd(10)} ${quest.progress.done}/${quest.progress.total} ${truncate(quest.title, 64)}${holders.length ? ` @${holders.join(",")}` : ""}`
}

const { positional, flags } = parseArgv(process.argv.slice(2))
const command = positional[0]
if (!command || command === "help" || flags.help) { usage(); process.exit(command ? EXIT.ok : EXIT.usage) }

const emit = (value, lines) => write(flags.json ? JSON.stringify(value) : (lines.length ? lines.join("\n") : "none"))
const need = (value, text) => { if (!value) throw new BoardError(`usage: ${text}`, "usage"); return value }
const noteOf = (rest) => rest.join(" ").trim() || (typeof flags.note === "string" ? flags.note : "")
const shared = { project: typeof flags.project === "string" ? flags.project : undefined, limit: flags.limit }

let board
try { board = await openBoard({ agent: typeof flags.as === "string" ? flags.as : undefined }) }
catch (error) { process.stderr.write(`${error?.message ?? error}\n`); process.exit(EXIT.error) }

try {
  switch (command) {
    case "file": case "new": {
      const [, title, intent, ...steps] = positional
      need(title && intent, 'quest file "<outcome>" "<what was asked>" [step]...')
      const { outcome, quest } = board.file({ title, intent, steps })
      emit({ outcome, ...quest }, [`${quest.id} ${outcome} ${quest.state} ${truncate(quest.title, 72)}`])
      break
    }
    case "plan": {
      const [, id, ...steps] = positional
      need(id && steps.length, "quest plan <id> <step>...")
      const quest = board.plan(id, steps, { append: flags.append === true })
      emit(quest, quest.steps.map(stepRow))
      break
    }
    case "list": case "ls": {
      const rows = board.list({ ...shared, open: flags.open === true, mine: flags.mine === true, blocked: flags.blocked === true, all: flags.all === true })
      emit(rows, rows.map(questRow))
      break
    }
    case "read": case "show": {
      const quest = board.read(need(positional[1], "quest read <id>"))
      const lines = [`${quest.id} ${quest.state}/${quest.lane} ${quest.progress.done}/${quest.progress.total} ${truncate(quest.title, 72)}`]
      if (flags.full) lines.push(`objective: ${quest.objective}`)
      lines.push(`next: ${truncate(quest.nextAction, 100)}`)
      lines.push(...quest.steps.map((step) => stepRow(step) + (flags.full && step.note ? `\n    ${truncate(step.note, 160)}` : "")))
      emit(quest, lines)
      break
    }
    case "claim": {
      const [, id, ref] = positional
      need(id && ref, "quest claim <id> <step> [--as <agent>] [--note <text>] [--lease <minutes>] [--force]")
      const result = board.claim(id, ref, { note: typeof flags.note === "string" ? flags.note : undefined, lease: flags.lease, force: flags.force === true })
      if (result.outcome === "held") {
        emit(result, [`held ${result.step} @${result.holder.agent} ${age(result.holder.since)}`])
        process.exit(EXIT.held)
      }
      emit(result, [`${result.outcome} ${result.quest} ${result.step} @${result.agent} lease ${result.lease}m${result.warning ? ` (${result.warning})` : ""}`])
      break
    }
    case "progress": {
      const [, id, ref, ...rest] = positional
      need(id && ref && noteOf(rest), "quest progress <id> <step> <note>")
      const result = board.progress(id, ref, noteOf(rest), { lease: flags.lease, force: flags.force === true })
      emit(result, [`progress ${result.step} @${result.agent}`])
      break
    }
    case "evidence": {
      const [, id, ref, ...rest] = positional
      const proof = rest.join(" ").trim()
      need(id && ref && proof, "quest evidence <id> <step> <command> [--result passed|failed] [--kind command|run|judgment]")
      const result = board.evidence(id, ref, proof, { result: flags.result, kind: flags.kind, force: flags.force === true })
      emit(result, [`evidence ${result.step} ${result.kind}${result.result ? ` ${result.result}` : ""}`])
      break
    }
    case "done": {
      const [, id, ref, ...rest] = positional
      need(id && ref, "quest done <id> <step> [note]")
      const result = board.done(id, ref, noteOf(rest), { force: flags.force === true })
      emit(result, [`done ${result.step} ${result.progress.done}/${result.progress.total} next: ${truncate(result.nextAction, 80)}`])
      break
    }
    case "block": {
      const [, id, ref, ...rest] = positional
      need(id && ref && noteOf(rest), "quest block <id> <step> <reason>")
      const result = board.block(id, ref, noteOf(rest), { force: flags.force === true })
      emit(result, [`blocked ${result.step} ${truncate(result.blocked, 80)}`])
      break
    }
    case "release": {
      const [, id, ref, ...rest] = positional
      need(id && ref, "quest release <id> <step> [reason]")
      const result = board.release(id, ref, noteOf(rest), { force: flags.force === true })
      emit(result, [`${result.outcome} ${result.step}${result.reason ? ` ${truncate(result.reason, 80)}` : ""}`])
      break
    }
    case "who": case "whoami": {
      const rows = board.who({ ...shared, mine: flags.mine === true })
      emit(rows, rows.map((r) => `${r.agent.padEnd(8)} ${r.quest} ${r.step} ${age(r.since)}${r.stale ? " stale" : ""} ${truncate(r.doing ?? r.questTitle, 60)}`))
      break
    }
    default: throw new BoardError(`unknown command: ${command}. Run \`quest help\`.`, "usage")
  }
} catch (error) {
  process.stderr.write(`${error?.message ?? error}\n`)
  process.exit(CODE_EXIT[error?.code] ?? EXIT.error)
}

function usage() {
  write([
    "quest — the shared Quest board, for Claude, Codex and OpenCode alike.  bun ~/.agents/quest.mjs <command>",
    "",
    '  file "<outcome>" "<what was asked>" [step]...   file it (deduped on the request); do this as intent is stated',
    "  plan <id> <step>...                             set the steps [--append]",
    "  list [--mine] [--open] [--blocked]              the board [--project <path|.>] [--all] [--limit n]",
    "  read <id> [--full]                              one quest and its steps",
    "  claim <id> <step> [--note <text>]               take a step; exits 3 if held [--lease <min>] [--force]",
    "  progress <id> <step> <note>                     report and renew the lease",
    "  evidence <id> <step> <command> [--result ...]   attach a proof to the step",
    "  done <id> <step> [note]                         finish the step and release it",
    "  block <id> <step> <reason>                      mark it blocked, keep the hold",
    "  release <id> <step> [reason]                    hand it back unfinished",
    "  who [--mine] [--project <path|.>]               who is holding what right now",
    "",
    "  --json on any command.  --as <agent> or QUEST_AGENT names you; the harness is detected otherwise.",
    "  Steps are named by id, 1-based position, or a unique title prefix.",
    "  OPENCODE_QUEST_RELEASE pins the release; OPENCODE_QUEST_ROOT pins the ledger parent.",
    "",
    "  Composing calls rather than reading text? Import the API instead of spawning this:",
    '    import { openBoard } from "<home>/.agents/quest-api.mjs"',
    "    const board = await openBoard(); const { quest } = board.file({ title, intent, steps })",
  ].join("\n"))
}
