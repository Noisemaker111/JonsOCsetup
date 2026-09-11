/**
 * @core-prevents the activation gate verifying a release on a lane no worker could use, or on a costlier reasoning effort than the channel ships, and a refusal that cannot say which routes were rejected or why
 * @core-observed On 2026-09-11 the gate picked cliproxyapi/claude-fable-5-1 for gen-06de0833b98c and hung, because that route holds capacity and answers every call with "Claude Code 2.1.220 does not support this model" — already recorded unusable in route-health.json. Earlier the same night it verified gen-3d9cea5b22c5 at deepseek-v4.1-flash#max while dev.json recorded #high, because the match ignored reasoning effort. Each cost a full prepare-and-gate pass.
 */
import { test, expect } from "bun:test"
import { chooseVerificationRoute, type VerificationRoute } from "../models/verification-route"

const route = (id: string, providerID: string, modelID: string, reasoning: string, accountID = "acct"): VerificationRoute =>
  ({ id, providerID, modelID, reasoning, accountID })

const candidates = [
  route("go-deepseek-max", "opencode-go", "deepseek-v4.1-flash", "max"),
  route("go-deepseek-high", "opencode-go", "deepseek-v4.1-flash", "high"),
  route("proxy-fable-high", "cliproxyapi", "claude-fable-5-1", "high"),
  route("proxy-claude", "cliproxyapi", "claude-opus-5", "high"),
]
const base = {
  candidates,
  activated: "opencode-go/deepseek-v4.1-flash#high",
  primaryRouteID: "proxy-fable-high",
  allowedRouteIDs: ["proxy-claude"],
  derivedIDs: [] as string[],
  available: () => true,
  probeFailure: () => undefined,
}
const chosen = (result: ReturnType<typeof chooseVerificationRoute>) => ("route" in result ? result.route.id : undefined)

test("the gate verifies on the lane the channel ships, and never on one the probe found broken", () => {
  // #max sits first in the candidate list. Matching without reasoning effort took it; the channel
  // records #high, and that is the lane the release will actually run on.
  expect(chosen(chooseVerificationRoute(base))).toBe("go-deepseek-high")

  // A route can hold quota and still answer every call with an error. Dispatch already refuses
  // those, so the gate must too, rather than burning a whole pass discovering it.
  const withoutChannelLane = { ...base, candidates: candidates.filter(r => r.id !== "go-deepseek-high") }
  expect(chosen(chooseVerificationRoute(withoutChannelLane))).toBe("proxy-fable-high")
  expect(chosen(chooseVerificationRoute({
    ...withoutChannelLane,
    probeFailure: r => r.id === "proxy-fable-high" ? "Claude Code 2.1.220 does not support this model" : undefined,
  }))).toBe("proxy-claude")

  // An exhausted account is refused the same way, and the order after the channel's lane is
  // unchanged: primary, then allowed, then derived.
  expect(chosen(chooseVerificationRoute({
    ...withoutChannelLane,
    available: id => id === "other",
    candidates: [...candidates.filter(r => r.id !== "go-deepseek-high"), route("derived", "opencode-go", "muse", "xhigh", "other")],
    derivedIDs: ["derived"],
  }))).toBe("derived")

  // When nothing survives, the refusal names each route and why. "No capacity" alone reads the same
  // on a machine with a broken proxy as on one with no routes configured at all.
  const none = chooseVerificationRoute({ ...base, probeFailure: () => "probe failed", available: () => false })
  expect("route" in none).toBe(false)
  const refused = (none as { refused: { id: string; reason: string }[] }).refused
  expect(refused.map(r => r.id)).toEqual(["go-deepseek-high", "proxy-fable-high", "proxy-claude"])
  expect(refused.every(r => r.reason === "probe failed")).toBe(true)

  // A route id that is not a candidate is reported as such rather than silently skipped, and an id
  // repeated across primary and allowed is judged once.
  const missing = chooseVerificationRoute({ ...base, candidates: [], primaryRouteID: "ghost", allowedRouteIDs: ["ghost"] })
  expect((missing as { refused: { id: string; reason: string }[] }).refused).toEqual([{ id: "ghost", reason: "not a candidate route" }])
})
