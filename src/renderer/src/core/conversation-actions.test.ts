import { describe, expect, it } from 'vitest'
import type { Message } from '../shared/types'
import { getConversationForRetry } from './conversation-actions'

function message(id: string, role: Message['role'], content = id): Message {
  return { id, role, content, timestamp: 1 }
}

describe('conversation retry actions', () => {
  it('returns the conversation before the latest assistant response', () => {
    const messages = [message('u1', 'user'), message('a1', 'assistant')]
    expect(getConversationForRetry(messages, 'a1')).toEqual([messages[0]])
  })

  it('does not retry a response that is no longer the latest message', () => {
    const messages = [message('u1', 'user'), message('a1', 'assistant'), message('u2', 'user')]
    expect(getConversationForRetry(messages, 'a1')).toBeNull()
  })

  it('does not route plugin results through the AI retry path', () => {
    const messages: Message[] = [
      message('u1', 'user'),
      {
        ...message('plugin', 'assistant'),
        pluginData: {
          pluginId: 'test',
          pluginName: 'Test',
          ok: true,
          message: 'done',
          inputContent: 'input'
        }
      }
    ]
    expect(getConversationForRetry(messages, 'plugin')).toBeNull()
  })
})
