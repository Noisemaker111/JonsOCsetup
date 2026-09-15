import { configuredDispatchPolicyFile, dispatchPlanInput } from '../../models/dispatch-planner'
import { questWorkflow } from '../workflow'
import { workflowAPI } from '../tui-workflow'
import type { Quest } from '../types'
import type { QuestStore } from '../store'

export async function chooseQuestRouting(context: any, store: QuestStore, quest: Quest) {
  const workflow = questWorkflow(quest)
  const plan = await dispatchPlanInput({ policyFile: configuredDispatchPolicyFile(), task: workflow.task })
  const allowed = new Set(plan.request.allowedRouteIDs)
  const model = await context.ui.dialog.select({
    title: 'Worker routing · ' + (workflow.task ?? 'coding'), current: workflow.model ?? 'auto',
    options: [
      { value: 'auto', title: 'Automatic · choose for each task', description: 'Use your allowed accounts, current usage, pricing and task evidence' },
      ...plan.routes.filter(route => allowed.has(route.id)).map(route => ({
        value: 'route:' + route.id,
        title: route.providerID + '/' + route.modelID + ' · ' + route.reasoning,
        description: (plan.snapshot.accounts.find(account => account.id === route.accountID)?.provider ?? 'Unknown account') + ' · ' + (plan.accounts.find(account => account.id === route.accountID)?.billing ?? 'unknown billing') + (route.verified ? '' : ' · availability unverified'),
      })),
    ],
  })
  if (!model) return
  const { model: previous, ...settings } = workflow
  ;(await workflowAPI(context, store, quest)).update(quest.id, { workflow: { ...settings, ...(model === 'auto' ? {} : { model }) } })
}
