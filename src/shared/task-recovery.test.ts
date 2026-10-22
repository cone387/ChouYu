import { expect, it } from 'vitest'
import { taskRecovery } from './task-recovery'

const source = { topicId: 'task', revision: 7, runId: 'run', automatic: true }
it('projects bounded network retry with its original source and conditions without mutating state', () => {
  const input = { ...source, state: { code: 'retry', description: '等待原调度重试' }, error: 'network timeout', retryAt: 5000 }
  const before = structuredClone(input)
  expect(taskRecovery(input)).toMatchObject({ reason: 'network', topicId: 'task', revision: 7, runId: 'run', retryAt: 5000, automatic: true, unknownExternalResult: false, allowedActions: ['retry'] })
  expect(taskRecovery(input)?.conditions.join('')).toContain('额度')
  expect(input).toEqual(before)
})
it.each(['task-budget', 'daily-limit', 'daily-budget'])('explains %s using the original resource state', code => {
  expect(taskRecovery({ ...source, state: { code, description: '原额度说明' } })).toMatchObject({ reason: 'budget', allowedActions: ['adjust-budget'], automatic: code === 'daily-budget' })
})
it('never turns a user pause or waiting question into an automatic retry', () => {
  expect(taskRecovery({ ...source, state: { code: 'paused', description: 'User pause' }, error: 'network timeout', retryAt: 5000 })).toMatchObject({ reason: 'paused', automatic: false, allowedActions: ['continue'] })
  expect(taskRecovery({ ...source, state: { code: 'waiting', description: 'Original question' } })).toMatchObject({ reason: 'answer', automatic: false, allowedActions: ['answer'] })
})
it('requires current permission and preserves checkpoint recovery as a distinct case', () => {
  expect(taskRecovery({ ...source, state: { code: 'failed', description: 'Failed' }, error: '未授权读取联系人的共享成果。' })).toMatchObject({ reason: 'permission', automatic: false, allowedActions: ['settings', 'retry'] })
  expect(taskRecovery({ ...source, state: { code: 'interrupted', description: 'Interrupted' } })).toMatchObject({ reason: 'checkpoint', runId: 'run' })
})
it('permits inspection only when an external result is unknown, even if an old retry time exists', () => {
  expect(taskRecovery({ ...source, state: { code: 'failed', description: 'timeout' }, unknownExternalResult: true, retryAt: 5000 })).toMatchObject({ reason: 'unknown-result', automatic: false, unknownExternalResult: true, allowedActions: ['inspect'] })
  expect(taskRecovery({ ...source, state: { code: 'completed', description: 'Done' } })).toBeUndefined()
})
