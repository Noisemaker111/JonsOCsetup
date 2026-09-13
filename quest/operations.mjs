import { QUEST_TOOL_INPUT } from './tool-schema.mjs'

const fields = QUEST_TOOL_INPUT.properties
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false })
const output = { type: 'object', additionalProperties: true }
const operation = (description, input, positional = []) => ({ description, input, output, positional })

/** Public contract. CLI help, argument parsing and MCP discovery all consume these operations. */
export const questOperations = {
  list: operation('List Quests and their saved progress. Get a relevant Quest for its full current details.', fields.query),
  get: operation('Read a Quest, its steps, readiness and latest outcomes. Worker completion is delivered automatically; do not poll.', object({ id: fields.id, inspect: fields.inspect }, ['id']), ['id']),
  create: operation('Save a Quest in the selected project with a description and checkable steps. Workflow model selection is optional and user controlled.', fields.create),
  update: operation('Save Quest changes. Workers may update only assigned step states and notes. Get the Quest afterwards to verify.', object({ id: fields.id, ...fields.update.properties }, ['id']), ['id']),
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
