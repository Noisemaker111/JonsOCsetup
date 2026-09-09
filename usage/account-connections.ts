/** Credential discovery. Tokens never leave this module except in private adapter inputs.
 * Existing owners retain token refresh responsibility; no credentials are copied or rewritten.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { createHash } from "node:crypto"
import { homedir } from "node:os"
import { join } from "node:path"
import type { AccountPlan, PublicConnection, UsageProvider } from "./account-types"

export type Connection = PublicConnection & {
  provider: UsageProvider
  accountID: string
  identity: "account" | "connection"
  plan: AccountPlan
  token: () => string | undefined
  upstreamAccountID?: string
}
const str = (x: unknown): string | undefined => typeof x === "string" && x.trim() ? x : undefined
const hash = (x: string) => createHash("sha256").update(x).digest("hex").slice(0, 20)
export const opaqueAccountID = (provider: string, identity: string) => provider + "-" + hash(provider + ":" + identity)
const unknownPlan = (): AccountPlan => ({ name: null, rateLimitTier: null, multiplier: null, provenance: "unknown", observedAt: null })
function json(path: string): any { return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, "")) }
function jwt(token: unknown): any {
  try { return JSON.parse(Buffer.from(String(token).split(".")[1], "base64url").toString()) } catch { return {} }
}
export type DiscoveryPaths = { home: string; config: string; codex: string; claude: string; data: string }
export function discoveryPaths(): DiscoveryPaths {
  const isolated = process.env.OPENCODE_ACCOUNT_DISCOVERY_ROOT
  if (isolated) return { home: isolated, config: join(isolated, ".config/opencode"), codex: join(isolated, ".codex"), claude: join(isolated, ".claude"), data: join(isolated, ".local/share/opencode") }
  const home = homedir()
  return {
    home, config: process.env.OPENCODE_CONFIG_DIR ?? join(process.env.XDG_CONFIG_HOME ?? join(home, ".config"), "opencode"),
    codex: process.env.CODEX_HOME ?? join(home, ".codex"),
    claude: process.env.CLAUDE_CONFIG_DIR ?? join(home, ".claude"),
    data: join(process.env.XDG_DATA_HOME ?? join(home, ".local/share"), "opencode"),
  }
}
export function discoverConnections(paths = discoveryPaths()): { connections: Connection[]; diagnostics: string[] } {
  const connections: Connection[] = [], diagnostics: string[] = []
  const read = (path: string, owner: string): any => {
    if (!existsSync(path)) return undefined
    try { return json(path) } catch { diagnostics.push(owner + ": credential metadata unreadable"); return undefined }
  }
  const add = (owner: PublicConnection["owner"], path: string, provider: UsageProvider, auth: any, readAuth: () => any, extra: any = {}) => {
    if (!auth || auth.disabled === true) return
    const tokenKey = ["access_token", "accessToken", "access", ...(provider === "opencode-go" ? ["key"] : [])].find(key => str(auth[key]))
    if (!tokenKey) return
    const claims = jwt(auth.id_token ?? auth[tokenKey]), accessClaims = jwt(auth[tokenKey])
    const claim = claims["https://api.openai.com/auth"] ?? accessClaims["https://api.openai.com/auth"] ?? {}
    const upstreamAccountID = str(auth.account_id ?? auth.accountId ?? claim.chatgpt_account_id)
    const claudeAccount = str(auth.account_uuid ?? extra.accountUuid)
    const organization = str(auth.organization_uuid ?? extra.organizationUuid)
    // Never merge accounts by email: one person may have multiple organizations/subscriptions.
    const identityKey = provider === "openai" ? upstreamAccountID : provider === "claude" && claudeAccount && organization ? claudeAccount + ":" + organization : str(auth.account_id ?? auth.user_id)
    const identity = identityKey ? "account" : "connection"
    const fallback = owner + ":" + path + ":" + provider
    const plan = unknownPlan()
    const name = str(auth.subscriptionType ?? claim.chatgpt_plan_type)
    const tier = str(auth.rateLimitTier ?? extra.organizationRateLimitTier)
    if (name || tier) Object.assign(plan, {
      name: name ?? null, rateLimitTier: tier ?? null,
      multiplier: /(?:^|_)(5|20)x(?:_|$)/.test(tier ?? "") ? Number((tier ?? "").match(/(?:^|_)(5|20)x(?:_|$)/)![1]) : null,
      provenance: "credential-metadata",
    })
    connections.push({
      id: "connection-" + hash(fallback), accountID: opaqueAccountID(provider, identityKey ?? fallback), identity,
      owner, provider, plan, upstreamAccountID,
      modelPrefix: str(auth.prefix) ?? null,
      routeProviders: owner === "broker" ? ["cliproxyapi"] : owner === "codex" ? ["codex"] :
        owner === "claude-code" ? ["claude-code"] : provider === "openai" ? ["openai"] : [provider],
      token: () => { try { return str(readAuth()?.[tokenKey]) } catch { return undefined } },
    })
  }
  const brokerConfig = join(paths.config, "cliproxyapi/config.localhost.yaml")
  if (existsSync(brokerConfig)) {
    try {
      const cfg = Bun.YAML.parse(readFileSync(brokerConfig, "utf8")) as any
      const dir = str(cfg?.["auth-dir"])?.replace(/^~(?=[\\/]|$)/, paths.home)
      if (dir) for (const file of readdirSync(dir).filter(f => f.endsWith(".json")).sort()) {
        const path = join(dir, file), c = read(path, "broker")
        const provider = c?.type === "codex" ? "openai" : c?.type === "claude" ? "claude" : c?.type === "xai" ? "grok" : undefined
        if (provider) add("broker", path, provider, c, () => json(path))
      }
    } catch { diagnostics.push("broker: account store unavailable") }
  }
  const openCodeFile = join(paths.data, "auth.json"), openCode = read(openCodeFile, "opencode")
  if (openCode?.openai?.type === "oauth") add("opencode", openCodeFile, "openai", openCode.openai, () => json(openCodeFile).openai)
  if (openCode?.["opencode-go"]) add("opencode", openCodeFile, "opencode-go", openCode["opencode-go"], () => json(openCodeFile)["opencode-go"])
  if (openCode?.anthropic?.type === "oauth") add("opencode", openCodeFile, "claude", openCode.anthropic, () => json(openCodeFile).anthropic)
  const codexFile = join(paths.codex, "auth.json"), codex = read(codexFile, "codex")
  if (codex?.tokens && !codex.OPENAI_API_KEY) add("codex", codexFile, "openai", codex.tokens, () => json(codexFile).tokens)
  const claudeFile = join(paths.claude, ".credentials.json"), claude = read(claudeFile, "claude-code")
  // Claude's global account metadata normally sits next to its config directory.
  const metadata = read(paths.claude + ".json", "claude-code")?.oauthAccount
  if (claude?.claudeAiOauth) add("claude-code", claudeFile, "claude", claude.claudeAiOauth, () => json(claudeFile).claudeAiOauth, metadata)
  return { connections, diagnostics }
}
