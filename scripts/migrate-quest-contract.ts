import { QuestStore } from "../quest/store"
import { questRoot } from "../quest/root"
import { previewContractMigration, applyContractMigration } from "../quest/contract-migration"
const args = process.argv.slice(2)
const id = args.find(a => a.startsWith("--id="))?.slice(5)
if (!id) throw new Error("Usage: bun scripts/migrate-quest-contract.ts --id=<quest-id> [--apply --revision=<preview-revision>]")
const store = new QuestStore(questRoot())
const projectDirectory = args.find(a=>a.startsWith("--project-root="))?.slice(15)
if (args.includes("--apply")) {
  const value = args.find(a => a.startsWith("--revision="))?.slice(11)
  if (value === undefined || !/^\d+$/.test(value)) throw new Error("Apply requires --revision from the preview")
  const q = applyContractMigration(store, id, Number(value), projectDirectory)
  console.log(JSON.stringify({ id, revision: q.revision, contractVersion: q.contractVersion }))
} else console.log(JSON.stringify(previewContractMigration(store, id, projectDirectory), null, 2))
