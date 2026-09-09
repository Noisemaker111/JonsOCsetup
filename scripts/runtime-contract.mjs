import JSON5 from "json5"
/** Shared receipt and restart protocol for the managed standalone runtime. */
import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

export function generationRoot(root, generation) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(generation ?? "") || generation.includes("..")) throw new Error("invalid runtime generation")
  const target = join(resolve(root), "generations", generation)
  if (!existsSync(join(target, "plugin-set.json"))) throw new Error(`runtime generation missing: ${generation}`)
  return target
}

export function managedPluginRoot(root) {
  const generation = process.env.OPENCODE_PLUGIN_GENERATION
  return generation ? generationRoot(root, generation) : undefined
}

/** Normal host discovery and optional supervisors select the same plugin build. */
export function selectedPluginRoot(root) {
  const managed = managedPluginRoot(root)
  if (managed) return managed
  const pointer = JSON.parse(readFileSync(join(root, "plugin-activation.json"), "utf8"))
  if (pointer.schema !== 2) throw new Error("invalid plugin activation pointer")
  return generationRoot(root, pointer.activeGeneration)
}
export function recordRuntimeLoad(component, root) {
  const receipt = process.env.OPENCODE_RUNTIME_RECEIPT
  if (!receipt) return
  const source = JSON.parse(readFileSync(join(root, ".deployment-source.json"), "utf8"))
  appendFileSync(receipt, JSON.stringify({ component, root, generation: process.env.OPENCODE_PLUGIN_GENERATION, sourceCommit: source.commit, pid: process.pid, at: new Date().toISOString() }) + "\n")
}

export function requestManagedRestart(sessionID) {
  const control = process.env.OPENCODE_RUNTIME_CONTROL
  if (!control) return false
  const token = process.env.OPENCODE_RUNTIME_TOKEN
  if (!token) throw new Error("managed runtime token missing")
  const request = { action: "restart", token, sessionID: sessionID || undefined }
  const file = join(control, "restart.json"), temporary = `${file}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify(request))
  renameSync(temporary, file)
  return true
}

export function activeSessionID(context) {
  const route = context?.ui?.router?.current?.()
  const current = route?.type === "plugin" ? route.data?.returnRoute : route
  if (current?.type === "session" && current.sessionID) return current.sessionID
  const direct = context?.sessionID ?? context?.sessionId
  if (typeof direct === "string" && direct) return direct
  const session = context?.data?.session?.current?.()
  const id = session?.id ?? session?.sessionID
  return typeof id === "string" && id ? id : undefined
}

/** Explicitly retain a verified selection when unrelated source edits must stay unpromoted. */
export function runtimePrepareArgs(root, noDeploy = false) {
  return ["-NoProfile", "-File", join(root, "scripts/restart-opencode.ps1"), "-PrepareOnly", ...(noDeploy ? ["-NoDeploy"] : [])]
}

/** Agent/tool permissions must come from the same reviewed revision as plugins. */
export function reviewedAgentConfig(root,generation){
 const selected=generationRoot(root,generation)
 const config=JSON5.parse(readFileSync(join(selected,"opencode.jsonc"),"utf8"))
 if(!config.agents?.["quest-giver"])throw Error("Selected generation lacks Quest Giver configuration")
 const mcp=structuredClone(config.mcp??{})
 const bridge=mcp.mcp
 if(Array.isArray(bridge?.command))bridge.command=bridge.command.map(value=>typeof value==='string'&&value.replaceAll('\\','/').endsWith('/harnesses/opencode-mcp-stdio.mjs')?join(selected,'harnesses/opencode-mcp-stdio.mjs'):value)
 return JSON.stringify({agents:config.agents,default_agent:config.default_agent,mcp})
}
