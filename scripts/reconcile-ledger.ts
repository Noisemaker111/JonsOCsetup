import { readFileSync } from "node:fs"
import { reconcileLedger, LEDGER_FILE } from "../orchestration/orchestration-ledger"

const statusPath = process.argv[2]
const payload = statusPath ? JSON.parse(readFileSync(statusPath, "utf8")) : {}
const result = reconcileLedger(LEDGER_FILE, payload)
console.log(JSON.stringify({ backup: result.backup, sourceRows: result.sourceRows, counts: result.counts, sample: result.records.slice(0, 5).map(({ parentID, callID, childID, disposition, resumeSessionID }) => ({ parentID, callID, childID, disposition, resumeSessionID })) }, null, 2))
