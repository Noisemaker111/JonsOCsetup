import { expect, test } from "bun:test"
import { accountIdentity, labeledCredential } from "../scripts/accounts"
test("account slots require OAuth identity, retain distinct account prefixes and do not accept API keys", () => {
  const gmail = { type: "xai", email: "one@example.test", refresh_token: "fixture" }
  const other = { ...gmail, email: "two@example.test" }
  expect(accountIdentity(gmail)).not.toBe(accountIdentity(other))
  expect(labeledCredential(gmail, "grok-gmail").prefix).toBe("grok-gmail")
  expect(labeledCredential(other, "grok-x").prefix).toBe("grok-x")
  expect(() => labeledCredential({ type: "xai", api_key: "fixture" }, "grok-x")).toThrow()
  expect(() => labeledCredential({ type: "xai", refresh_token: "fixture" }, "grok-x")).toThrow("identity")
})
