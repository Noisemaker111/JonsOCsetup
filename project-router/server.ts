import {singleUserGiver,selectGiverProject,succeedUserGiver} from '../quest/giver-public'
import { define } from '@opencode-ai/plugin/v2/promise'
import { routerQuestInventory, routerWorker } from '../quest/router-public'
import { createGoalFacade } from '../quest/goal-public'
import { DiscoveryHost, RouterError, redact } from './host'
import { emptySelection, resolveTargets, verifyTarget, revalidate, instructions, targetKey, type Selection, type Target } from './resolution'
import { Onboarding } from './onboarding'
import { routeFeedback } from '../quest/route-public'
import {RouterMemory} from './memory'
import { goalCommand } from './goal-command'

const string = { type: 'string', minLength: 1, maxLength: 2000 }
const selectors = { type: 'array', minItems: 1, maxItems: 10, items: string }
const schema = (properties: any, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false })
export async function installProjectRouter(ctx: any, discovery = new DiscoveryHost()) {
  if (!ctx.tool?.transform || !ctx.session?.create || !ctx.session?.get || !ctx.session?.prompt || !ctx.storage) throw new RouterError('HOST_CAPABILITY_MISSING', 'Project-router requires supported typed tools, session create/get/prompt and plugin storage')
  const memory=new RouterMemory(ctx.storage)
  const state = (id:string)=>memory.selection(id)
  const save = (id: string, selection: Selection) => ctx.storage.set('selection/' + id, selection)
  const worker = (id: string) => routerWorker(id).length > 0
  const goals = createGoalFacade(ctx.session)
  const known = ()=>memory.known()
  const register = (targets:Target[])=>memory.register(targets)
  const operations: { name: string; description: string; input: any; execute: (input: any, context: any) => Promise<any> }[] = [
    { name: 'project_discover', description: 'Discover known project roots on demand, or a bounded page of relevant recent giver conversations. Recency does not choose a work target. Use returned cursor for more.', input: schema({ source: { enum: ['projects', 'sessions', 'messages'] }, search: string, cursor: string, sessionID: string, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 30 } }, ['source']), execute: async input => {
      if (input.source === 'messages') {
        if (!input.sessionID || worker(input.sessionID)) throw new RouterError('DISCOVERY_SCOPE', 'Choose a discovered non-worker conversation for targeted excerpts')
        const observed = await ctx.storage.get('observed/' + input.sessionID)
        if (!observed) throw new RouterError('DISCOVERY_SCOPE', 'Discover this conversation metadata before requesting targeted excerpts')
        return discovery.messages(input.sessionID, input.cursor)
      }
      if (input.source === 'sessions') {
        const page = await discovery.sessions(input)
        const items = page.items.filter((s: any) => !s.parentID && !worker(s.id))
        for (const item of items) await ctx.storage.set('observed/' + item.id, { directory: item.directory })
        return { items, next: page.next, limitation: 'One bounded host page; worker rows are filtered using canonical Quest membership' }
      }
      const host = await discovery.projects(), seeds: {directory:string;hostID?:string}[] = routerQuestInventory().flatMap(q => q.project?.root ? [{ directory: q.project.root }] : [])
      const rows = [...await known(), ...host.flatMap(h => [h, ...h.sandboxes.map(directory => ({ directory, hostID: h.hostID }))]), ...seeds]
      const filtered = rows.filter(t => !input.search || t.directory.toLowerCase().includes(input.search.toLowerCase()))
      const offset = input.offset ?? 0, page = filtered.slice(offset, offset + (input.limit ?? 20)), items: Target[] = [], unavailable: string[] = []
      for (const row of page) { try { items.push({ ...verifyTarget(row.directory), ...(typeof row.hostID === 'string' ? { hostID: row.hostID } : {}) }) } catch { unavailable.push(row.directory) } }
      const unique = [...new Map(items.map(t => [targetKey(t), t])).values()]; await register(unique)
      return { items: unique, unavailable, nextOffset: offset + page.length < filtered.length ? offset + page.length : null, limitation: 'Host-known roots, explicit registrations and Quest owner metadata; roots verified only for this bounded page' }
    } },
    { name: 'project_resolve', description: 'Resolve explicit paths/names/approved aliases or current selection. Multiple selectors remain multiple targets. Discussion creates no work; ambiguity asks once and never launches.', input: schema({ selectors, discussion: { type: 'boolean' } }), execute: async (input, context) => memory.selectionChange(context.sessionID,async()=>{
      const selection = await state(context.sessionID), result = resolveTargets(selection, await known(), input)
      if (result.state === 'clarify') { selection.asked = true; await save(context.sessionID, selection) }
      return { ...result, revision: selection.revision }
    }) },
    { name: 'project_select', description: 'Explicitly select/pin/correct a project or multiple targets; register an alias, forget selection/alias, or succeed a Quest Giver whose context is spent. Invalidates old route revisions. Does not start work.', input: schema({ action: { enum: ['select', 'pin', 'correct', 'alias', 'forget', 'succeed-giver'] }, selectors, alias: { type: 'string', minLength: 1, maxLength: 80 } }, ['action']), execute: async (input, context) => memory.selectionChange(context.sessionID,async()=>{
      if (worker(context.sessionID)) throw new RouterError('WORKER_DELEGATION_DENIED', 'Workers retain their assigned destination')
      // Succeeding the giver is the one action the current giver may take about itself, so it is
      // handled before the guard that would send every other request back to the bound session.
      if (input.action === 'succeed-giver') {
        const released = succeedUserGiver()
        return { released: released ?? null, next: released
          ? 'Released. Start a new session and it becomes your Quest Giver; the old conversation and its Quests are untouched.'
          : 'No giver was bound; the next session becomes your Quest Giver.' }
      }
      const giver=await singleUserGiver(ctx.session,context.sessionID)
      if(giver.id!==context.sessionID)throw new RouterError('SINGLE_GIVER_REQUIRED','Continue in your existing Quest Giver: '+giver.id)
      const selection = await state(context.sessionID)
      if (input.action === 'forget') { if (input.alias) {delete selection.aliases[input.alias.toLowerCase()];await memory.alias(input.alias)} else { selection.targets = []; delete selection.pin } }
      else {
        const result = resolveTargets(selection, await known(), { selectors: input.selectors })
        if (result.state !== 'resolved') return result
        const targets = result.targets.map(revalidate); for (const target of targets) instructions(target)
        if (input.action === 'alias') {
          if (!input.alias || targets.length !== 1 || ['__proto__', 'constructor', 'prototype'].includes(input.alias.toLowerCase())) throw new RouterError('INVALID_ALIAS', 'Alias requires one explicit target and an ordinary name')
          selection.aliases[input.alias.toLowerCase()] = targets[0]
          await memory.alias(input.alias,targets[0])
        } else { selection.targets = targets; delete selection.pin; if (input.action === 'pin') { if (targets.length !== 1) throw new RouterError('INVALID_PIN', 'Pin one target'); selection.pin = targets[0] } }
        await register(targets)
      }
      selection.revision++; selection.asked = false; await save(context.sessionID, selection);selectGiverProject(context.sessionID,selection.targets,selection.revision)
      return { ...selection, note: 'Previously delivered work is not cancelled by correction. Inspect its receipt before rerouting.' }
    }) },
    { name: 'project_route', description: 'Confirm the selected project revision for work in your one persistent Quest Giver. Never creates a destination conversation. Create or run each Quest here; workers execute in their verified project.', input: schema({ revision: { type: 'integer', minimum: 0 }, requestKey: { type: 'string', minLength: 1, maxLength: 150 }, text: { type: 'string', minLength: 1, maxLength: 16000 } }, ['revision', 'requestKey', 'text']), execute: async (input, context) => {
      const selection = await state(context.sessionID)
      if (!selection.targets.length) throw new RouterError('TARGET_REQUIRED', 'Use project_select with the explicit destination before routing')
      const giver=await singleUserGiver(ctx.session,context.sessionID)
      if(giver.id!==context.sessionID)throw new RouterError('SINGLE_GIVER_REQUIRED','Continue in your existing Quest Giver: '+giver.id)
      if(selection.revision!==input.revision)throw new RouterError('SELECTION_CHANGED','Use the exact current project_select revision')
      const targets=selection.targets.map(revalidate);selectGiverProject(giver.id,targets,selection.revision)
      return {giverSessionID:giver.id,targets,revision:selection.revision,createdSessions:0,next:'Create and run Quests in this same conversation. Project selection changes worker location, never the user giver.'}
    } },
    { name: 'project_result',description:'List Quest results and worker references for your selected projects in the one user giver. Use quest get for authoritative progress.',input:schema({}),execute:async(_input,context)=>{
      const giver=await singleUserGiver(ctx.session,context.sessionID),selection=await state(giver.id)
      return {giverSessionID:giver.id,quests:routerQuestInventory().filter(q=>!selection.targets.length||selection.targets.some(t=>t.id===q.project?.id||t.directory===q.project?.root)),next:'Inspect each Quest with quest get; all results return to this giver.'}
    } },
    { name: 'project_clone', description: 'Explicitly authorized safe repo-link onboarding. Reuses verified matching clones; preserves collisions/partial work; no repository scripts. URLs must be credential-free HTTPS/SSH.', input: schema({ url: string, authorized: { type: 'boolean' }, requestKey: string, retry: { type: 'boolean' } }, ['url', 'authorized', 'requestKey']), execute: async (input, context) => {
      if (worker(context.sessionID)) throw new RouterError('WORKER_DELEGATION_DENIED', 'Repo onboarding belongs to the giver')
      const onboarding = new Onboarding(typeof ctx.options?.projectParent === 'string' ? ctx.options.projectParent : undefined)
      const result = await onboarding.clone({ ...input, requestID: context.sessionID + ':' + input.requestKey, known: await known() })
      if (result.state === 'verified' && result.target) { instructions(result.target); await register([result.target]) }
      return result
    } },
    { name: 'project_route_status', description: 'Compact exact-model route and account diagnostics. Distinguishes unavailable authorization, missing reasoning, ambiguous account/service, stale quota and account hold. Does not reserve or launch.', input: schema({ model: string }), execute: async input => ({ ...await routeFeedback(input.model), loadedModule: import.meta.url, hostVersion: ctx.app?.version ?? 'unknown', sourceVersusLoaded: 'This receipt identifies this loaded module only; existing sessions may retain an older generation. Open a fresh verified session after parent promotion.' }) },
    { name: 'project_verify', description: 'Giver binds a configured verification command to an assigned step with action=bind; action=run executes that exact contract in the actual destination/assigned workspace and attaches actual proof. Workers cannot change contracts.', input: schema({questID:string,stepID:string,commandID:string,action:{enum:['bind','run']}},['questID','stepID','commandID']),execute:async(input,context)=>goals.verify(input,{sessionID:context.sessionID,requestID:context.id??context.callID}) },
    { name: 'project_goal', description: 'Explicit canonical Quest goal start/status/pause/cancel/resume in your persistent giver or assigned worker session. Requires authorized step IDs. Restart requires explicit verified resume; never pursue historical backlog.', input: schema({ action: { enum: ['start', 'status', 'pause', 'cancel', 'resume'] }, questID: string, stepIDs: selectors,model:string }, ['action']), execute: async (input, context) => goals.control(input, { sessionID: context.sessionID, requestID: context.id ?? context.callID }) },
  ]
  await ctx.tool.transform((editor: any) => { for (const operation of operations) editor.add({ ...operation, output: { type: 'object', additionalProperties: true }, execute: async (input: any, context: any) => {
    if (!context?.sessionID || !(context.id ?? context.callID)) throw new RouterError('HOST_CONTEXT_REQUIRED', 'Trusted host session and tool call identity required')
    await ctx.session.get({ sessionID: context.sessionID })
    try { const result = await operation.execute(input, context); const output = Array.isArray(result) ? { items: result } : result; return { output, content: JSON.stringify(output) } }
    catch (error) { const output = { code: (error as any)?.code ?? 'ROUTER_FAILED', message: redact(error instanceof Error ? error.message : 'Router failed'), action: 'Inspect this bounded result; do not retry unknown launches or substitute routes' }; return { output, content: JSON.stringify(output) } }
  } }) })
  /**
   * `/goal` is the one way in.
   *
   * It used to be operations only -- start, status, pause, cancel, resume -- and everything else was
   * refused as INVALID_GOAL, so stating a goal meant writing the Quest by hand first. Anything that
   * is not one of those five verbs is now the goal itself, and the giver files and starts it.
   *
   * The wording is the giver's, not this handler's. A command can only put the raw sentence in both
   * the title and the objective, which is exactly the unreadable Quest the naming guard exists to
   * refuse; the giver has the quest-writing skill, the guard and the project context. So intake is a
   * synthetic prompt: Session.synthetic admits it and calls execution.wake, so the giver takes a real
   * turn (packages/core/src/session/session.ts:334).
   */
  const intakePrompt = (goal: string) => [
    `Jon stated this goal: ${goal}`,
    '',
    'File it as a Quest and start it, in this turn:',
    '  1. Load the quest-writing skill, then create the Quest. The title names the outcome, not the',
    '     activity, and says what this one owns that a sibling does not. The objective opens with the',
    '     goal itself; his words go after it, not first.',
    '  2. Give it steps that name the work of this task and the result each one is checked against.',
    '     Never Implementation / Verification / Integration.',
    '  3. Select the project it belongs to if that is not already obvious, then run the first step,',
    '     choosing the route on merit.',
    '',
    'Reply with the Quest id, its title, its steps, and what you dispatched. If the goal is too vague',
    'to write steps for, say exactly what you need to know instead of guessing.',
  ].join(String.fromCharCode(10))

  await ctx.command?.transform((editor: any) => editor.add({ name: 'goal', description: 'State a goal and it becomes a Quest and starts; or start <quest> <step...>, status, pause, cancel, resume', execute: async ({ sessionID, prompt }: any) => {
    const asked = goalCommand(prompt.text)
    if (asked.kind === 'intake') {
      await ctx.session.synthetic({ sessionID, text: intakePrompt(asked.goal), description: 'Goal: ' + asked.goal, metadata: { projectRouterGoal: true } })
      return
    }
    const request = asked.kind === 'status' ? { action: 'status' } : { action: asked.action, questID: asked.questID, stepIDs: asked.stepIDs }
    const result = await goals.control(request as any, { sessionID, requestID: 'goal-command:' + (prompt.id ?? crypto.randomUUID()) })
    await ctx.session.synthetic({ sessionID, text: JSON.stringify(result), metadata: { projectRouterGoal: true } })
  } }))
  await ctx.session.hook?.('prompt',async(event:any)=>{if(event.metadata?.projectRouterGoal!==true&&event.metadata?.projectRouterReturn!==true&&event.metadata?.questWorkerReturn!==true)await goals.steer(event.sessionID)})
  const abort=new AbortController()
  if(ctx.event?.subscribe)void(async()=>{try{const stream=await ctx.event.subscribe({signal:abort.signal});goals.trigger('live');for await(const event of stream){
    if(!/^session\.execution\.(succeeded|failed|interrupted)$/.test(event.type))continue
    const data=event.data??event.properties??{},id=event.id??data.executionID
    if(typeof data.sessionID==='string'&&typeof id==='string'){
      await goals.event(data.sessionID,id,event.type==='session.execution.succeeded')
    }
  }goals.trigger('ended')}catch{goals.trigger('failed')}})()
  return () => {abort.abort();goals.dispose()}
}
export default define({ id: 'project-router', setup: installProjectRouter })
