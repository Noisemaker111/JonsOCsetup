import { inspectHostExecutable } from '../project-router/executable.mjs'
/** Immutable-generation plugin promotion selected by one atomic pointer. */
import { closeSync, copyFileSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { homedir } from "node:os"
import { spawn } from "node:child_process"
import { startValidationProvider, VALIDATION_MODEL } from "./validation-provider"
import { validateConfiguredPlugins } from "../plugin-health"
import { parse as parseJson5 } from "json5"
import { hiddenExecFileSync } from "./windows-process"
import { repositoryBoundaries } from "./headless-guard"
import { withLockAsync } from "./evidence-lock.mjs"

export type Activation = { schema: 2; activeGeneration: string; lastKnownGood: string; candidateGeneration?: string; updated: string; evidence?: unknown; failure?: unknown }
export const activationPath = (root: string) => join(root, "plugin-activation.json")
/** One deterministic fixture, never a user model fallback chain. */
export const VALIDATION_MODELS = [VALIDATION_MODEL]
/** Cold start plus one turn; the old 30s fired before the host finished booting. */
const HOST_VALIDATION_TIMEOUT_MS = 180_000
/** The harness bridge's default port, as written in opencode.jsonc provider baseURLs. */
export const DEFAULT_BRIDGE_PORT = 3012
/** True when something already listens on the port, so the candidate cannot own it. */
export async function portInUse(port:number):Promise<boolean>{
  const { createServer } = await import("node:net")
  return new Promise((done)=>{const probe=createServer();probe.once("error",()=>done(true));probe.once("listening",()=>probe.close(()=>done(false)));probe.listen(port,"127.0.0.1")})
}

/** An ephemeral port the OS confirms is free, so a candidate never shares a bridge. */
export async function freePort(): Promise<number> {
  const { createServer } = await import("node:net")
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once("error", reject)
    probe.listen(0, "127.0.0.1", () => {
      const port = (probe.address() as { port: number }).port
      probe.close(() => resolve(port))
    })
  })
}
/** A real defect in the candidate: plugins did not load. */
export const pluginFault = (out: string) => /Plugin failed|failed to load plugin|Invalid V2 TUI plugin module/i.test(out)
/**
 * Timed out having printed nothing at all: the host never got through plugin
 * setup, so this is the candidate's fault and the walk stops here. Checked
 * before `inconclusive`, which would otherwise absolve a plugin that hangs.
 */
export const bootHang = (host: {code: number; out: string}) =>
  host.code === 124 && !/\S/.test(host.out.replace(/\[timeout after \d+ms\]/, ""))
/**
 * The model could not answer — spent plan, a stalled provider, an unreachable
 * one. None of it says anything about whether the candidate is sound, so the
 * diagnostic classifier distinguishes that failure from plugin defects.
 * It does not authorize activation or a model fallback.
 */
export const inconclusive = (out: string) =>
  /usage limit has been reached|Usage reached|usage limit|quota (exceeded|reached)|rate.?limit|resource.?exhausted|\b(402|403|429)\b/i.test(out)
  || /^timeout$|\btimed? ?out\b|ECONNREFUSED|ConnectionRefused|Unable to connect|ENOTFOUND|fetch failed|socket hang up/i.test(out)
/** @deprecated name kept for callers; exhaustion is one kind of inconclusive. */
export const exhausted = inconclusive
function atomicJson(path: string, value: unknown) { mkdirSync(dirname(path), { recursive: true }); const tmp=`${path}.${process.pid}.tmp`; const fd=openSync(tmp,"w"); try { writeFileSync(fd,JSON.stringify(value,null,2)+"\n"); fsyncSync(fd) } finally { closeSync(fd) }; renameSync(tmp,path) }
function readActivation(root: string): Activation { try { const x=JSON.parse(readFileSync(activationPath(root),"utf8")); if(x.schema===2&&/^[\w.-]+$/.test(x.activeGeneration))return x } catch{}; return {schema:2,activeGeneration:"gen-current",lastKnownGood:"gen-current",updated:new Date().toISOString()} }
function copyTree(src:string,dst:string,relative:string,boundaries:Set<string>){mkdirSync(dst,{recursive:true});for(const n of readdirSync(src)){const next=relative+"/"+n;if(boundaries.has(next)||[".git","node_modules"].includes(n))continue;const a=join(src,n),b=join(dst,n),info=lstatSync(a);if(info.isSymbolicLink())throw new Error(`Cannot stage source link: ${next}`);if(info.isDirectory())copyTree(a,b,next,boundaries);else copyFileSync(a,b)}}
/**
 * Promotion holds the same evidence-driven lock the release registry holds, for the same reason.
 * This was a bare directory reclaimed on `Date.now()-mtime>120000`: an age, which takes the lock
 * from a promotion still copying trees and validating a host against a 180s timeout, records
 * nothing about who held it, and tells nobody it happened. It is the shape that stranded every
 * launch behind the retirement lock for four hours on 2026-09-11.
 */
const promotionLock=(root:string)=>({path:join(root,".plugin-promote.lock"),label:"deploy-lock",subject:"a plugin",activity:"Plugin promotion"})
function lock<T>(root:string,fn:()=>Promise<T>):Promise<T>{return withLockAsync(promotionLock(root),"promotion",fn)}
function hiddenRun(exe:string,args:string[],cwd:string,env:NodeJS.ProcessEnv,timeout=30000){return new Promise<{code:number;out:string}>((done)=>{const p=spawn(exe,args,{cwd,env,shell:false,windowsHide:true,stdio:["ignore","pipe","pipe"]});let out="";p.stdout.on("data",x=>out=(out+x).slice(-8000));p.stderr.on("data",x=>out=(out+x).slice(-8000));const t=setTimeout(()=>{p.kill();done({code:124,out:`${out}
[timeout after ${timeout}ms]`})},timeout);p.once("close",c=>{clearTimeout(t);done({code:c??1,out})});p.once("error",e=>{clearTimeout(t);done({code:1,out:String(e)})})})}
export async function validateCandidate(root:string,candidate:string){
  const candidateModules=join(candidate,"node_modules"), linkedModules=!existsSync(candidateModules)
  if(linkedModules)symlinkSync(join(root,"node_modules"),candidateModules,"junction")
  try {
  const set=JSON.parse(readFileSync(join(candidate,"plugin-set.json"),"utf8"));
  const originalConfig=readFileSync(join(candidate,"opencode.jsonc"),"utf8"), originalCli=readFileSync(join(candidate,"cli.json"),"utf8")
  const plugins=(set.serverEntrypoints as string[]).map((x:string)=>`./${x}`),tuis=(set.tuiEntrypoints as string[]).map((x:string)=>`./${x}`)
  // cli.json keeps its bootstrap DIRECTORIES: the beta-19059 TUI host resolves
  // `<dir>/tui.tsx` and silently drops any entry that names a file. The TUI
  // sources those bootstraps import are preflighted as extra paths instead.
  const parsed=parseJson5(originalConfig), parsedCli=parseJson5(originalCli);parsed.plugin=plugins
  // The candidate must be validated against ITS OWN bridge, never the running
  // generation's. The port is isolated unconditionally so the gate behaves the
  // same whether or not the live host happens to hold 3012 right now: pick an
  // OS-confirmed free port, rewrite the candidate's provider baseURLs to it,
  // and pass CLAUDE_CODE_BRIDGE_PORT so the candidate's bridge binds that same
  // port. The live/active host keeps 3012.
  //
  // (A later commit claimed the provider endpoint is cached in the shared
  // opencode.db and required the candidate to own 3012 instead — which made
  // promotion impossible whenever the live host, which permanently holds 3012,
  // was running. That cache does not exist: no table or kv row in the db holds
  // a baseURL, and a probe server on a free port received every chat
  // completion from a host whose config pointed at it. The rewrite below is
  // what routes the candidate's completions to its own bridge.)
  const bridgePort=await freePort()
  for(const provider of Object.values(parsed.providers??{}) as Array<{settings?:{baseURL?:string}}>){
    const url=provider?.settings?.baseURL
    if(typeof url==="string"&&url.includes(`:${DEFAULT_BRIDGE_PORT}`))provider.settings!.baseURL=url.replace(`:${DEFAULT_BRIDGE_PORT}`,`:${bridgePort}`)
  }
  writeFileSync(join(candidate,"opencode.jsonc"),JSON.stringify(parsed,null,2))
  writeFileSync(join(candidate,"cli.json"),JSON.stringify(parsedCli,null,2))
  const healthFile=join(root,`.candidate-health-${process.pid}.json`)
  try {
    const staticFailures=await validateConfiguredPlugins(candidate,healthFile,tuis);if(staticFailures.length)return{ok:false,staticFailures,host:{code:1,out:"static preflight failed"}}
    const identity=inspectHostExecutable(),exe=identity.executable
    const fixture=startValidationProvider(),scratch=join(root,".visual-e2e","promotion-validation-"+Date.now()),emptyAuth=join(scratch,"empty-auth")
    mkdirSync(emptyAuth,{recursive:true})
    const accessFile=join(scratch,"access-policy.json")
    writeFileSync(accessFile,JSON.stringify({version:1,routes:[{providerID:"validation-fixture",modelPattern:"model",transports:[{origin:fixture.origin,pathPrefix:"/v1/"}]}]}))
    parsed.providers={...parsed.providers,"validation-fixture":{package:"@opencode-ai/ai/providers/openai-compatible",env:[],settings:{baseURL:fixture.origin+"/v1",apiKey:"fixture-only"},models:{model:{limit:{context:128000,output:1000}}}}}
    writeFileSync(join(candidate,"opencode.jsonc"),JSON.stringify(parsed,null,2))
    try{
      const host=await hiddenRun(exe,["run","--standalone","--auto","-m",VALIDATION_MODEL,"--agent","general","Return the validation receipt supplied by the local provider."],candidate,{...process.env,OPENCODE_CONFIG_DIR:candidate,OPENCODE_CONFIG_PROJECT_DISABLE:"1",OPENCODE_DISABLE_AUTOUPDATE:"1",CLAUDE_CODE_BRIDGE_PORT:String(bridgePort),OPENCODE_ACCESS_POLICY:accessFile,OPENCODE_ACCOUNT_DISCOVERY_ROOT:emptyAuth,OPENCODE_ACCOUNT_USAGE_FILE:join(scratch,"accounts.json"),OPENCODE_QUEST_ROOT:scratch,OPENCODE_ORCHESTRATION_LEDGER:join(scratch,"orchestration.jsonl"),OPENCODE_TELEMETRY_FILE:join(scratch,"requests.jsonl"),OPENCODE_DB:join(scratch,"host.db"),XDG_DATA_HOME:join(scratch,"data"),XDG_STATE_HOME:join(scratch,"state"),XDG_CACHE_HOME:join(scratch,"cache")},HOST_VALIDATION_TIMEOUT_MS)
      const ok=host.code===0&&!pluginFault(host.out)&&fixture.requests.count>0&&host.out.includes(fixture.receipt)
      const result={ok,staticFailures,host:{...identity,...host,out:host.out.slice(-2000),model:VALIDATION_MODEL},fixture:{requests:fixture.requests.count,receipt:fixture.receipt,accountInference:false}}
      writeFileSync(join(scratch,"report.json"),JSON.stringify(result,null,2))
      return result
    }finally{fixture.stop()}
  } finally { writeFileSync(join(candidate,"opencode.jsonc"),originalConfig);writeFileSync(join(candidate,"cli.json"),originalCli);rmSync(healthFile,{force:true}) }
  } finally { if(linkedModules)rmSync(candidateModules,{recursive:true,force:true}) }
}
export async function promote(root:string,candidateRoot:string,generation=`gen-${Date.now()}`){return lock(root,async()=>{const prior=readActivation(root),candidate=resolve(candidateRoot),validation=await validateCandidate(root,candidate);
const promotable=validation.ok;if(!promotable){const failed={...prior,candidateGeneration:generation,updated:new Date().toISOString(),failure:{generation,validation,action:"quarantined; active pointer unchanged"}};atomicJson(activationPath(root),failed);return{promoted:false,validation,activation:failed}};const generations=join(root,"generations"),dest=join(generations,generation);if(existsSync(dest))throw new Error("generation already exists");mkdirSync(generations,{recursive:true});renameSync(candidate,dest);const sourceCommit=readSourceCommit(dest);const next:Activation={schema:2,activeGeneration:generation,lastKnownGood:prior.activeGeneration,updated:new Date().toISOString(),evidence:{...validation,sourceCommit}};atomicJson(activationPath(root),next);return{promoted:true,validation,activation:next}})}
export function rollback(root:string,reason:string){const a=readActivation(root);if(a.activeGeneration===a.lastKnownGood)return a;const next={...a,activeGeneration:a.lastKnownGood,updated:new Date().toISOString(),failure:{reason:reason.slice(0,500),action:"automatic rollback"}};atomicJson(activationPath(root),next);return next}
/**
 * Stage a candidate INSIDE the repo, never in a temp directory.
 *
 * A candidate is a full copy of the config tree that promotion renames into
 * generations/. Staging it under %TEMP% put real work somewhere untracked and
 * untraceable, and a failed promotion left it orphaned there. `.candidates/`
 * sits next to generations/, is gitignored, and is obvious when something is
 * left behind.
 */
export const candidatesDir = (root: string) => join(root, ".candidates")

/**
 * A generation is the plugin tree the host loads — not an archive of the repo.
 *
 * Copying everything made each generation contain the previous one (they
 * nested four deep), duplicated 399 test files and 92 Quest files per
 * promotion, and grew generations/ to 204 MB. `bun test` then walked those
 * copies and ran stale suites against the live config, and git saw dozens of
 * untracked directories full of junctions pointing back at node_modules.
 */
const STAGE_SKIP = new Set([
  // recursion and git noise
  "generations", ".candidates", ".git", "node_modules", ".plugin-promote.lock",
  // not loaded by the host
  "test", "bench", "logs", "run", "tmp", ".visual-e2e", ".cache",
  // live state that must not be frozen into an immutable copy
  ".opencode", "plugin-activation.json", "service.json",
  // repository gates and generated publication output are not host inputs
  "smoke-test.ps1", "quest-smoke.ps1", "migration-reports",
])
/** Bulk files the host never reads. */
const STAGE_SKIP_PATTERN = /\.(zip|log|pid|tmp|cache|tsbuildinfo)$|^opencode\.json\.bak\.|^\.candidate-health-.*\.json$/
const RESERVED_STAGE_NAME = /^(nul|con|prn|aux|com[1-9]|lpt[1-9])(?:\.|$)/i

export function stageEntryAllowed(entry: string): boolean {
  return !STAGE_SKIP.has(entry) && !STAGE_SKIP_PATTERN.test(entry) && !RESERVED_STAGE_NAME.test(entry)
}

export function readSourceCommit(candidate: string): string | undefined {
  try { return JSON.parse(readFileSync(join(candidate, ".deployment-source.json"), "utf8")).commit } catch { return undefined }
}

export function stageCandidate(root: string, name = `candidate-${Date.now()}`): string {
  if (!/^[\w.-]+$/.test(name) || name === "." || name === "..") throw new Error("Invalid candidate name")
  const boundaries = repositoryBoundaries(root)
  const dest = join(candidatesDir(root), name)
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })
  for (const entry of readdirSync(root)) {
    if (!stageEntryAllowed(entry) || boundaries.has(entry)) continue
    const from = join(root, entry), to = join(dest, entry)
    const info = lstatSync(from)
    if (info.isSymbolicLink()) throw new Error(`Cannot stage source link: ${entry}`)
    if (info.isDirectory()) copyTree(from, to, entry, boundaries)
    else copyFileSync(from, to)
  }
  // Capture the revision at staging, never after the slow validation turn.
  let commit: string | undefined
  try { commit = String(hiddenExecFileSync("git", ["-C", root, "rev-parse", "HEAD"], { stdio: ["ignore", "pipe", "pipe"] })).trim() } catch {}
  writeFileSync(join(dest, ".deployment-source.json"), JSON.stringify({ commit }) + "\n")
  return dest
}

/** Keep the active generation and the rollback target; delete the rest. */
/**
 * Generations a live process may still be loading from.
 *
 * A running opencode2 resolved its generation at boot and keeps reading that
 * directory. Deleting it pulls the rug out mid-session: the plugin is loaded
 * but its files are gone, and the next turn fails with no usable message.
 * That is exactly what a prune did to a live TUI, so pruning is skipped
 * entirely while any host is running.
 */
export function hostsRunning(): boolean {
  if (process.platform !== "win32") return false
  try {
    const out = hiddenExecFileSync("tasklist.exe", ["/FI", "IMAGENAME eq opencode2.exe", "/NH"], { stdio: ["ignore", "pipe", "pipe"] })
    return /opencode2\.exe/i.test(String(out ?? ""))
  } catch {
    // Cannot tell — assume in use. Disk is cheaper than a broken session.
    return true
  }
}

export function pruneGenerations(root: string, keep = 2): string[] {
  const dir = join(root, "generations")
  if (!existsSync(dir)) return []
  // Never delete out from under a running host.
  if (hostsRunning()) return []
  const activation = readActivation(root)
  const pinned = new Set([activation.activeGeneration, activation.lastKnownGood, activation.candidateGeneration].filter(Boolean) as string[])
  const removed: string[] = []
  const candidates = readdirSync(dir)
    .filter((name) => !pinned.has(name))
    .sort()
    .reverse()
    .slice(Math.max(0, keep - pinned.size))
  for (const name of candidates) {
    try { rmSync(join(dir, name), { recursive: true, force: true }); removed.push(name) } catch {}
  }
  return removed
}

if(import.meta.main){
  const root=process.env.OPENCODE_CONFIG_ROOT??join(homedir(),".config","opencode")
  const pos=process.argv.slice(2).filter(a=>!a.startsWith("--"))
  // With no argument, stage the current tree in-repo and promote that.
  const candidate=pos[0]??stageCandidate(root)
  const result=await promote(root,candidate)
  // generations/ is build output, so old ones are deleted rather than kept
  // forever. Only the active generation and its rollback target survive.
  const pruned=result.promoted&&!process.argv.includes("--no-prune")?pruneGenerations(root):[]
  // JonsOCsetup is the only source repository. Local activation never publishes mirrors.
  console.log(JSON.stringify({...result,pruned},null,2))
  // Promotion renames a successful candidate into generations/; a quarantined
  // one is removed rather than left lying around.
  if(!result.promoted){try{rmSync(candidate,{recursive:true,force:true})}catch{}process.exit(1)}
}
