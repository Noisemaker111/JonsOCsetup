/** Run one pass of the self-improving incident loop: detect -> auto-intake as a diagnosis Quest -> print. Safe to run on any interval; auto-intake is deduplicated (quest/store.ts admit()), so a repeat pass never creates duplicate Quests. Fixes for system-owning code stay gated behind orchestration/apply-gate.ts until Jk approves. */
import { homedir } from "node:os"
import { detectIncidents, runIncidentLoop, type DetectOptions } from "../orchestration/incident-loop"

const projectRoot = process.argv[2] || homedir()
const opts: DetectOptions = { papercutRepo: process.argv[3] }

const detected = detectIncidents(opts)
const results = runIncidentLoop(projectRoot, opts)

console.log(JSON.stringify({
  detected: detected.length,
  created: results.filter((r) => r.created).length,
  deduplicated: results.filter((r) => !r.created).length,
  quests: results.map((r) => ({ questID: r.quest.id, created: r.created, source: r.incident.source, family: r.incident.family, occurrences: r.incident.occurrences, title: r.incident.title })),
}, null, 2))
