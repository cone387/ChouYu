import { expect, test } from 'vitest'
import { mergeForeignMessages } from './notification-messages'
import type { Message } from '../shared/types'
test('late notification snapshots cannot roll back a completed stream', () => {
  const final: Message = { id: 'reply', role: 'assistant', content: 'first chunk plus final chunk', timestamp: 1 }
  const notice: Message = { id: 'notice', role: 'assistant', content: 'take a break', timestamp: 2, assistantKind: 'rest' }
  expect(mergeForeignMessages([final], [{ ...final, content: 'first chunk' }, notice])).toEqual([final, notice])
  expect(mergeForeignMessages([final, notice], [notice])).toEqual([final, notice])
})
