/** One OAuth account store for OpenCode's local CLIProxyAPI broker. Never imports vendor API keys. */
import { spawn } from "node:child_process"
import { getAccountUsage } from "../usage/account-api"
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, unlinkSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve, sep } from "node:path"
import { createHash, randomUUID } from "node:crypto"

export const ACCOUNT_SLOTS = {
  "grok-gmail": { provider: "xai", label: "Grok Gmail — $30 plan", login: "-xai-login" },
  "grok-x": { provider: "xai", label: "Grok X/Yahoo — X Premium", login: "-xai-login" },
} as const
export function accountIdentity(credential: any): string | undefined {
  const value = credential.email ?? credential.account_id ?? credential.user_id
  if (typeof value !== "string" || !value.trim()) return
  return createHash("sha256").update(`${credential.type}:${value.trim().toLowerCase()}`).digest("hex")
}
export function labeledCredential(credential: any, slot: keyof typeof ACCOUNT_SLOTS) {
  if (credential.type !== ACCOUNT_SLOTS[slot].provider || !credential.refresh_token || credential.api_key || credential["api-key"]) throw new Error("Login did not return the required OAuth account")
  if (!accountIdentity(credential)) throw new Error("OAuth response has no stable account identity; cannot safely label it")
  return { ...credential, prefix: slot, label: ACCOUNT_SLOTS[slot].label }
}
function brokerConfig() {
  const root = resolve(import.meta.dir, "..")
  const config = Bun.YAML.parse(readFileSync(join(root, "cliproxyapi/config.localhost.yaml"), "utf8")) as any
  const authDir = resolve(String(config["auth-dir"] ?? "~/.cli-proxy-api").replace(/^~(?=[\\/]|$)/, homedir()))
  if (!authDir.toLowerCase().startsWith((resolve(homedir()) + sep).toLowerCase())) throw new Error("Account store must be a directory inside the current user's home")
  return { config, authDir }
}
function credentials(authDir: string) {
  return readdirSync(authDir).filter((file) => file.endsWith(".json")).map((file) => ({ file, credential: JSON.parse(readFileSync(join(authDir, file), "utf8")) }))
}
async function privateDirectory(path: string) {
  mkdirSync(path, { recursive: true })
  if (process.platform !== "win32") throw new Error("This account workflow currently requires Windows ACL support")
  const command = '$acl = [System.Security.AccessControl.DirectorySecurity]::new(); $acl.SetAccessRuleProtection($true, $false); foreach ($sid in @([System.Security.Principal.WindowsIdentity]::GetCurrent().User, [System.Security.Principal.SecurityIdentifier]::new("S-1-5-18"))) { $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, "FullControl", "ContainerInherit,ObjectInherit", "None", "Allow"); $acl.AddAccessRule($rule) }; Set-Acl -LiteralPath $env:OPENCODE_PRIVATE_DIR -AclObject $acl'
  const child = Bun.spawn(["pwsh", "-NoProfile", "-Command", command], { env: { ...process.env, OPENCODE_PRIVATE_DIR: path }, stdout: "ignore", stderr: "pipe", windowsHide: true })
  if (await child.exited !== 0) throw new Error("Could not restrict the account directory to the current user and SYSTEM")
}
async function main() {
  const command = process.argv[2] ?? "status", slot = process.argv[3] as keyof typeof ACCOUNT_SLOTS
  if (command === "status") {
    const usage = await getAccountUsage()
    console.log(JSON.stringify({
      broker: "CLIProxyAPI",
      accounts: Object.entries(ACCOUNT_SLOTS).map(([id, spec]) => ({
        id, label: spec.label,
        state: usage.accounts.some(account => account.provider === "grok" && account.connections.some(connection => connection.owner === "broker" && connection.modelPrefix === id))
          ? "connected; entitlement must be verified" : "not connected",
      })),
      otherOAuthProviders: [...new Set(usage.accounts.filter(account => account.connections.some(connection => connection.owner === "broker") && ["openai", "claude"].includes(account.provider)).map(account => account.provider === "openai" ? "codex" : account.provider))],
      usage,
    }, null, 2))
    return
  }
  if (command !== "connect" || !(slot in ACCOUNT_SLOTS)) throw new Error("Usage: bun run runtime:accounts [status | connect grok-gmail | connect grok-x]")
  const { authDir } = brokerConfig()
  const slotSpec = ACCOUNT_SLOTS[slot]
  const executable = join(process.env.LOCALAPPDATA!, "CLIProxyAPI/cli-proxy-api.exe")
  if (!existsSync(executable)) throw new Error("The installed CLIProxyAPI executable was not found")
  const pending = join(homedir(), ".opencode/account-logins", `${slot}-${randomUUID()}`)
  await privateDirectory(pending)
  const pendingAuth = join(pending, "auth")
  await privateDirectory(pendingAuth)
  // Login only; this process does not start another proxy or copy a vendor CLI's tokens.
  const file = join(pending, "config.yaml")
  writeFileSync(file, Bun.YAML.stringify({ host: "127.0.0.1", port: 0, "auth-dir": pendingAuth, "remote-management": { "allow-remote": false, "secret-key": "" } }))
  console.log(`Connecting ${slotSpec.label}. Use that account in the vendor login page. No OpenCode vendor login is needed afterward.`)
  const env = { ...process.env }
  for (const key of ["XAI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]) delete env[key]
  const child = spawn(executable, ["-config", file, slotSpec.login, "-no-browser"], { env, windowsHide: true, stdio: ["inherit", "inherit", "inherit"] })
  const timer = setTimeout(() => child.kill(), 600000)
  const code = await new Promise((done, reject) => { child.once("error", reject); child.once("exit", done) }).finally(() => clearTimeout(timer))
  if (code !== 0) throw new Error(`OAuth login did not complete (${code}); existing accounts are unchanged`)
  const created = credentials(pendingAuth)
  if (created.length !== 1) throw new Error("OAuth login did not produce exactly one account; refusing to guess")
  const value = labeledCredential(created[0]!.credential, slot)
  const identity = accountIdentity(value)
  const existing = credentials(authDir)
  const duplicate = existing.find((r) => accountIdentity(r.credential) === identity)
  if (duplicate?.credential.prefix && duplicate.credential.prefix !== slot) throw new Error("That account is already assigned to the other account slot; sign in with the other account")
  const occupied = existing.find((r) => r.credential.prefix === slot && accountIdentity(r.credential) !== identity)
  if (occupied) throw new Error("This slot already belongs to another account; refusing to replace it")
  await privateDirectory(authDir)
  const target = join(authDir, duplicate?.file ?? `${slot}.json`), temporary = `${target}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n")
  renameSync(temporary, target)
  unlinkSync(join(pendingAuth, created[0]!.file))
  unlinkSync(file)
  console.log(`Connected ${slotSpec.label}. Broker prefix: ${slot}. Login is saved once in the broker account store; verify the account's model entitlement before use.`)
}
if (import.meta.main) main().catch((error) => { console.error(error instanceof Error ? error.message : "Account operation failed"); process.exitCode = 1 })
