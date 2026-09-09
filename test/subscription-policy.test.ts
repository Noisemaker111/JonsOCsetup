import { expect, test } from "bun:test"
import { assertSubscriptionModel, assertSubscriptionRequest, assertOAuthProxyConfig, installSubscriptionGuard } from "../models/subscription-policy"
const proxy = "http://127.0.0.1:8317"
test("named paid and unknown models remain forbidden; only actually free Zen models pass", () => {
  for (const providerID of ["xai", "openrouter", "anthropic", "other", "cursor"]) expect(() => assertSubscriptionModel({ providerID, id: "named" })).toThrow("Subscription-only")
  expect(() => assertSubscriptionModel({ providerID: "opencode", id: "paid" })).toThrow()
  expect(() => assertSubscriptionModel({ providerID: "opencode", id: "muse-free" })).not.toThrow()
})
test("OpenAI API-key endpoint cannot bypass policy through a subscription model identity", () => {
  const model = { providerID: "openai", id: "gpt-6-astra" }
  expect(() => assertSubscriptionRequest(model, "https://api.openai.com/v1/responses", proxy)).toThrow()
  expect(() => assertSubscriptionRequest(model, "https://chatgpt.com.evil.test/backend-api/codex/responses", proxy)).toThrow()
  expect(() => assertSubscriptionRequest(model, "https://chatgpt.com/backend-api/codex/responses", proxy)).not.toThrow()
  expect(() => assertSubscriptionRequest({ providerID: "grok-build", id: "grok-4.6" }, "http://127.0.0.1:3012/v1/chat/completions", proxy)).toThrow()
})
test("proxy allows only OAuth credentials and has no API-key or credit fallback route", () => {
  const config = { host: "127.0.0.1", "quota-exceeded": { "antigravity-credits": false } }
  const credentials = [{ type: "codex", refresh_token: "fixture" }]
  expect(() => assertOAuthProxyConfig(config, credentials)).not.toThrow()
  expect(() => assertOAuthProxyConfig(config, [{ ...credentials[0], disabled: true }])).toThrow("enabled")
  expect(() => assertOAuthProxyConfig(config, [{ ...credentials[0], auth_mode: "api_key" }])).toThrow()
  for (const key of ["xai-api-key", "codex-api-key", "claude-api-key", "openai-compatibility"]) expect(() => assertOAuthProxyConfig({ ...config, [key]: [{}] }, credentials)).toThrow()
  expect(() => assertOAuthProxyConfig(config, [{ type: "codex", api_key: "fixture" }])).toThrow()
  expect(() => assertOAuthProxyConfig({ ...config, plugins: { enabled: true } }, credentials)).toThrow()
  expect(() => assertOAuthProxyConfig({ host: "127.0.0.1" }, credentials)).toThrow("credit fallback")
})
test("request policy is mandatory and rejects a paid request before HTTP transport", async () => {
  await expect(installSubscriptionGuard({})).rejects.toThrow()
  let handler: Function | undefined
  await installSubscriptionGuard({ session: { hook: async (name: string, fn: Function) => { expect(name).toBe("http.request"); handler = fn } } })
  expect(() => handler!({ model: { providerID: "xai", id: "grok" }, request: new Request("https://api.x.ai/v1/responses") })).toThrow("Subscription-only")
})
