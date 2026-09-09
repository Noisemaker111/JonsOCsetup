import {recoverIncompleteClaim} from '../quest/journal'
const [runtimeRoot,questID,expectedSha256,...args]=process.argv.slice(2)
const apply=args.includes('--apply'),reason=args.filter(x=>x!=='--apply').join(' ')
if(!runtimeRoot||!questID||!expectedSha256||!reason)throw Error('Usage: bun scripts/quest-recover-journal.ts <runtime-root> <quest-id> <expected-sha256> <reason> [--apply]')
console.log(JSON.stringify(recoverIncompleteClaim(runtimeRoot,questID,{expectedSha256,reason,apply}),null,2))
