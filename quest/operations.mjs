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
  query: object({ allProjects: { type: 'boolean' }, archived: { type: 'boolean' }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 } }),
  inspect: object({
    section: { enum: ['description', 'reward', 'steps', 'runs', 'artifacts', 'changes', 'continuation', 'cleanup'] },
    offset: { type: 'integer', minimum: 0, description: 'Whole-entry offset from nextOffset.' },
    limit: { type: 'integer', minimum: 1, maximum: 12000, description: 'Target page size in characters; individual records stay intact.' },
  }, ['section']),
  create: object({
    workflow, title: text, description: text, reward: text,
    steps: { type: 'array', minItems: 1, maxItems: 30, items: object({ id: text, title: text, detail: text, needs: strings, commandID: text }, ['title']) },
  }, ['title', 'description', 'steps']),
  update: object({
    workflow, title: text, description: text, reward: text, cancelContinuation: { type: 'boolean' },
    steps: { type: 'array', items: object({ id: text, title: text, state: { type: 'string', enum: ['pending', 'working', 'blocked', 'done'] }, detail: text, note: text, needs: strings }, ['id', 'state']) },
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
const output = { type: 'object', additionalProperties: true }
const operation = (description, input, positional = []) => ({ description, input, output, positional })

/** Public contract. CLI help, argument parsing and MCP discovery all consume these operations. */
export const questOperations = {
  list: operation('List Quests and their saved progress. Get a relevant Quest for its full current details.', fields.query),
  get: operation('Read a Quest, its steps, readiness and latest outcomes. Worker completion is delivered automatically; do not poll.', object({ id: fields.id, inspect: fields.inspect }, ['id']), ['id']),
  create: operation('Save a Quest in the selected project with a description and checkable steps. Workflow model selection is optional and user controlled.', fields.create),
  update: operation('Save Quest changes. Supply at least one change alongside id. Workers may update only assigned step states and notes. Get the Quest afterwards to verify.', { ...object({ id: fields.id, ...fields.update.properties }, ['id']), minProperties: 2 }, ['id']),
  start: operation('Start the saved Quest using its chosen project, task, optional model and delivery. Repeating start returns its existing admission.', object({ id: fields.id }, ['id']), ['id']),
  run: operation('Dispatch selected steps or a continuation with explicit run options. Use start for the saved workflow.', object({ id: fields.id, ...fields.run.properties }, ['id']), ['id']),
  wait: operation('Wait for saved worker progress instead of polling. Completion also wakes the giver automatically.', object({ id: fields.id, ...fields.wait.properties }, ['id']), ['id']),
}

/** Adapt the public method arguments to the existing internal coordinator request. */
export function coordinatorInput(method, input) {
  const { id, ...value } = input
  if (method === 'list') return { action: method, query: value }
  if (method === 'create') return { action: method, create: value }
  if (method === 'get' || method === 'start') return { action: method, ...input }
  return { action: method, id, [method]: value }
}
