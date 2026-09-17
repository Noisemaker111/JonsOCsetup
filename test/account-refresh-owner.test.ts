/**
 * @core-prevents every host process and every usage read polling the provider usage endpoints, so our own rate is what makes an account read stale and unknown
 * @core-observed Over the seven days to 2026-09-17 the Claude usage endpoint recorded 1,050 successful observations against 3,182 for the OpenCode account probed in the same rounds, so about two in three attempts were rejected with HTTP 429; the live account read state unknown, failures 1, Usage endpoint HTTP 429, with the next attempt five seconds later.
 */
import { test, expect } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { claimRefreshLease, getAccountUsage, refreshLeaseHolder, throttleBackoffMs, ACCOUNT_USAGE_TTL_MS } from "../usage/account-api"

const connection = (accountID: string) => ({
  id: "connection-" + accountID, accountID, provider: "claude" as const, identity: "account" as const,
  owner: "opencode" as const, routeProviders: ["anthropic"], modelPrefix: null,
  plan: { name: null, rateLimitTier: null, multiplier: null, provenance: "unknown" as const, observedAt: null },
  token: () => "verification-token", upstreamAccountID: undefined,
})
const window = (now: number) => ({ id: "five_hour", label: "5 hour", scope: "shared" as const, durationSeconds: 18000,
  usedPercent: 12, remainingPercent: 88, resetAt: new Date(now + 3600_000).toISOString(), observedAt: new Date(now).toISOString(), state: "available" as const })

test("one process refreshes for the machine, and a throttled provider is asked less often, not sooner", async () => {
  const root = mkdtempSync(join(tmpdir(), "account-refresh-"))
  const file = join(root, "account-usage.json")
  try {
    let probes = 0
    let answer: "ok" | "throttled" = "ok"
    const clock = { at: Date.now() }
    const service = {
      file, now: () => clock.at,
      discover: () => ({ connections: [connection("verification-account")] as any, diagnostics: [] }),
      probe: async () => { probes++; return answer === "ok" ? { windows: [window(clock.at)] } as any : { state: "unknown", error: "Usage endpoint HTTP 429", retryAfterSeconds: 5 } },
    }

    // The owner refreshes; a second process reads what the owner wrote instead of asking again.
    expect(claimRefreshLease("owner-a", file, clock.at)).toBe(true)
    expect(refreshLeaseHolder(file, clock.at)?.owner).toBe("owner-a")
    expect(claimRefreshLease("owner-b", file, clock.at)).toBe(false)
    const first = await getAccountUsage({ ...service, leaseOwner: "owner-a" })
    expect(first.accounts[0].windows[0].usedPercent).toBe(12)
    expect(probes).toBe(1)

    clock.at += 30_000
    const reader = await getAccountUsage({ ...service })
    expect(reader.accounts[0].windows[0].usedPercent).toBe(12)
    expect(probes).toBe(1)

    // A lease that stops being renewed is taken over; nothing waits for a dead process.
    clock.at += 120_000
    expect(refreshLeaseHolder(file, clock.at)).toBeNull()
    expect(claimRefreshLease("owner-b", file, clock.at)).toBe(true)

    // Repeated rejection widens the interval; Retry-After is a floor, never a ceiling.
    answer = "throttled"
    for (let attempt = 1; attempt <= 3; attempt++) {
      clock.at += 600_000
      await getAccountUsage({ ...service, refresh: true, leaseOwner: "owner-b" })
      const account = JSON.parse(readFileSync(file, "utf8")).accounts[0]
      expect(account.throttles).toBe(attempt)
      expect(account.error).toContain("429")
      // The provider asked for five seconds; the third rejection in a row buys minutes.
      expect(Date.parse(account.nextAttemptAt) - clock.at).toBeGreaterThanOrEqual(Math.max(5000, throttleBackoffMs(attempt)))
      // A throttled account keeps the observation it already has; exhaustion is untouched.
      expect(account.windows[0].usedPercent).toBe(12)
      expect(account.state).not.toBe("exhausted")
    }
    expect(throttleBackoffMs(1)).toBe(ACCOUNT_USAGE_TTL_MS)
    expect(throttleBackoffMs(3)).toBe(ACCOUNT_USAGE_TTL_MS * 4)
    expect(throttleBackoffMs(0)).toBe(0)

    // Inside the backoff even a forced refresh does not reach the provider.
    const asked = probes
    answer = "ok"
    clock.at += 1000
    await getAccountUsage({ ...service, refresh: true, leaseOwner: "owner-b" })
    expect(probes).toBe(asked)
    expect(JSON.parse(readFileSync(file, "utf8")).accounts[0].throttles).toBe(3)

    // Once it has been waited out, a clean answer ends the streak and restores the ordinary interval.
    clock.at += throttleBackoffMs(3) + 1000
    await getAccountUsage({ ...service, refresh: true, leaseOwner: "owner-b" })
    expect(probes).toBe(asked + 1)
    const recovered = JSON.parse(readFileSync(file, "utf8")).accounts[0]
    expect(recovered.throttles).toBe(0)
    expect(recovered.error).toBeNull()
    expect(Date.parse(recovered.nextAttemptAt) - clock.at).toBe(ACCOUNT_USAGE_TTL_MS)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
