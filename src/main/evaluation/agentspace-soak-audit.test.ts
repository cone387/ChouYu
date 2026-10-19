import { expect, it } from 'vitest'
import { auditAgentSpaceSoak } from './agentspace-soak-audit'

const evidence = () => ({ elapsedMs: 86410000, observedMs: 86400000, samples: 17281, appStarts: 2, workerRestarted: true,
  pauseVerified: true, duplicateMessages: 0, storageErrors: 0, native: { completed: 2, calls: 10, reportedTokens: 2000 },
  dsh: { completed: 2, calls: 12, reportedTokens: 2400 }, sdkSessions: 4, actualReviews: 2 })

it('requires a full observed day, rather than a configured duration or wall clock alone', () => {
  expect(auditAgentSpaceSoak(evidence())).toEqual([])
  expect(auditAgentSpaceSoak({ ...evidence(), observedMs: 300000 })).toContain('observed-duration')
  expect(auditAgentSpaceSoak({ ...evidence(), elapsedMs: 300000 })).toContain('wall-duration')
})
it('requires both actual engines, reported usage and DSH SDK execution', () => {
  expect(auditAgentSpaceSoak({ ...evidence(), dsh: { completed: 0, calls: 0, reportedTokens: 0 } })).toContain('dsh-work')
  expect(auditAgentSpaceSoak({ ...evidence(), native: { completed: 2, calls: 10, reportedTokens: 0 } })).toContain('native-work')
  expect(auditAgentSpaceSoak({ ...evidence(), sdkSessions: 0 })).toContain('dsh-sdk')
})
it('requires pause, both process recovery levels and actual reading of saved work', () => {
  const failures = auditAgentSpaceSoak({ ...evidence(), pauseVerified: false, appStarts: 1, workerRestarted: false, actualReviews: 0 })
  expect(failures).toEqual(expect.arrayContaining(['pause', 'app-restart', 'worker-restart', 'saved-output-reading']))
})
it('refuses duplicate delivery and observed storage errors', () => {
  expect(auditAgentSpaceSoak({ ...evidence(), duplicateMessages: 1, storageErrors: 1 })).toEqual(expect.arrayContaining(['duplicate-delivery', 'storage-errors']))
})
