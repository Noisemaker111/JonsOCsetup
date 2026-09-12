import { assertConfiguredSelection } from "./access-policy"
/**
 * Which lane the activation gate verifies on.
 *
 * Three separate failures came out of this one choice, each costing a full prepare-and-gate pass:
 *
 *  - Matching the activated model on provider and model alone took whichever reasoning effort sat
 *    first in the candidate list. With dev.json recording deepseek-v4.1-flash#high, the gate ran
 *    both the giver and the worker at #max — the most expensive lane for that model, on every
 *    release preparation, against a standing rule that verification runs on the cheapest capable
 *    route. Effort is part of route identity, so the match includes it.
 *  - Funded is not working. The gate picked cliproxyapi/claude-fable-5-1, which held capacity and
 *    answers every call with "Claude Code 2.1.220 does not support this model". Dispatch already
 *    refuses a route the preflight probe found broken; the gate has to refuse the same ones, or it
 *    verifies on a lane no worker could use and burns a full gate finding out.
 *  - When nothing is left, the refusal has to say what was refused and why. "No authorized route has
 *    available capacity" is indistinguishable from a machine with no routes configured at all.
 *
 * The order itself is unchanged: the lane the channel actually ships on first, then the policy's
 * primary, then everything else it allows, then whatever the live join derived.
 */
export type VerificationRoute = { id: string; providerID: string; modelID: string; reasoning?: string; accountID?: string }

export type RouteRefusal = { id: string; reason: string }

export function chooseVerificationRoute(input: {
  candidates: VerificationRoute[]
  activated: string
  primaryRouteID?: string
  allowedRouteIDs?: string[]
  derivedIDs?: string[]
  available: (accountID?: string) => boolean
  probeFailure: (route: VerificationRoute) => string | undefined
}): { route: VerificationRoute } | { refused: RouteRefusal[] } {
  const { candidates, activated } = input
  const activatedID = candidates.find(r => activated && activated === r.providerID + "/" + r.modelID + "#" + r.reasoning)?.id
  const ordered = [activatedID, input.primaryRouteID, ...(input.allowedRouteIDs ?? []), ...(input.derivedIDs ?? [])]
    .filter((id): id is string => !!id)

  const refused: RouteRefusal[] = []
  const seen = new Set<string>()
  for (const id of ordered) {
    if (seen.has(id)) continue
    seen.add(id)
    const route = candidates.find(r => r.id === id)
    if (!route) { refused.push({ id, reason: "not a candidate route" }); continue }
    try { assertConfiguredSelection(route) } catch(error) { refused.push({id,reason:String(error)}); continue }
    const broken = input.probeFailure(route)
    if (broken) { refused.push({ id, reason: broken }); continue }
    if (!input.available(route.accountID)) { refused.push({ id, reason: "no available account" }); continue }
    return { route }
  }
  return { refused }
}
