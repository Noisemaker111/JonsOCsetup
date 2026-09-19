import type { StartRun } from './api'
import type { QuestStore } from './store'
import { startQuestRun, type QuestHost } from './runtime'
import { configuredDispatchPolicyFile } from '../models/dispatch-planner'
import { trackedStart } from './outcome-tracking'
import { QuestWorkerReturns } from './worker-returns'

/** All Quest entry points register measurement and a return before admitting a worker.
 * The installed Quest tool owns reconciliation/delivery polling; this adds no scheduler.
 */
export function questDispatch(store: QuestStore, host: QuestHost, options: { policyFile?: string; settingsFile?: string; startRun?: StartRun } = {}) {
  const launch = options.startRun ?? startQuestRun(store, host, {
    policyFile: options.policyFile ?? configuredDispatchPolicyFile(),
    settingsFile: options.settingsFile,
  })
  const returns = new QuestWorkerReturns(store, host)
  const start = trackedStart(store, async input => {
    await returns.watch(input)
    return launch(input)
  }, options.settingsFile)
  return { start, returns }
}
