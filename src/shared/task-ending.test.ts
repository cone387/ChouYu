import { expect, it } from 'vitest'
import { applyTaskEnding, endingState, recordOccurrence } from './task-ending'
const acceptedAt = Date.parse('2026-10-26T04:00:00Z')
const context = { acceptedAt, timeZone: 'Asia/Shanghai', text: '截至2026年10月27日，成功发送3次', isNew: true, calendar: true }
it('requires a new explicit count anchor when restored history is incomplete', () => {
  const old = { ...applyTaskEnding(undefined, { count: { mode: 'delivered', amount: 3, source: context.text } }, context)!, historyUnknown: true }
  expect(endingState(old, acceptedAt).reason).toBe('history-unknown')
  expect(() => applyTaskEnding(old, { count: { mode: 'delivered', amount: 4, source: context.text } }, { ...context, isNew: false })).toThrow()
  const next = applyTaskEnding(old, { count: { mode: 'delivered', amount: 2, fromNow: true, source: '再发送2次' } }, { ...context, text: '再发送2次', isNew: false })!
  expect(endingState(next, acceptedAt).stopped).toBe(false)
})
it('rejects an impossible calendar date inside an ISO instant', () => {
  expect(() => applyTaskEnding(undefined, { deadline: { kind: 'instant', value: '2026-02-30T12:00:00+08:00', source: context.text } }, context)).toThrow()
})
it('stores an exclusive local date boundary and preserves anchors/counters on unrelated edits', () => {
  const ending = applyTaskEnding(undefined, { deadline: { kind: 'date', value: '2026-10-27', source: '截至2026年10月27日' } }, context)!
  expect(ending.deadline!.at).toBe(Date.parse('2026-10-27T16:00:00Z'))
  expect(endingState(ending, ending.deadline!.at - 1).stopped).toBe(false)
  expect(endingState(ending, ending.deadline!.at).reason).toBe('deadline')
  expect(applyTaskEnding(ending, undefined, { ...context, acceptedAt: acceptedAt + 86400000 })).toEqual(ending)
})
it('requires an explicitly finite relative duration and anchors it once', () => {
  const patch = { deadline: { kind: 'duration', value: 24 * 3600000, source: '只工作24小时后结束' } }
  const ending = applyTaskEnding(undefined, patch, { ...context, text: patch.deadline.source })!
  expect(ending.deadline!.at).toBe(acceptedAt + 86400000)
  expect(() => applyTaskEnding(undefined, { deadline: { ...patch.deadline, source: '24h持续工作' } }, { ...context, text: '24h持续工作' })).toThrow()
  expect(() => applyTaskEnding(undefined, patch, context)).toThrow()
})
it('blocks the next occurrence when the last result is prepared but unsent and counts receipts once', () => {
  let ending = applyTaskEnding(undefined, { count: { mode: 'delivered', amount: 3, source: '成功发送3次' } }, context)!
  ending = recordOccurrence(ending, 'one', 'delivered', acceptedAt)
  ending = recordOccurrence(ending, 'two', 'delivered', acceptedAt)
  ending = recordOccurrence(ending, 'three', 'produced', acceptedAt)
  expect(endingState(ending, acceptedAt)).toMatchObject({ stopped: true, reason: 'delivery-pending', produced: 3, delivered: 2 })
  ending = recordOccurrence(ending, 'three', 'delivered', acceptedAt)
  expect(recordOccurrence(ending, 'three', 'delivered', acceptedAt)).toEqual(ending)
  expect(endingState(ending, acceptedAt)).toMatchObject({ reason: 'count', delivered: 3 })
  const more = applyTaskEnding(ending, { count: { mode: 'delivered', amount: 2, fromNow: true, source: '再发送2次' } }, { ...context, text: '再发送2次', isNew: false })!
  expect(more.count!.target).toBe(5)
  expect(endingState(more, acceptedAt).delivered).toBe(3)
})
it('does not invent old success totals or turn content goals into calendar occurrence counts', () => {
  const patch = { count: { mode: 'produced', amount: 3, source: '成功发送3次' } }
  expect(() => applyTaskEnding(undefined, patch, { ...context, isNew: false })).toThrow()
  expect(() => applyTaskEnding(undefined, patch, { ...context, calendar: false })).toThrow()
})
