export interface EngineSoakEvidence { completed: number; calls: number; reportedTokens: number }
export interface AgentSpaceSoakEvidence {
  elapsedMs: number; observedMs: number; samples: number; appStarts: number; workerRestarted: boolean; pauseVerified: boolean
  duplicateMessages: number; storageErrors: number; native: EngineSoakEvidence; dsh: EngineSoakEvidence
  sdkSessions: number; actualReviews: number
}

/** Only measured execution evidence can satisfy this gate; configuration is not evidence. */
export function auditAgentSpaceSoak(value: AgentSpaceSoakEvidence): string[] {
  const failed: string[] = []
  if (!(value.elapsedMs >= 86400000)) failed.push('wall-duration')
  if (!(value.observedMs >= 86400000) || !(value.samples >= 5760)) failed.push('observed-duration')
  for (const engine of ['native', 'dsh'] as const) {
    const work = value[engine]
    if (!(work.completed >= 2 && work.calls >= 2 && work.reportedTokens > 0)) failed.push(`${engine}-work`)
  }
  if (!(value.sdkSessions >= 2)) failed.push('dsh-sdk')
  if (!(value.appStarts >= 2)) failed.push('app-restart')
  if (!value.workerRestarted) failed.push('worker-restart')
  if (!value.pauseVerified) failed.push('pause')
  if (!(value.actualReviews >= 2)) failed.push('saved-output-reading')
  if (value.duplicateMessages !== 0) failed.push('duplicate-delivery')
  if (value.storageErrors !== 0) failed.push('storage-errors')
  return failed
}
