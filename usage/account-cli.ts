/** Programmatic CLI for the shared account API. Never returns credentials. */
import { getAccountUsage, readAccountUsage, formatAccountUsage } from "./account-api"
export async function main(args = process.argv.slice(2)) {
  let accountID: string | undefined
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--account" && args[i + 1] && !args[i + 1].startsWith("--")) { accountID = args[++i]; continue }
    if (!["--refresh", "--cached", "--text", "--json"].includes(args[i])) throw new Error("Usage: runtime:usage [--refresh | --cached] [--json | --text] [--account ID]")
  }
  if (args.includes("--refresh") && args.includes("--cached")) throw new Error("--refresh and --cached are mutually exclusive")
  const snapshot = args.includes("--cached") ? readAccountUsage() : await getAccountUsage({ refresh: args.includes("--refresh") })
  if (accountID) {
    snapshot.accounts = snapshot.accounts.filter(a => a.id === accountID)
    if (!snapshot.accounts.length) throw new Error("Account is not in the current connection inventory")
  }
  console.log(args.includes("--text") ? formatAccountUsage(snapshot) : JSON.stringify(snapshot, null, 2))
}
if (import.meta.main) main().catch(() => { console.error("Account usage query failed. Check arguments or the shared cache directory."); process.exitCode = 1 })
