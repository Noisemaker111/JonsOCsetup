const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false })
const text = { type: 'string' }, strings = { type: 'array', items: text }
const workflow = object({
  readOnly: { type: 'boolean', description: 'Enforce source inspection without shell commands or source writes.' },
  task: { enum: ['coding', 'review', 'planning', 'utility'] },
  model: { type: 'string', description: 'Optional exact user-selected route; omit for automatic task-based selection.' },
  maxConcurrent: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
  delivery: { enum: ['project', 'quest-pr', 'step-pr', 'none'], description: 'Project conventions, one PR for the Quest, one per step, or no PR.' },
})
const fields = {
  id: text,
  query: object({ text: { type: 'string', description: 'All search words must occur in the title, description or step titles.' }, state: { type: 'string', description: 'Filter by saved state, such as Working or Needs attention.' }, projectID: text, view: { enum: ['summary', 'plan'], description: 'Plan includes descriptions and steps for backlog review in one call.' }, allProjects: { type: 'boolean' }, archived: { type: 'boolean' }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Number of Quests per page.' } }),
  inspect: object({
    section: { enum: ['description', 'reward', 'steps', 'runs', 'artifacts', 'changes', 'continuation', 'cleanup'] },
    offset: { type: 'integer', minimum: 0, description: 'Whole-entry offset from nextOffset.' },
    limit: { type: 'integer', minimum: 1, description: 'Target page size in characters; individual records stay intact.' },
  }, ['section']),
  create: object({
    workflow, title: text, description: text, reward: text,
    steps: { type: 'array', minItems: 1, maxItems: 30, items: object({ id: text, title: text, detail: text, needs: strings, commandID: { type: 'string', description: 'An existing configured command identifier. Omit for agent work; strings such as none are command names, not absence.' } }, ['title']) },
  }, ['title', 'description', 'steps']),
  update: object({
    workflow, title: text, description: text, reward: text, cancelContinuation: { type: 'boolean' },
    steps: { type: 'array', items: object({ id: text, title: text, state: { type: 'string', enum: ['pending', 'working', 'blocked', 'done'] }, detail: text, note: text, needs: strings, commandID: { type: ['string', 'null'], description: 'Giver only: replace a configured command identifier, or set null to clear it for agent work. Omission preserves the binding. Cannot change an active or unconfirmed run.' } }, ['id', 'state']) },
    artifacts: { type: 'array', items: object({ name: text, path: text, uri: text, label: text }, ['name']) },
    archive: { anyOf: [object({ accepted: { type: 'boolean' }, reason: text }, ['accepted']), { type: 'null' }] },
  }),
  run: object({
    readOnly: workflow.properties.readOnly,
    task: { type: 'string', enum: ['coding', 'review', 'planning', 'utility'], description: 'Task demand for automatic routing; read-only execution enforces review access.' },
    stepIDs: strings, model: workflow.properties.model, files: strings, continue: { type: 'boolean' },
    maxConcurrent: workflow.properties.maxConcurrent, stepModels: { type: 'object', additionalProperties: text },
    taskTags: { type: 'object', additionalProperties: { type: 'array', items: text, minItems: 1, maxItems: 8 } },
  }),
  wait: object({
    runID: { type: 'string', description: 'Wait on this run only; unrelated Quest edits do not end the wait.' },
    timeoutSeconds: { type: 'integer', minimum: 1, maximum: 600, description: 'Wait up to this many seconds (default 120); returns when saved state changes.' },
  }),
}
const record = properties => ({ type: 'object', properties, additionalProperties: true })
const stepResult = record({ id: text, title: text, state: text, detail: text, note: text, commandID: text, needs: strings, ready: { type: 'boolean' }, blockedBy: text })
const summary = record({ id: text, title: text, revision: { type: 'integer' }, state: text, nextAction: text, running: { type: 'integer' }, updatedAt: text, project: record({ id: text, root: text }), progress: record({ done: { type: 'integer' }, total: { type: 'integer' } }) })
const detail = record({ ...summary.properties, description: text, reward: text, workflow, steps: { type: 'array', items: stepResult }, artifacts: { type: 'array', items: record({ name: text, path: text, uri: text }) }, continuation: { type: 'array', items: record({ id: text, state: text, reason: text, stepIDs: strings }) }, waited: record({ changed: { type: 'boolean' }, milliseconds: { type: 'number' }, steering: text }) })
const page = record({ id: text, section: text, data: {}, offset: { type: 'integer' }, totalItems: { type: 'integer' }, nextOffset: { type: ['integer', 'null'] } })
const admission = record({ quest: text, state: text, requestID: text, runID: text, sessionID: { type: ['string', 'null'] }, continuation: record({ id: text, state: text }) })
const operation = (description, input, positional = [], output = detail, readOnly = false) => ({ description, input, output, positional, annotations: { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: false } })

/** Public contract. CLI help, argument parsing and MCP discovery all consume these operations. */
export const questOperations = {
  list: operation('Find Quests by text, state or project. Use view=plan for descriptions and steps in one backlog read; summary omits evidence bodies.', fields.query, [], record({ items: { type: 'array', items: detail }, total: { type: 'integer' }, nextOffset: { type: ['integer', 'null'] }, diagnostics: strings }), true),
  get: operation('Read a Quest, its steps, readiness and latest outcomes. Worker completion is delivered automatically; do not poll.', object({ id: fields.id, inspect: fields.inspect }, ['id']), ['id']),
  status: operation('Read a compact saved status and step states immediately. Includes revision; no waiting or evidence bodies.', object({ id: text }, ['id']), ['id'], detail, true),
  plan: operation('Read the description, workflow, dependencies and step readiness without historical outcomes or long result notes.', object({ id: text }, ['id']), ['id'], detail, true),
  inspect: operation('Read one evidence section. Offset counts whole entries and limit targets characters, not items. Results retain complete entries.', object({ id: text, ...fields.inspect.properties }, ['id', 'section']), ['id', 'section'], page, true),
  create: operation('Save a Quest in the selected project with a description and checkable steps. Workflow model selection is optional and user controlled.', fields.create),
  update: operation('Save Quest changes. Supply at least one change alongside id. Workers may update only assigned step states and notes. Returns the saved Quest in the same shape get returns, so verifying with a following get repeats a payload you already hold.', { ...object({ id: fields.id, ...fields.update.properties }, ['id']), minProperties: 2 }, ['id']),
  report: operation('Save one assigned step state and its evidence. Returns the saved revision and step; workers cannot change definitions or global artifacts.', object({ id: text, stepID: text, state: { enum: ['pending', 'working', 'blocked', 'done'] }, note: text }, ['id', 'stepID', 'state', 'note']), ['id', 'stepID'], detail),
  archive: operation('Turn in a Quest. Accept only finished steps with no active runs; archiving unfinished work requires accepted=false and a reason.', object({ id: text, accepted: { type: 'boolean' }, reason: text }, ['id', 'accepted']), ['id'], summary),
  reopen: operation('Reopen an archived Quest without losing its steps, results or history.', object({ id: text }, ['id']), ['id'], summary),
  start: operation('Start the saved Quest using its chosen project, task, optional model and delivery. Repeating start returns its existing admission.', object({ id: fields.id }, ['id']), ['id'], admission),
  run: operation('Dispatch selected steps or a continuation with explicit run options. Use start for the saved workflow.', object({ id: fields.id, ...fields.run.properties }, ['id']), ['id'], admission),
  wait: operation('Wait for saved worker progress instead of polling. Completion also wakes the giver automatically.', object({ id: fields.id, ...fields.wait.properties }, ['id']), ['id']),
}

/** Adapt the public method arguments to the existing internal coordinator request. */
export function coordinatorInput(method, input) {
  const { id, ...value } = input
  if (method === 'status' || method === 'plan') return { action: 'get', id }
  if (method === 'inspect') return { action: 'get', id, inspect: value }
  if (method === 'report') return { action: 'update', id, update: { steps: [{ id: value.stepID, state: value.state, note: value.note }] } }
  if (method === 'archive') return { action: 'update', id, update: { archive: value } }
  if (method === 'reopen') return { action: 'update', id, update: { archive: null } }
  if (method === 'list') return { action: method, query: value }
  if (method === 'create') return { action: method, create: value }
  if (method === 'get' || method === 'start') return { action: method, ...input }
  return { action: method, id, [method]: value }
}
