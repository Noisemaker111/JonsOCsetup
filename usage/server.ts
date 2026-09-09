import {getUsagePacing} from "./portfolio-pacing"
import { installUsageContext } from "./context-summary"
import { recordRequest } from "./telemetry-store"
import { startPassiveUsage, recordLedgerRequest } from "./passive-ledger"
import { accountRegime } from "./calibration-store"
import { setUsageTarget } from "./usage-target"
import { getAccountUsage } from "./account-api"
/** One account usage API for the Quest giver, code-mode callers, routing and HUD. */
import { define } from "@opencode-ai/plugin/v2/promise"
import { startAccountUsageRefresh } from "./account-api"

import { installContextEvents } from "./context-events"
import { installRequestTelemetry } from "./request-collector"
import { getUsageStatus, formatUsageStatus, type UsageStatusQuery } from "./status-api"
import {compactUsageTool} from './tool-projection'
import type { ExperienceQuery } from "./experience"
import { getUsageExperience } from "./experience-api"
export { getUsageExperience } from "./experience-api"

export default define({
  id: "usage",
  async setup(ctx) {
    startAccountUsageRefresh()
    startPassiveUsage()
    await installRequestTelemetry(ctx,record=>{recordRequest(record);recordLedgerRequest(record)})
    await installContextEvents(ctx)
    await installUsageContext(ctx)
    const tool = (ctx as { tool?: { transform?: Function } }).tool
    if (!tool?.transform) return
    await tool.transform((draft: { add: (tool: unknown) => void }) => {
      draft.add({name:"usage_experience",description:"Read-only usage evidence: observed quota, independent request activity, coverage/gaps/reset epochs, source freshness and next safe action. Exact cached accountID required. Summary is compact; timeline and requests are bounded chronological pages. Optional resetAt plus regime selects a historical quota epoch; timezone is explicit IANA (default UTC). Sources may overlap; missing account bindings are never inferred. Desired slots are not runnable grants. No refresh, target/policy writes, forecasts or launches.",input:{type:"object",additionalProperties:false,required:["accountID"],properties:{accountID:{type:"string",minLength:1,maxLength:200},windowID:{type:"string",minLength:1,maxLength:200},resetAt:{type:"number"},regime:{type:"string",maxLength:200},view:{type:"string",enum:["summary","timeline","requests"]},source:{type:"string",enum:["opencode","codex","opencode-host"]},sessionID:{type:"string",maxLength:200},from:{type:"number"},to:{type:"number"},offset:{type:"integer",minimum:0},limit:{type:"integer",minimum:1,maximum:100},timeZone:{type:"string",maxLength:100}}},output:{type:"object",additionalProperties:true},execute:async(input:ExperienceQuery)=>{const json=JSON.stringify(getUsageExperience(input));return {output:JSON.parse(json),content:json}}})
      draft.add({name:"usage_pacing",description:"Compact scheduler-facing burn status across subscriptions: separate balances/resets, required versus measured pace, desired slots and blocking constraints. Use this for ongoing Quest pacing; usage_status supplies detailed token accounting. Does not launch work or enable a target.",input:{type:"object",additionalProperties:false,properties:{refresh:{type:"boolean"},accountID:{type:"string"}}},output:{type:"object",additionalProperties:true},execute:async(input:{refresh?:boolean;accountID?:string})=>{const result=await getUsagePacing(input);if(input.accountID&&!result.accounts.length)throw Error("Account not found in current connections");const json=JSON.stringify(result);return {output:JSON.parse(json),content:json}}})
      draft.add({name:"usage_target",description:"Save or clear an account's burn deadline and reserve. Shared across sessions and reloaded automatically by passive usage planning. Optional pacing explicitly permits bounded concurrent subscription work for authorized Quest runs, even without per-task calibration; it creates no work and preserves existing exclusive holds.",input:{type:"object",additionalProperties:false,required:["accountID","deadlineAt"],properties:{accountID:{type:"string",minLength:1},followResets:{type:"boolean",description:"Explicitly renew pacing after each fresh reset of this same account, plan and pool. Requires questPacing and deadlineAt equal to the current observed reset."},deadlineAt:{type:["number","null"],description:"Future Unix milliseconds; null clears the target."},reservePoints:{type:"number",minimum:0,maximum:100},questPacing:{type:"object",additionalProperties:false,required:["windowID","maxConcurrent"],properties:{windowID:{type:"string",minLength:1},maxConcurrent:{type:"integer",minimum:1,maximum:16}}}}},output:{type:"object",additionalProperties:true},execute:async(input:{accountID:string;deadlineAt:number|null;reservePoints?:number;followResets?:boolean;questPacing?:{windowID:string;maxConcurrent:number}})=>{const accounts=await getAccountUsage();const account=accounts.accounts.find(a=>a.id===input.accountID);if(!account)throw Error("Account not found in current connections");const window=input.questPacing?account.windows.find(w=>w.id===input.questPacing!.windowID):undefined;if(input.questPacing&&(!window||window.scope!=="shared"||!window.resetAt||Date.parse(window.resetAt)<=Date.now()))throw Error("Pacing requires a current shared account pool");const target=setUsageTarget(input.accountID,input.deadlineAt,input.reservePoints,undefined,Date.now(),input.questPacing?{...input.questPacing,regime:accountRegime(account),resetAt:Date.parse(window!.resetAt!)}:undefined,input.followResets);return {output:{target},content:JSON.stringify({target})}}})
      draft.add({
        name: "usage_status",
        output: { type: "object", additionalProperties: true },
        description: "Preferred global API for accounts, plans, quotas and resets. Call directly from tools/code mode in any project; no shell or config-repo cwd needed. Reuses logins and a shared cache. Use format=json; stale/unknown values are explicit. Includes portfolio with separate account/reset pacing, requested slots and ambiguous account-selection limits. Includes accounting.sessionBurn with exact per-session token rates, provisional allowance rates, per-request estimates and chronologically tested quota residuals against a 0.01 percentage-point target. Includes account-wide reset planning and required burn pace for every pool, independent of conversation filters. For Luna/Astra comparisons supply workloads with exact routes, explicit serviceTier (standard or fast) and per-request token mixes; session counts alone are insufficient. Published credits are not included-plan percentages. Check all shared/model pools and refresh as work proceeds; never use Spark reset as an Astra reset.",
        input: {
          type: "object",
          properties: {
            allSessions: {type:"boolean",description:"Return counts for every captured session instead of defaulting to this session."},
            deadlineAt: {type:"number",description:"Optional future Unix-millisecond target; takes precedence over the saved account target. Planning stops at the earlier of this deadline and each pool reset."},
            harvest: { type: "boolean", description: "Read numeric usage counters from all local Codex rollouts, including child and guardian sessions. Explicit supplemental evidence; never added to OpenCode totals. from/to default to the last four hours, maximum seven days. No prompts or credentials returned." },
            reservePoints: { type: "number", minimum: 0, maximum: 100, description: "Percentage points to leave unused in each pool; default 0." },
            workloads: { type: "array", maxItems: 20, description: "Independent workload alternatives, not a combined dispatch plan.", items: {
              type: "object", additionalProperties: false, required: ["label","accountID","route","requests","tokens"], properties: {
                label: { type: "string", minLength: 1 }, accountID: { type: "string", minLength: 1 }, requests: { type: "integer", minimum: 1, maximum: 1000000 },
                route: { type: "object", additionalProperties: false, required: ["providerID","modelID"], properties: {
                  providerID: {type:"string"}, modelID: {type:"string"}, reasoning: {type:"string"}, variant: {type:"string"}, harness: {type:"string"}, serviceTier: {type:"string"}
                } },
                tokens: { type: "object", additionalProperties: false, required: ["input","cacheRead","outputIncludingReasoning"], properties: {
                  input: {type:"number",minimum:0,maximum:1e9}, cacheRead: {type:"number",minimum:0,maximum:1e9}, outputIncludingReasoning: {type:"number",minimum:0,maximum:1e9}
                } }
              }
            } },
            refresh: { type: "boolean", description: "Refresh observations, respecting shared in-flight work and provider backoff." },
            format: { type: "string", enum: ["text", "json"], description: "JSON returns account IDs, plan tiers, scoped windows, reset timestamps, freshness and errors." },
            accountID: { type: "string", description: "Optional exact account ID from a previous result." },
            sessionID: { type: "string" }, questID: { type: "string" }, includeWorkers: { type: "boolean" },
            from: { type: "number", description: "Start time in Unix milliseconds." }, to: { type: "number", description: "End time in Unix milliseconds." },
            offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 100 },
          },
          required: [], additionalProperties: false,
        },
        execute: async (input: UsageStatusQuery & { format?: string }, context?: { sessionID?: string }) => {
          const snapshot = await getUsageStatus({ ...input, sessionID: input.allSessions ? undefined : input.sessionID ?? context?.sessionID })
          if (input.accountID && !snapshot.accounts.length) throw new Error("Account not found in current connections.")
          const json = JSON.stringify(compactUsageTool(snapshot,input.offset!==undefined||input.limit!==undefined||input.from!==undefined||input.to!==undefined))
          return { output: JSON.parse(json), content: input.format === "json" ? json : formatUsageStatus(snapshot) }
        },
      })
    })
  },
})
