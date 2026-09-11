import {readFileSync} from "node:fs"
import {join} from "node:path"
import {homedir} from "node:os"
import {verifyOAuthProxy} from "./subscription-policy"
export type AccessPolicy={version:1;routes:{providerID:string;modelPattern:string;verifyOAuthBroker?:boolean;transports:{origin:string;pathPrefix:string}[]}[]}
export function configuredAccess():AccessPolicy{let policy:AccessPolicy;try{policy=JSON.parse(readFileSync(process.env.OPENCODE_ACCESS_POLICY??join(process.env.OPENCODE_CONFIG_DIR??join(homedir(),".config","opencode"),"models","access-policy.json"),"utf8"))}catch{throw new Error("Access policy is unavailable; configure allowed routes and transports before sending requests")};if(policy.version!==1||!Array.isArray(policy.routes)||!policy.routes.length)throw new Error("Invalid access policy; no requests authorized");return policy}
export function assertConfiguredModel(model:{providerID:string;id?:string;modelID?:string},policy=configuredAccess()){const id=model.id??model.modelID;if(!model.providerID||!id)throw new Error("Exact model identity is required");const route=policy.routes.find(r=>r.providerID===model.providerID&&new RegExp("^(?:"+r.modelPattern+")$").test(id));if(!route)throw new Error("User access policy does not allow "+model.providerID+"/"+id);return route}
export function assertConfiguredRequest(model:{providerID:string;id?:string;modelID?:string},requestURL:string,policy=configuredAccess()){const route=assertConfiguredModel(model,policy),url=new URL(requestURL);if(!route.transports.some(t=>url.origin===t.origin&&url.pathname.startsWith(t.pathPrefix)))throw new Error("Request transport is not allowed by user access policy for "+model.providerID);return route}

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
export function requestedAgentRoute(agent?:string,source=process.env.OPENCODE_CONFIG_CONTENT):string|undefined{
  if(!agent||typeof source!=="string"||!source)return
  try{
    const model=(JSON.parse(source)?.agents??{})[agent]?.model
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
    +" This host's model catalog has no "+asked+", so the host chose a different model and said nothing."
    +" Refresh the model catalog, or pick a route this host knows."
}

/** Only a different provider is reported: the host draws a session's title and summary models from
 *  the session's own provider, so a same-provider difference is that, not a substitution. */
export const substitutedProvider=(requested:string|undefined,actual:string)=>{
  const asked=requested?routeIdentity(requested):undefined
  if(!asked)return false
  return asked.slice(0,asked.indexOf("/"))!==actual.slice(0,actual.indexOf("/"))
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
        try{await sessionApi.synthetic!({sessionID,text,resume:false});return}catch(error){last=error}
      }
      console.error("[models] could not deliver a refused-request notice to",sessionID,last,text)
    })()
  }
}

export async function installAccessGuard(ctx:{session?:{hook?:Function;synthetic?:Function}}){
  if(typeof ctx.session?.hook!=="function")throw new Error("Cannot install configured access policy")
  configuredAccess()
  const announce=announcer(ctx.session)
  // Before the request, while the identity is still legible: the catalog could not give the host
  // the route the launch asked for, so say which model is actually about to answer.
  await ctx.session.hook("context",(event:any)=>{
    const requested=requestedAgentRoute(event?.agent)
    const actual=modelIdentity(event?.model??{})
    if(!substitutedProvider(requested,actual))return
    const notice=substitutionNotice(requested,actual)
    if(notice)announce(event?.sessionID,notice)
  })
  await ctx.session.hook("http.request",(event:any)=>{
    try{
      const route=assertConfiguredRequest(event.model,event.request.url)
      if(route.verifyOAuthBroker&&new URL(event.request.url).origin!==verifyOAuthProxy().origin)throw new Error("Configured broker origin does not match its verified endpoint")
    }catch(error){
      announce(event?.sessionID,refusalNotice({model:event?.model??{},reason:error instanceof Error?error.message:String(error),requested:requestedAgentRoute(event?.agent)}))
      throw error
    }
  })
}
