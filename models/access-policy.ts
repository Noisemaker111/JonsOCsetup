import {mkdirSync,readFileSync,renameSync,writeFileSync} from "node:fs"
import {dirname,join} from "node:path"
import {homedir} from "node:os"
import {verifyOAuthProxy} from "./subscription-policy"
export type AccessPolicy={version:1;selectionRestrictions?:{modelPattern:string;forbiddenReasoning:string[];requireExplicitReasoning?:boolean;reason:string}[];routes:{providerID:string;modelPattern:string;verifyOAuthBroker?:boolean;transports:{origin:string;pathPrefix:string}[]}[]}
export function configuredAccess():AccessPolicy{let policy:AccessPolicy;try{policy=JSON.parse(readFileSync(process.env.OPENCODE_ACCESS_POLICY??join(process.env.OPENCODE_CONFIG_DIR??join(homedir(),".config","opencode"),"models","access-policy.json"),"utf8"))}catch{throw new Error("Access policy is unavailable; configure allowed routes and transports before sending requests")};if(policy.version!==1||!Array.isArray(policy.routes)||!policy.routes.length)throw new Error("Invalid access policy; no requests authorized");return policy}
export function assertConfiguredModel(model:{providerID:string;id?:string;modelID?:string},policy=configuredAccess()){const id=model.id??model.modelID;if(!model.providerID||!id)throw new Error("Exact model identity is required");const route=policy.routes.find(r=>r.providerID===model.providerID&&new RegExp("^(?:"+r.modelPattern+")$").test(id));if(!route)throw new Error("User access policy does not allow "+model.providerID+"/"+id);return route}
export function assertConfiguredRequest(model:{providerID:string;id?:string;modelID?:string},requestURL:string,policy=configuredAccess()){const route=assertConfiguredModel(model,policy),url=new URL(requestURL);if(!route.transports.some(t=>url.origin===t.origin&&url.pathname.startsWith(t.pathPrefix)))throw new Error("Request transport is not allowed by user access policy for "+model.providerID);return route}

/** Restrictions are user choices, independent of benchmark scores and provider transport. */
export type ModelSelection={providerID:string;id?:string;modelID?:string;variant?:string;reasoning?:string}
const effortAlias=(id:string)=>id.match(/(?:#|-)(none|low|medium|high|xhigh|max)(?:-fast)?$/i)?.[1]?.toLowerCase()
const restrictionsFor=(id:string,policy:AccessPolicy)=>
  (policy.selectionRestrictions??[]).filter(rule=>new RegExp("^(?:"+rule.modelPattern+")$","i").test(id))
export function assertConfiguredSelection(model:ModelSelection,policy=configuredAccess()){
  const id=model.modelID??model.id??""
  const route=assertConfiguredModel({providerID:model.providerID,id},policy)
  const efforts=[model.variant,model.reasoning,effortAlias(id)].filter((x):x is string=>typeof x==="string"&&!!x).map(x=>x.trim().toLowerCase())
  for(const rule of restrictionsFor(id,policy)){
    if(efforts.some(e=>rule.forbiddenReasoning.includes(e)))throw new Error(rule.reason+" ("+model.providerID+"/"+id+"#"+efforts.join(",")+")")
    if(rule.requireExplicitReasoning&&(!efforts.length||efforts.some(e=>["unknown","default","auto"].includes(e))))throw new Error("Explicit permitted reasoning is required for "+model.providerID+"/"+id+"; "+rule.reason)
  }
  return route
}
/** Inspect the final payload as well as the selected variant. Never consume or rewrite it. */
export async function assertRequestSelection(model:ModelSelection,request:Request,policy=configuredAccess()){
  assertConfiguredSelection(model,policy)
  // Request bodies can carry a different alias/model from the catalog reference.
  if(!policy.selectionRestrictions?.length||!request.body)return
  let body:any
  try{body=await request.clone().json()}catch{
    if(restrictionsFor(model.id??model.modelID??"",policy).length)throw new Error("Cannot verify reasoning in the outgoing request")
    return
  }
  const id=typeof body?.model==="string"?body.model:model.id??model.modelID
  const effective=[body?.reasoning_effort,body?.reasoning?.effort].filter((x):x is string=>typeof x==="string"&&!!x)
  // An allowed UI selection is insufficient if its effort vanished or changed in serialization.
  for(const candidate of new Set([model.id??model.modelID,id])){
    if(!candidate||!restrictionsFor(candidate,policy).length)continue
    if(!effective.length)assertConfiguredSelection({providerID:model.providerID,id:candidate},policy)
    for(const reasoning of effective)assertConfiguredSelection({providerID:model.providerID,id:candidate,reasoning},policy)
  }
}

/** `provider/model#variant` and `provider/model` are the same identity; the effort is not part of it. */
export const routeIdentity=(route:string)=>String(route??"").split("#")[0]
export const modelIdentity=(model:{providerID?:string;id?:string;modelID?:string})=>String(model?.providerID??"")+"/"+String(model?.id??model?.modelID??"")

/**
 * The route the launch actually asked for, as opposed to the one the session ended up on.
 *
 * `scripts/opencode-runtime.mjs` writes the requested route into the launched agent's config and
 * passes that same document to the host as OPENCODE_CONFIG_CONTENT, so the request survives where
 * a plugin can read it. The host then binds the session to whatever its own model catalog can
 * resolve, and when the catalog predates the model -- `opencode-go/deepseek-v4.1-flash` shipped
 * 2026-09-10 and a catalog cached before that does not have it -- it binds a different model
 * carrying the same name and says nothing. Without this comparison the refusal that follows reads
 * as "your policy denies OpenRouter", which is true and useless: the user never asked for
 * OpenRouter.
 */
export function requestedAgentRoute(agent?:string,source=process.env.OPENCODE_CONFIG_CONTENT,sessionID?:string,selection=process.env.OPENCODE_LAUNCH_SELECTION):string|undefined{
  if(!agent||typeof source!=="string"||!source)return
  try{
    const config=JSON.parse(source)
    if(selection){
      const launch=JSON.parse(selection)
      // A launch default is not an explicit choice: the composer may change it before
      // creating a conversation. An explicit launch choice belongs only to its target.
      if(launch.explicitModel!==true||(typeof launch.sessionID==='string'&&launch.sessionID!==sessionID))return
    }
    // Only the visible launch agent was selected by opencode-runtime. A worker's generic
    // config is a template: Quest dispatch binds its own exact provider/model/effort.
    // Comparing it to that template invents a substitution on automatic cross-provider work.
    if(config.default_agent!==agent)return
    const model=(config.agents??{})[agent]?.model
    return typeof model==="string"&&model.includes("/")?model:undefined
  }catch{return undefined}
}

/**
 * The substitution itself, said out loud.
 *
 * Driving the activated dev release on 2026-09-11 against a model catalog cached before
 * `opencode-go/deepseek-v4.1-flash` existed, the session bound `openrouter/deepseek/deepseek-v4.1-flash`
 * instead -- and so did a launch asking for `opencode-go/zzz-not-a-real-model`, which is how we know
 * the substitute is not a same-name twin but simply whatever the composer falls back to. A refused
 * substitute loses the prompt; a permitted one answers it on a model the user never chose. Both are
 * silent today, so both are announced.
 */
export function substitutionNotice(requested:string|undefined,actual:string):string|undefined{
  const asked=requested?routeIdentity(requested):undefined
  if(!asked||!actual||asked===actual)return
  return "This session is bound to "+actual+", not the "+asked+" the launch asked for."
    +" Check the selected route and model catalog before continuing; a different binding alone does not establish why it changed."
}

/** Only a different provider is reported: the host draws a session's title and summary models from
 *  the session's own provider, so a same-provider difference is that, not a substitution. */
export const substitutedProvider=(requested:string|undefined,actual:string)=>{
  const asked=requested?routeIdentity(requested):undefined
  if(!asked)return false
  return asked.slice(0,asked.indexOf("/"))!==actual.slice(0,actual.indexOf("/"))
}

/**
 * Why a session is on the model it is on.
 *
 * A deliberate `/model` selection is durable state of the conversation, not a per-process
 * observation: the same session is continued after a restart, reused after `/new`, and carried
 * through a resumed Quest. The host states the choice once, on `session.model.selected`, and a
 * process-local Set lost it on the next launch -- after which the launch default read as an
 * unexplained substitution and the giver was told to diagnose a catalog that was fine. The ledger
 * below records the fact, keyed by session, so the guard and Quest admission read the same
 * provenance the conversation already made. It never names a model or a fallback; it records what
 * the runtime observed.
 */
export type SelectionSource="user-selected"|"task-routed"|"automatic-fallback"|"stale-session"
export type SelectionRecord={route:string;variant?:string;source:SelectionSource;at:string}
export type SelectionLedger=Record<string,SelectionRecord>
export const selectionStateFile=()=>process.env.OPENCODE_MODEL_SELECTION??join(process.env.XDG_STATE_HOME??join(homedir(),".local","state"),"opencode","model-selection.json")
export function readSelectionLedger(file=selectionStateFile()):SelectionLedger{
  try{const parsed=JSON.parse(readFileSync(file,"utf8"));return parsed&&typeof parsed==="object"&&!Array.isArray(parsed)?parsed:{}}catch{return {}}
}
export function readSelection(sessionID:string|undefined,file=selectionStateFile()):SelectionRecord|undefined{
  if(!sessionID)return
  const row=readSelectionLedger(file)[sessionID]
  return row&&typeof row.route==="string"&&typeof row.source==="string"?row:undefined
}
/** Persist one selection, newest last, bounded so a long-lived state file cannot grow forever. */
export function recordSelection(sessionID:string|undefined,input:{route:string;variant?:string;source:SelectionSource},file=selectionStateFile()):SelectionRecord|undefined{
  if(!sessionID||!input.route)return
  try{
    const ledger=readSelectionLedger(file),row:SelectionRecord={route:input.route,...(input.variant?{variant:input.variant}:{}),source:input.source,at:new Date().toISOString()}
    ledger[sessionID]=row
    const bounded=Object.entries(ledger).sort((a,b)=>String(a[1]?.at??"").localeCompare(String(b[1]?.at??""))).slice(-500)
    mkdirSync(dirname(file),{recursive:true})
    const temporary=file+"."+process.pid+".tmp"
    writeFileSync(temporary,JSON.stringify(Object.fromEntries(bounded)))
    renameSync(temporary,file)
    return row
  }catch(error){console.error("[models] Could not record the session model selection:",error);return}
}
/**
 * Classify a binding without guessing from model names.
 *
 * A recorded choice wins. When the launch asked for one route and the session is on another, the
 * connected catalog decides: if it cannot produce the requested route the host fell back, and that
 * is a substitution; if it can, the session's own binding is the conversation's selection (or an
 * older session kept as-is), not a resolution failure. Unknown resolvability stays conservative
 * and is still reported.
 */
export function bindingProvenance(input:{requested?:string;actual:string;recorded?:SelectionRecord;requestedResolves?:boolean;sessionCreatedAt?:number;processStartedAt?:number}):{source:SelectionSource;substitution:boolean}{
  const actual=routeIdentity(input.actual),asked=input.requested?routeIdentity(input.requested):undefined
  const recorded=input.recorded?.route?routeIdentity(input.recorded.route):undefined
  const stale=input.sessionCreatedAt!==undefined&&input.processStartedAt!==undefined&&input.sessionCreatedAt<input.processStartedAt
  const carried=input.recorded?.source
  if(!asked||!actual||asked===actual)return {source:carried??(stale?"stale-session":"user-selected"),substitution:false}
  if(recorded&&recorded===actual)return {source:carried??"user-selected",substitution:false}
  // The catalog can still produce what the launch asked for, so this is not a resolution failure.
  // A session that predates this process carries no record of its own here, so its kept binding is
  // reported as stale rather than claimed as a choice this process never observed.
  if(input.requestedResolves===true)return {source:stale?"stale-session":"user-selected",substitution:false}
  return {source:"automatic-fallback",substitution:true}
}
/** The conversation's current route and why the runtime believes it is there, for the giver to read. */
export function describeSelection(sessionID:string|undefined,actual?:string,file=selectionStateFile()){
  const record=readSelection(sessionID,file),route=routeIdentity(actual??record?.route??"")
  if(!route&&!record)return
  return {route:route||record!.route,variant:record?.variant,source:record?.source,selectedAt:record?.at,selectedByUser:record?.source==="user-selected"}
}

/** What the user is told when a request is refused: nothing was sent, why, and on which identity. */
export function refusalNotice(input:{model:{providerID?:string;id?:string;modelID?:string};reason:string;requested?:string}):string{
  const actual=modelIdentity(input.model)
  const head="Nothing was sent to the model, and this prompt was not answered. "+input.reason+"."
  return head+" "+(substitutionNotice(input.requested,actual)??"The session is bound to "+actual+".")
}

/**
 * Say it in the conversation, not only in the server log.
 *
 * A hook that throws inside a turn kills SessionRunner.drain: the host logs "Failed to drain
 * Session" and the TUI shows an unanswered prompt with no error, no assistant message and no
 * telemetry row, because the request never left. Observed 2026-09-11 driving the activated dev
 * release on `opencode-go/deepseek-v4.1-flash#high` -- 247.8s after the prompt, zero tokens, zero
 * cost, no requests.jsonl. The refusal has to reach the transcript, so it is posted as a synthetic
 * message. The turn is still unwinding when the hook throws, so a first attempt can conflict with
 * the busy session; an undelivered refusal is the defect itself, so delivery is retried.
 *
 * Two things decide whether it is actually seen, and the first candidate got both wrong. It must
 * wake the session: with `resume: false` the row sat in `session_inbox` and never reached the
 * screen. And it must carry a description: the host projects a synthetic message into a timeline
 * notice only when one is present (`isNotice` in session-ui/timeline/projection.ts), so without it
 * the message was durable, promoted, and still invisible -- the same silence moved twice. Waking
 * cannot loop, because a session is told a given thing exactly once.
 */
export const ANNOUNCE_DELAYS_MS=[0,250,750,1750] as const
export function announcer(sessionApi:{synthetic?:Function}|undefined,delays:readonly number[]=ANNOUNCE_DELAYS_MS){
  const said=new Set<string>()
  return (sessionID:string|undefined,text:string)=>{
    const key=String(sessionID)+" :: "+text
    if(!sessionID||said.has(key))return
    said.add(key)
    if(typeof sessionApi?.synthetic!=="function"){console.error("[models] request refused and ctx.session.synthetic is unavailable to say so:",text);return}
    void (async()=>{
      let last:unknown
      for(const delay of delays){
        if(delay>0)await new Promise(resolve=>setTimeout(resolve,delay))
        try{await sessionApi.synthetic!({sessionID,text,description:text});return}catch(error){last=error}
      }
      console.error("[models] could not deliver a refused-request notice to",sessionID,last,text)
    })()
  }
}

/** The host process start, so a binding that predates it can be told apart from this process's own. */
const processStartedAt=()=>Date.now()-process.uptime()*1000
async function sessionStartedAt(sessionApi:{get?:Function}|undefined,sessionID:string|undefined):Promise<number|undefined>{
  if(!sessionID||typeof sessionApi?.get!=="function")return
  try{
    const response=await sessionApi.get({sessionID}),row=response?.data??response
    const created=row?.time?.created??row?.created
    const value=typeof created==="string"?Date.parse(created):typeof created==="number"?created:undefined
    return typeof value==="number"&&Number.isFinite(value)?value:undefined
  }catch{return}
}
/** Does the connected catalog contain the route the launch asked for? Undefined means it could not be read. */
async function catalogResolves(catalog:any,route:string|undefined):Promise<boolean|undefined>{
  if(!route)return
  try{
    const list=typeof catalog?.model?.list==="function"?await catalog.model.list():undefined
    const models=list?.data??list
    if(!Array.isArray(models))return
    const [providerID,...rest]=routeIdentity(route).split("/"),id=rest.join("/")
    return models.some((model:any)=>model?.providerID===providerID&&(model?.id===id||model?.modelID===id))
  }catch{return}
}

export async function installAccessGuard(ctx:{session?:{hook?:Function;synthetic?:Function;get?:Function};event?:{subscribe:Function};catalog?:any}){
  if(typeof ctx.session?.hook!=="function")throw new Error("Cannot install configured access policy")
  configuredAccess()
  const announce=announcer(ctx.session)
  // The conversation's own record of what it selected, mirrored in memory for this process and on
  // disk for the next one. A recorded selection is provenance; an absent one is not a substitution.
  const known=new Map<string,SelectionRecord>()
  const selectionFor=(sessionID:string|undefined)=>sessionID?known.get(sessionID)??readSelection(sessionID):undefined
  const remember=(sessionID:string|undefined,input:{route:string;variant?:string;source:SelectionSource})=>{
    if(!sessionID||!input.route)return
    const row:SelectionRecord={route:input.route,...(input.variant?{variant:input.variant}:{}),source:input.source,at:new Date().toISOString()}
    known.set(sessionID,row)
    recordSelection(sessionID,input)
  }
  if(ctx.event?.subscribe){
    const stream=await ctx.event.subscribe({})
    void(async()=>{for await(const event of stream){
      if(event?.type==='session.model.selected'&&event.data?.sessionID){
        const model=event.data.model??{}
        remember(event.data.sessionID,{route:modelIdentity(model),variant:typeof model.variant==="string"?model.variant:undefined,source:'user-selected'})
      }
    }})().catch(error=>console.error('[models] Model selection observation failed',error))
  }
  /**
   * Read the binding's provenance before anything says what it is. The launch request, the session's
   * recorded choice and the catalog together decide whether a difference is a deliberate selection
   * or a substitution, so the conversation is never told to diagnose a catalog that was never asked.
   */
  const evaluate=async(event:any)=>{
    const launchRoute=requestedAgentRoute(event?.agent,undefined,event?.sessionID)
    const actual=modelIdentity(event?.model??{})
    if(!actual||actual==="/")return {launchRoute,actual,decision:undefined}
    const recorded=selectionFor(event?.sessionID)
    const mismatch=!!launchRoute&&routeIdentity(launchRoute)!==actual&&routeIdentity(recorded?.route??"")!==actual
    const decision=bindingProvenance({
      requested:launchRoute,
      actual,
      recorded,
      requestedResolves:mismatch?await catalogResolves(ctx.catalog,launchRoute):undefined,
      sessionCreatedAt:mismatch?await sessionStartedAt(ctx.session,event?.sessionID):undefined,
      processStartedAt:processStartedAt(),
    })
    if(launchRoute&&(!recorded||routeIdentity(recorded.route)!==actual))remember(event?.sessionID,{route:actual,variant:event?.model?.variant,source:decision.source})
    return {launchRoute,actual,decision}
  }
  // Before the request, while the identity is still legible: say which model is actually about to
  // answer, but only when the difference is a substitution and not a choice the conversation made.
  await ctx.session.hook("context",async(event:any)=>{
    const {launchRoute,actual,decision}=await evaluate(event)
    if(!decision?.substitution||!substitutedProvider(launchRoute,actual))return
    const notice=substitutionNotice(launchRoute,actual)
    if(notice)announce(event?.sessionID,notice)
  })
  await ctx.session.hook("http.request",async(event:any)=>{
    try{
      const policy=configuredAccess()
      const route=assertConfiguredRequest(event.model,event.request.url,policy)
      await assertRequestSelection(event.model,event.request,policy)
      if(route.verifyOAuthBroker&&new URL(event.request.url).origin!==verifyOAuthProxy().origin)throw new Error("Configured broker origin does not match its verified endpoint")
    }catch(error){
      const {launchRoute,decision}=await evaluate(event).catch(()=>({launchRoute:undefined,decision:undefined}))
      announce(event?.sessionID,refusalNotice({model:event?.model??{},reason:error instanceof Error?error.message:String(error),requested:decision?.substitution?launchRoute:undefined}))
      throw error
    }
  })
}
