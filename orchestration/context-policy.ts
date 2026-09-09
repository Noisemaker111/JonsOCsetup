export type RecoveryManifest = { questID?: string; sessionID: string; parentSessionID?: string; model: string; queuedMessages: unknown[]; checkpoint?: unknown; evidence?: unknown; blockers?: string[]; resumeMetadata?: unknown }
export function contextPercent(used: number, limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return 0
  return Math.max(0, Math.min(100, Math.round(Math.max(0, used) / limit * 100)))
}
export function preserveRecoveryManifest(input: RecoveryManifest): RecoveryManifest { return { ...input, queuedMessages: [...input.queuedMessages], blockers: input.blockers ? [...input.blockers] : undefined } }
