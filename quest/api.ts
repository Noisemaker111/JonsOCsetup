import { createHash } from "node:crypto"
import { QuestStore } from "./store"
import { readAllQuests } from "./index"
import { parseWorkflow, questWorkflow, type QuestWorkflow } from "./workflow"
import { questView } from "./contract"
import { stagesFromSteps, nextQuestStep } from "./steps"
import { normalizeArtifact } from "./artifacts"
import { acquireLock } from "./locking"
import { redact } from "./privacy"
import { normalizeRequestText, questRequestFingerprint, unresolved, unresolvedDuplicate } from "./duplicates"
import { namingProblems } from "./naming"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { projectIdentity, type ProjectIdentity } from "./project"
import type { Quest, QuestStageStatus } from "./types"
import { TASK_CLASSES } from "../models/task-demand"

export class QuestError extends Error {
  constructor(public code: string, message: string, public retryable = false, public runID?: string) { super(message) }
}
export type QuestContext = { project: ProjectIdentity; /** Internal host-derived location; never tool input. */ directory?: string; /** Verified user-giver origin, separate from the selected worker project. */ giverDirectory?: string; sessionID: string; requestID: string; /** Persisted user instruction identity, not the per-response assistant ID. */ turnID?: string }
export type CreateQuest = { workflow?: QuestWorkflow; title: string; description: string; steps: { title: string; detail?:string; needs?: string[]; id?: string; commandID?: string }[]; reward?: string }
export type UpdateQuest = { workflow?: QuestWorkflow; projectRoot?: string; title?: string; description?: string; reward?: string; steps?: { id: string; state: QuestStageStatus; title?: string; detail?: string; needs?: string[]; note?: string; commandID?: string | null; verification?: { command: string; exitCode: number; artifact?: string } }[]; artifacts?: { name: string; path?: string; uri?: string; label?: string }[]; archive?: { reason?: string; accepted: boolean } | null }
/** `task` is what kind of work this dispatch is: coding, review, planning or utility. It is the
 *  only thing that can name a class the dispatch does not enforce, and it decides how much
 *  published accuracy the route may trade for a cheaper reasoning effort. Omitting it is safe --
 *  an unclassified dispatch runs at the default coding demand, never a cheaper one. */
export type RunQuest = { readOnly?: boolean; stepIDs?: string[]; model?: string; files?: string[]; task?: string }
export type StartRun = (input: { quest: Quest; runID: string; stepIDs: string[]; readOnly?: boolean; model?: string; files?: string[]; task?: string; context: QuestContext }) => Promise<{ sessionID: string }>
const hash = (value: string) => createHash("sha256").update(value).digest("hex")
/** A dispatch failure leaves the request with its Quest; the recovery is another run, never another Quest. */
const retryHere = (questID: string) => ` The Quest is intact and still owns this request: fix the cause and call action=run on Quest ${questID} again. Creating a second Quest for the same request is refused.`
const text = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !value.trim()) throw new QuestError("INVALID_INPUT", label + " must be nonempty text")
  return value
}
const keys = (value: object, allowed: string[]) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new QuestError("INVALID_INPUT", "Expected an object")
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new QuestError("INVALID_INPUT", "Unsupported field: " + key)
}
function validateGraph(stages:Quest["stages"]) {
 if(stages.length>30||new Set(stages.map(s=>s.id)).size!==stages.length)throw new QuestError("INVALID_INPUT","Provide at most 30 uniquely identified steps")
 const visiting=new Set<string>(),done=new Set<string>()
 const visit=(id:string)=>{if(done.has(id))return;if(visiting.has(id))throw new QuestError("INVALID_INPUT","Step dependencies contain a cycle");const step=stages.find(s=>s.id===id);if(!step)throw new QuestError("INVALID_INPUT","Unknown step dependency: "+id);visiting.add(id);for(const dependency of step.needs)visit(dependency);visiting.delete(id);done.add(id)}
 for(const step of stages)visit(step.id)
}
/** The five operations share persistence and trusted context; transports add no protocol. */
export function questsAPI(store: QuestStore, context: QuestContext, startRun: StartRun) {
  if (!context.project?.id || !context.project.root || !context.sessionID || !context.requestID) throw new QuestError("PROJECT_CONTEXT_REQUIRED", "A trusted project, session and request identity are required")
  const getOwned = (id: string) => {
    const q = store.read(text(id, "Quest id"))
    if (!q) throw new QuestError("NOT_FOUND", "Quest not found")
    if (q.project?.id !== context.project.id) throw new QuestError("PROJECT_MISMATCH", "Quest does not belong to this session project; select its owning project")
    return q
  }
  return {
    list(query: { text?: string; state?: string; projectID?: string; allProjects?: boolean; archived?: boolean; offset?: number; limit?: number } = {}) {
      keys(query, ["text", "state", "projectID", "allProjects", "archived", "offset", "limit"])
      const offset = query.offset ?? 0, limit = query.limit ?? 25
      if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new QuestError("INVALID_INPUT", "Invalid pagination")
      const entries = readAllQuests(store.projectRoot, { includeArchived: true })
      const terms = (query.text === undefined ? '' : text(query.text, 'Search text')).toLocaleLowerCase().split(/\s+/).filter(Boolean)
      const diagnostics = entries.filter(x=>!x.quest).map(x=>"Unreadable Quest record: "+x.errors.join("; "))
      const rows = entries.flatMap(x => x.quest ? [x.quest] : [])
        .filter(q => (query.allProjects === true || q.project?.id === context.project.id)
          && (!query.projectID || q.project?.id === query.projectID)
          && (query.state ? q.state === query.state : query.archived === true ? q.state === "Archived" : q.state !== "Archived")
          && terms.every(term => [q.title, q.description ?? q.objective, ...q.stages.map(step => step.title)].join('\n').toLocaleLowerCase().includes(term)))
        .sort((a,b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))
      return { diagnostics, items: rows.slice(offset, offset + limit).map(questView), total: rows.length, nextOffset: offset + limit < rows.length ? offset + limit : null }
    },
    get(id: string) { return questView(getOwned(id)) },
    create(input: CreateQuest) {
      keys(input, ["title", "description", "steps", "reward", "workflow"])
      text(input.title, "Title"); text(input.description, "Description")
      if (!Array.isArray(input.steps) || !input.steps.length || input.steps.length > 30) throw new QuestError("INVALID_INPUT", "Provide 1–30 steps")
      for (const step of input.steps) { keys(step, ["title", "detail", "needs", "id", "commandID"]); text(step.title, "Step title"); if(step.detail!==undefined&&typeof step.detail!=="string")throw new QuestError("INVALID_INPUT","Step detail must be text"); if (step.commandID !== undefined) text(step.commandID, "Configured command id") }
      const explicitIDs=input.steps.flatMap(s=>s.id?[s.id]:[]);if(new Set(explicitIDs).size!==explicitIDs.length)throw new QuestError("INVALID_INPUT","Duplicate step IDs")
      const workflow = input.workflow === undefined ? {} : parseWorkflow(input.workflow)
      const stages = stagesFromSteps(input.steps)
      validateGraph(stages)
      if (input.reward !== undefined && typeof input.reward !== "string") throw new QuestError("INVALID_INPUT", "Reward must be text")
      const ids = new Set(stages.map(s => s.id))
      if (stages.some(s => s.needs.some(id => !ids.has(id) || id === s.id))) throw new QuestError("INVALID_INPUT", "Step dependency does not identify another step")
      const id = hash(context.project.id + ":" + context.sessionID + ":" + context.requestID + ":create").slice(0, 26)
      // One tool call admits one Quest. A redelivered call returns what it already created.
      const admitted = store.read(id)
      if (admitted) return questView(admitted)
      // Jk reads the Quest, not the conversation that made it. A record that cannot say what it is
      // is refused here rather than discouraged in a prompt, which this repo has watched fail twice.
      const unreadable = namingProblems({ title: input.title, objective: input.description, steps: input.steps })
      if (unreadable.length) throw new QuestError("UNREADABLE_QUEST", "No Quest was created. " + unreadable.join(" ") + " Retry create with the corrected wording; the request itself does not change.")
      const quests = readAllQuests(store.projectRoot).flatMap(x => x.quest ? [x.quest] : [])
      // A giver can make several create calls from one instruction. Request fingerprints cannot
      // catch it choosing different descriptions for the same generated title, and project-scoped
      // duplicate checks cannot catch it routing those calls to different destinations. The host
      // user instruction is the boundary, so refuse the ambiguous second record across projects.
      const turnTitleDuplicate = context.turnID && quests.find(q => unresolved(q)
        && q.integrationOwner === context.sessionID
        && q.extensions.giverTurnID === context.turnID
        && normalizeRequestText(q.title) === normalizeRequestText(input.title))
      if (turnTitleDuplicate) throw new QuestError("DUPLICATE_QUEST_TITLE", `Quest ${turnTitleDuplicate.id} already uses this title in the current giver turn. No second Quest was created. Update or run ${turnTitleDuplicate.id}, or create the distinct requested Quest with a distinct title.`)
      const fingerprint = questRequestFingerprint({ projectID: context.project.id, title: input.title, objective: input.description })
      const duplicate = unresolvedDuplicate(quests, { projectID: context.project.id, title: input.title, objective: input.description, fingerprint })
      // A failed dispatch does not consume the request. Re-stating it as a second Quest
      // duplicates the work and hides the run that has to be inspected, so it is refused here
      // rather than discouraged in a prompt.
      if (duplicate) throw new QuestError("DUPLICATE_QUEST", `Quest ${duplicate.id} already holds this request for this project and is unresolved (${duplicate.state}: ${duplicate.stages.map(s => s.id + "=" + s.status).join(", ") || "no steps"}). No second Quest was created. Retry the dispatch with action=run on ${duplicate.id}, inspect its runs with get inspect.section=runs, or change that Quest with update. Archive or finish it before opening a different Quest for the same work.`)
      const q = store.create({ id, title: input.title, objective: input.description, description: input.description, reward: input.reward ?? "", extensions: { workflow, ...(context.turnID ? { giverTurnID: context.turnID } : {}) }, stages, contractVersion: 2, project: context.project, integrationOwner: context.sessionID, requestFingerprint: fingerprint })
      return questView(q)
    },
    update(id: string, input: UpdateQuest) {
      keys(input, ["title", "description", "reward", "steps", "artifacts", "archive", "workflow", "projectRoot"])
      const q = getOwned(id)
      // Admission alone left the record renameable: driven against the create-only guard, the giver
      // took the refusal, created a readable Quest, then patched it back to the refused wording.
      // Only the text this call writes is judged, so an older badly-named Quest stays editable.
      const rewritten = namingProblems({ title: input.title, objective: input.description, steps: input.steps })
      if (rewritten.length) throw new QuestError("UNREADABLE_QUEST", "Nothing was saved. " + rewritten.join(" ") + " Retry the update with wording the Quest can be read by.")
      const patch: Record<string, unknown> = {}
      if (input.workflow !== undefined) patch.extensions = { ...q.extensions, workflow: parseWorkflow(input.workflow) }
      if (input.projectRoot !== undefined) {
        // A Quest recorded against a directory that is not a checkout can never dispatch a worker:
        // admission fails with "Cannot establish selected Git checkout" and there was no supported
        // way to move it. One sat on the installed configuration directory, which the hub defines as
        // runtime storage and forbids re-initialising as a repository, so the Quest was unreachable
        // by any route or model. Moving it is the fix; moving it somewhere equally unusable is not.
        const identity = projectIdentity(text(input.projectRoot, "Project root"))
        if (!existsSync(join(identity.root, ".git"))) throw new QuestError("PROJECT_NOT_A_CHECKOUT", identity.root + " is not a Git checkout, so a worker would still have nothing to bind. Name the maintained source project.")
        patch.project = identity
      }
      for (const key of ["title", "description", "reward"] as const) if (input[key] !== undefined) {
        if (typeof input[key] !== "string" || (key !== "reward" && !input[key]!.trim())) throw new QuestError("INVALID_INPUT", key + " must be text")
        patch[key] = input[key]
      }
      if (input.steps !== undefined) {
        if (!Array.isArray(input.steps)) throw new QuestError("INVALID_INPUT", "steps must be an array")
        const stages = structuredClone(q.stages), seen = new Set<string>(), checks: Quest["evidence"]["tests"] = []
        const stepResults=structuredClone((q.extensions.stepResults??{}) as Record<string,{runIDs:string[];state:string;recordedAt:string}>)
        for (const update of input.steps) {
          keys(update, ["id", "state", "title", "detail", "needs", "note", "commandID", "verification"])
          if (!["pending", "working", "blocked", "done"].includes(update.state)) throw new QuestError("INVALID_INPUT", "Step state is required: pending, working, blocked or done")
          let step = stages.find(s => s.id === update.id)
          text(update.id, "Step id")
          if (seen.has(update.id)) throw new QuestError("INVALID_INPUT", "Duplicate step id")
          if (!step) { text(update.title, "New step title"); step = stagesFromSteps([{ id: update.id, title: update.title! }])[0]; stages.push(step) }
          if (update.commandID !== undefined) {
            const commandID = update.commandID === null ? undefined : text(update.commandID, "Configured command id")
            if (commandID !== step.commandID && q.sessions.some(run => ["planned", "executing", "waiting", "blocked"].includes(run.state) && run.deliverables.includes(step.id))) throw new QuestError("STEP_RUNNING", "The step has an active or unconfirmed run. Reconcile it before changing its configured command.")
            if (commandID === undefined) delete step.commandID
            else step.commandID = commandID
          }
          if (update.title !== undefined) step.title = text(update.title, "Step title")
          if (update.detail !== undefined) { if (typeof update.detail !== "string") throw new QuestError("INVALID_INPUT", "Step detail must be text"); step.detail = update.detail }
          if (update.needs !== undefined) { if (!Array.isArray(update.needs) || update.needs.some(n => typeof n !== "string")) throw new QuestError("INVALID_INPUT", "Dependencies must be step IDs"); step.needs = update.needs }
          seen.add(update.id); step.status = update.state
          if (update.note !== undefined) { if (typeof update.note !== "string") throw new QuestError("INVALID_INPUT", "Step note must be text"); step.note = update.note }
          // The check a worker actually ran, against its own step. Not a definition and not a global
          // artifact, so it stays inside the worker restriction while making a delivered step
          // judgeable: prose in a note cannot be evaluated, a command and its exit code can.
          if (update.verification !== undefined) {
            const check = update.verification as { command?: unknown; exitCode?: unknown; artifact?: unknown }
            if (!check || typeof check !== "object" || Array.isArray(check)) throw new QuestError("INVALID_INPUT", "Step verification must be an object with command and exitCode")
            if (update.state !== "done") throw new QuestError("INVALID_INPUT", "Only a step reported done carries verification")
            if (!Number.isSafeInteger(check.exitCode)) throw new QuestError("INVALID_INPUT", "Verification exitCode must be the integer the command actually returned")
            if (check.artifact !== undefined && typeof check.artifact !== "string") throw new QuestError("INVALID_INPUT", "Verification artifact must be a path or URI")
            checks.push({ command: text(check.command, "Verification command"), result: check.exitCode === 0 ? "passed" : "failed", at: new Date().toISOString(), stepID: step.id, ...(check.artifact ? { artifact: check.artifact as string } : {}) })
          }
          // Saving a terminal result reconciles the observed completed runs. A
          // blocked result may later be retried; preserve the old runs and notes.
          // Merely setting pending must never bypass an uninspected completion.
          if((update.state==='blocked'||update.state==='done')&&update.note?.trim()){
            const completed=q.sessions.filter(s=>s.state==='completed'&&s.deliverables.includes(step.id)).map(s=>s.runID??s.callID)
            if(completed.length)stepResults[step.id]={runIDs:[...new Set([...(stepResults[step.id]?.runIDs??[]),...completed])],state:update.state,recordedAt:new Date().toISOString()}
          }
        }
        if (stages.some(s => s.needs.some(id => id === s.id || !stages.some(other => other.id === id)))) throw new QuestError("INVALID_INPUT", "Unknown or self-dependent step")
        validateGraph(stages)
        patch.stages = stages
        patch.extensions={...(patch.extensions??q.extensions) as Record<string,unknown>,stepResults}
        if (checks.length) patch.evidence = { ...q.evidence, tests: [...q.evidence.tests, ...checks] }
      }
      if (input.artifacts !== undefined) {
        if (!Array.isArray(input.artifacts)) throw new QuestError("INVALID_INPUT", "Artifacts must be an array")
        const artifacts = [...q.evidence.artifacts]
        for(const a of input.artifacts){keys(a,["name","path","uri","label"]);text(a.name,"Artifact name");const value=normalizeArtifact({...a,verified:false}),index=artifacts.findIndex(old=>old.name===value.name&&old.path===value.path&&old.uri===value.uri);if(index<0)artifacts.push(value);else artifacts[index]={...artifacts[index],...value,verified:artifacts[index].verified,at:artifacts[index].at}}
        patch.evidence = { ...q.evidence, artifacts }
      }
      if (input.archive !== undefined) {
        if (input.archive === null) patch.archive = undefined
        else {
          keys(input.archive, ["reason", "accepted"])
          if (typeof input.archive.accepted !== "boolean") throw new QuestError("INVALID_INPUT", "Archive accepted must be explicit")
          const steps = (patch.stages ?? q.stages) as Quest["stages"]
          if (q.sessions.some(s => ["planned", "executing", "waiting", "blocked"].includes(s.state))) throw new QuestError("ACTIVE_RUNS", "Wait for or cancel active runs before archiving")
          if (input.archive.accepted && (!steps.length || steps.some(s => s.status !== "done"))) throw new QuestError("UNFINISHED_STEPS", "Finish the requested steps before accepting the reward")
          if (!input.archive.accepted) text(input.archive.reason, "Reason for archiving unfinished work")
          patch.archive = { ...input.archive, at: new Date().toISOString() }
        }
      }
      return questView(store.apply(id, "patched", patch, "quest:update", { expectedRevision: q.revision }))
    },
    async run(id: string, input: RunQuest = {}) {
      keys(input, ["stepIDs", "model", "files", "readOnly", "task"])
      if(input.readOnly!==undefined&&typeof input.readOnly!=="boolean")throw new QuestError("INVALID_INPUT","readOnly must be a boolean")
      if(input.task!==undefined&&!TASK_CLASSES.includes(String(input.task).trim().toLowerCase() as any))throw new QuestError("INVALID_INPUT","task must be one of "+TASK_CLASSES.join(", "))
      if(input.files!==undefined&&(!Array.isArray(input.files)||!input.files.length||input.files.length>100||input.files.some(x=>typeof x!=="string"||!x.trim())))throw new QuestError("INVALID_INPUT","files must be 1–100 literal relative file/directory scopes")
      if (input.model !== undefined) text(input.model, "Model")
      const runID = hash(context.project.id + ":" + context.sessionID + ":" + context.requestID + ":run:" + id).slice(0, 26)
      const lock = acquireLock(store.runtime, "run-" + id)
      let q: Quest, stepIDs: string[]
      try {
        q = getOwned(id)
        const workflow = questWorkflow(q)
        input = { ...input, model: input.model ?? workflow.model, task: input.task ?? workflow.task, readOnly: input.readOnly ?? workflow.readOnly }
        if (q.state === "Archived") throw new QuestError("ARCHIVED", "Reopen the Quest before starting work")
        const prior = q.sessions.find(s => s.runID === runID)
        if (prior) {
          if(!!input.readOnly!==!!(prior.scope as any)?.readOnly)throw new QuestError("REQUEST_CONFLICT","This request already selected another access mode")
          if (JSON.stringify(input.files??["."])!==JSON.stringify((prior.scope as any)?.requestedFiles??(prior.scope as any)?.files??["."]))throw new QuestError("REQUEST_CONFLICT","This request already reserved different file scopes")
          if (input.model !== undefined && prior.model !== input.model) throw new QuestError("REQUEST_CONFLICT", "This request already selected another model; use a new request identity")
          if (prior.state === "failed" || prior.state === "planned" && prior.result) throw new QuestError(prior.state === "failed" ? "DISPATCH_FAILED" : "DISPATCH_OUTCOME_UNKNOWN", (prior.result ?? "Previous launch failed") + retryHere(id), false, runID)
          return { runID, state: prior.state, sessionID: prior.openCodeSessionId ?? null, result: prior.result ?? null }
        }
        const next = nextQuestStep(q)
        stepIDs = input.stepIDs ?? (next?.status === "pending" ? [next.id] : [])
        if (!Array.isArray(stepIDs) || !stepIDs.length || new Set(stepIDs).size !== stepIDs.length) throw new QuestError("NO_ELIGIBLE_STEPS", "No eligible steps; inspect pending work and dependencies")
        for (const id of stepIDs) {
          const step = q.stages.find(s => s.id === id)
          if (!step || step.status !== "pending" || step.needs.some(dep => !q.stages.some(s => s.id === dep && s.status === "done"))) throw new QuestError("STEP_NOT_ELIGIBLE", "The selected step is not ready")
          if (q.sessions.some(s => ["planned", "executing", "waiting", "blocked"].includes(s.state) && s.deliverables.includes(id))) throw new QuestError("STEP_RUNNING", "The step already has an active run on this Quest; inspect it with get inspect.section=runs. Another Quest for the same request is not a retry.")
          // A worker that finished without recording its step leaves the step pending forever.
          // Re-dispatching repeats the same work in a second worktree; reconcile the result instead.
          const reconciled=(q.extensions.stepResults as Record<string,{runIDs:string[]}>|undefined)?.[id]?.runIDs??[]
          if (q.sessions.some(s => s.state === "completed" && s.deliverables.includes(id)&&!reconciled.includes(s.runID??s.callID))) throw new QuestError("STEP_UNRECONCILED", "A worker already completed this step without a reconciled result; inspect that session and save the step done or blocked with its result note before retrying")
        }
        const previous = [...q.sessions].reverse().find(s => ["failed", "cancelled"].includes(s.state) && JSON.stringify([...s.deliverables].sort()) === JSON.stringify([...stepIDs].sort()))
        store.apply(q.id, "session-planned", { callID: runID, runID, parentID: context.sessionID, role: "worker", model: input.model, scope:{readOnly:input.readOnly===true,files:input.files??["."],requestedFiles:input.files??["."]}, deliverables: stepIDs, attempt: previous ? previous.attempt + 1 : 1, resumedFrom: previous?.callID, resumeRoot: previous?.resumeRoot ?? previous?.callID }, "quest:run")
      } finally { lock.release() }
      try {
        const started = await startRun({ quest: q!, runID, stepIDs: stepIDs!, model: input.model, files: input.files, readOnly:input.readOnly, task: input.task, context })
        if (!started?.sessionID) throw new QuestError("DISPATCH_OUTCOME_UNKNOWN", "Host did not confirm a worker session; reconcile this run before retrying", false, runID)
        store.apply(id, "session-bound", { callID: runID, sessionID: started.sessionID }, "quest:run")
        return { runID, state: store.read(id)?.sessions.find(s=>s.runID===runID)?.state ?? "executing", sessionID: started.sessionID }
      } catch (error) {
        const unknown = !(error instanceof QuestError) || error.code === "DISPATCH_OUTCOME_UNKNOWN"
        const message = redact(error instanceof Error ? error.message : "Dispatch failed", 2000)
        // An unclassified transport failure may have started work: retain planned intent.
        store.apply(id, "session-state", { callID: runID, state: unknown ? "planned" : "failed", result: message, evidence: message, preserveTerminal:true }, "quest:run")
        const actual=store.read(id)?.sessions.find(s=>s.runID===runID)
        if(actual && ["completed","failed","cancelled"].includes(actual.state) && (unknown||actual.result!==message))throw new QuestError("DISPATCH_RESPONSE_FAILED", "Worker outcome: "+actual.state+". Dispatch response error: "+message+retryHere(id),false,runID)
        throw new QuestError(unknown ? "DISPATCH_OUTCOME_UNKNOWN" : (error as QuestError).code, message + retryHere(id), false, runID)
      }
    },
  }
}
