import { expect, test } from 'vitest'
import { mergeForeignMessages } from './notification-messages'
import type { Message } from '../shared/types'
test('late notification snapshots cannot roll back a completed stream', () => {
  const final: Message = { id: 'reply', role: 'assistant', content: 'first chunk plus final chunk', timestamp: 1 }
  const notice: Message = { id: 'notice', role: 'assistant', content: 'take a break', timestamp: 2, assistantKind: 'rest' }
  expect(mergeForeignMessages([final], [{ ...final, content: 'first chunk' }, notice])).toEqual([final, notice])
  expect(mergeForeignMessages([final, notice], [notice])).toEqual([final, notice])
})
test('projects the saved read boundary per message while keeping a new followup unread', () => {
  const original: Message = { id: 'original', role: 'assistant', content: 'hello', timestamp: 1, reminderIds: ['a'] }
  const followup: Message = { ...original, id: 'followup', timestamp: 3, reminderFollowup: true }
  const merged = mergeForeignMessages([], [original, followup], 2)
  expect(merged[0].reminderReadIds).toEqual(['a'])
  expect(merged[1].reminderReadIds).toBeUndefined()
})
test('refreshes manual read receipts without overwriting text or rolling back a newer receipt', () => {
  const original: Message = { id: 'original', role: 'assistant', content: 'saved text', timestamp: 1, reminderIds: ['a'] }
  const read = mergeForeignMessages([original], [{ ...original, content: 'stale text', reminderReadIds: ['a'] }])
  expect(read[0]).toEqual({ ...original, reminderReadIds: ['a'] })
  expect(mergeForeignMessages(read, [original])[0]).toEqual(read[0])
})
