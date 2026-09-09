#!/usr/bin/env bun
import { renderPapercutScreen, renderPapercutText, replayPapercut, createPapercutFollowup } from "../papercut/papercut-ui"
import { questRoot } from "../quest/root"
const args = Bun.argv.slice(2), value = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined }
async function main(argv = args) { const id = value("--id"), detail = argv.includes("--detail"), filters = { repo: value("--repo"), family: value("--family"), errorSignature: value("--error-signature"), state: value("--state") as any, confidence: value("--confidence") ? Number(value("--confidence")) : undefined, limit: value("--limit") ? Number(value("--limit")) : undefined }; if (argv.includes("--replay")) { console.log(JSON.stringify(await replayPapercut(id || "", { solutionIndex: Number(value("--solution") || 0), confirm: value("--confirm") }), null, 2)); return }; if (argv.includes("--follow-up")) { const q = createPapercutFollowup(id || "", questRoot()); console.log(JSON.stringify(q || { error: "Only unresolved papercuts can create follow-up Quests." }, null, 2)); return }; console.log(renderPapercutText(renderPapercutScreen(filters, undefined, detail ? id : undefined))) }
if (import.meta.main) main().catch(error => { console.error(String(error)); process.exitCode = 2 })
export { main }
