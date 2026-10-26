import { expect, it } from 'vitest'
import { ContactRecoveryGuard } from './recovery-guard'
import type { RecoveryReview } from '../../shared/contact-recovery'

function fixture() {
  const states = new Map<string, string>()
  const guard = new ContactRecoveryGuard(key => states.get(key) ?? null, (key, value) => { states.set(key, value) })
  guard.begin('group', 'restore', ['alice'])
  const review: RecoveryReview = { restoreId: 'restore', requestId: 'review-1', owner: 'alice', topicId: 'task',
    scopesReviewed: true, externalEffects: 'verified', evidence: '用户已逐项核对当前资料、权限和外部操作的实际结果。',
    daily: { calls: 2, tokens: 1000 }, task: { calls: 2, tokens: 1000 } }
  return { guard, review, states }
}
it('isolates restored scopes for old and new work, and does not revive removed contacts', () => {
  const { guard, review } = fixture()
  expect(() => guard.assertContext('alice')).toThrow(/核对/)
  expect(() => guard.reserve({ restoreId: 'restore', requestId: 'new-task', owner: 'alice', topicId: 'new', tokens: 5 })).toThrow()
  expect(() => guard.review({ ...review, owner: 'removed' })).toThrow()
  guard.review({ ...review, externalEffects: 'unresolved' })
  expect(guard.identity('alice')?.allowedTopics).toEqual([])
  expect(() => guard.reserve({ restoreId: 'restore', requestId: 'work', owner: 'alice', topicId: 'task', tokens: 5 })).toThrow(/外部操作/)
})
it('requires independent daily and task grants and idempotently charges requests outside the restored pair', () => {
  const { guard, review } = fixture()
  guard.review(review); guard.review(review)
  const request = { restoreId: 'restore', requestId: 'call-1', owner: 'alice', topicId: 'task', tokens: 800 }
  guard.reserve(request); guard.reserve(request)
  expect(() => guard.reserve({ ...request, requestId: 'call-2', tokens: 300 })).toThrow(/额度/)
  guard.settle('restore', 'call-1', 400)
  guard.reserve({ ...request, requestId: 'call-2', tokens: 600 })
  expect(() => guard.reserve({ ...request, requestId: 'call-3', tokens: 0 })).toThrow(/额度/)
  expect(guard.current()?.unknownHistory).toBe(true)
  expect(() => guard.review({ ...review, task: { calls: 999, tokens: 999999 } })).toThrow(/同一/)
})
it('keeps unknown reservations across process restart and never reuses grants after another restore', () => {
  const { guard, review, states } = fixture()
  guard.review(review)
  guard.reserve({ restoreId: 'restore', requestId: 'call', owner: 'alice', topicId: 'task', tokens: 1000 })
  const restarted = new ContactRecoveryGuard(key => states.get(key) ?? null, (key, value) => { states.set(key, value) })
  expect(() => restarted.reserve({ restoreId: 'restore', requestId: 'other', owner: 'alice', topicId: 'task', tokens: 1 })).toThrow()
  restarted.begin('group', 'restore-2', ['alice'])
  expect(() => restarted.review(review)).toThrow(/变化/)
  expect(states.get('contact-recovery:restore')).toContain('call')
  expect(restarted.identity('alice')?.allowedTopics).toEqual([])
})
it('does not accept a failed persisted review as authorization', () => {
  const { guard, review, states } = fixture()
  const broken = new ContactRecoveryGuard(key => states.get(key) ?? null, () => { throw new Error('disk full') })
  expect(() => broken.review(review)).toThrow('disk full')
  expect(guard.identity('alice')?.scopeReviewed).toBe(false)
})
