import { migrateQuestContract } from "./contract"
import { QuestStore } from "./store"
import { projectIdentity } from "./project"
import type { Quest } from "./types"

export function previewContractMigration(store: QuestStore, id: string, projectDirectory?: string) {
  const before = store.read(id)
  if (!before) throw new Error("Quest not found: " + id)
  const quest=migrateQuestContract(before), project=projectDirectory?projectIdentity(projectDirectory):before.project
  if(before.project&&project&&before.project.id!==project.id)throw new Error("Migration cannot reassign an already owned Quest")
  if(project)quest.project=project
  return { id, revision: before.revision, changed: before.contractVersion !== 2 || !before.project && !!project, ownership: project ? "bound" : "unresolved", quest }
}

export function applyContractMigration(store: QuestStore, id: string, expectedRevision: number, projectDirectory?: string): Quest {
  const preview = previewContractMigration(store, id, projectDirectory)
  if (preview.revision !== expectedRevision) throw new Error("Quest changed since migration preview; preview again")
  if (!preview.changed) return preview.quest
  const q = preview.quest
  return store.apply(id, "patched", { contractVersion: 2, description: q.description, reward: q.reward, archive: q.archive, project: q.project, stages: q.stages }, "quest:contract-migration", { expectedRevision, backupContract: true })
}
