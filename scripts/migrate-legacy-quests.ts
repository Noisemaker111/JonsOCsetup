import { join, resolve } from "node:path"
import { discoverKnownQuestRoots, migrateLegacyQuestRoots, writeLegacyMigrationReport } from "../quest/legacy-ledger-migration"

const apply = process.argv.includes("--apply")
const reportArg = process.argv.find((arg) => arg.startsWith("--report="))?.slice("--report=".length)
const reportPath = resolve(reportArg || join(process.cwd(), "migration-reports", "legacy-quests-v1.json"))
const roots = discoverKnownQuestRoots(undefined, [process.cwd()])
const report = migrateLegacyQuestRoots(roots, apply)
writeLegacyMigrationReport(report, reportPath)
console.log(JSON.stringify({ schema: report.schema, version: report.version, mode: report.mode, reportPath, projects: report.projects.map(({ projectRoot, ledger, backupRoot, backupManifest, counts }) => ({ projectRoot, ledger, backupRoot, backupManifest, counts })) }, null, 2))
