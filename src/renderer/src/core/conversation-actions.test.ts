import { describe, expect, it } from 'vitest'
import type { Message } from '../shared/types'
import {
  getContinuationSeed,
  getConversationForRetry,
  getEditedConversation,
  STOPPED_PLACEHOLDER_CONTENT
} from './conversation-actions'

function userMessage(overrides: Partial<Message> = {}): Message {
  return { id: 'u1', role: 'user', content: '原始消息', timestamp: 1, ...overrides }
}

function assistantMessage(overrides: Partial<Message> = {}): Message {
  return { id: 'a1', role: 'assistant', content: '回复内容', timestamp: 2, ...overrides }
}

describe('getEditedConversation', () => {
  const messages = [
    userMessage({ id: 'u1', content: '第一条' }),
    assistantMessage({ id: 'a1' }),
    userMessage({ id: 'u2', content: '第二条' }),
    assistantMessage({ id: 'a2' })
  ]

  it('truncates after the edited message and replaces its content, keeping id and timestamp', () => {
    const edited = getEditedConversation(messages, 'u1', '改后的第一条')
    expect(edited).toEqual([userMessage({ id: 'u1', content: '改后的第一条', timestamp: 1 })])
  })

  it('edits the last user message without dropping it', () => {
    const only = [userMessage({ id: 'u1', content: '唯一' })]
    expect(getEditedConversation(only, 'u1', '改后')).toEqual([userMessage({ id: 'u1', content: '改后' })])
  })

  it('keeps the image attachment of the edited message', () => {
    const withImage = [userMessage({ id: 'u1', content: '带图', imageUrl: 'data:image/png;base64,x' })]
    expect(getEditedConversation(withImage, 'u1', '新文本')?.[0].imageUrl).toBe('data:image/png;base64,x')
  })

  it('preserves earlier messages when editing a mid-conversation message', () => {
    const edited = getEditedConversation(messages, 'u2', '改后的第二条')
    expect(edited).toEqual([
      userMessage({ id: 'u1', content: '第一条' }),
      assistantMessage({ id: 'a1' }),
      userMessage({ id: 'u2', content: '改后的第二条', timestamp: 1 })
    ])
  })

  it('returns null for tool/plugin user messages', () => {
    const toolUser = [userMessage({ toolData: { callId: 'c1', name: 'get_current_time', displayName: '时间', risk: 'safe', status: 'completed' } })]
    expect(getEditedConversation(toolUser, 'u1', 'x')).toBeNull()
    const pluginUser = [userMessage({ pluginData: { pluginId: 'p', pluginName: '插件', ok: true, message: '输出', inputContent: 'x' } })]
    expect(getEditedConversation(pluginUser, 'u1', 'x')).toBeNull()
  })

  it('returns null for unknown ids, assistant targets and blank content', () => {
    expect(getEditedConversation(messages, 'nope', 'x')).toBeNull()
    expect(getEditedConversation(messages, 'a1', 'x')).toBeNull()
    expect(getEditedConversation(messages, 'u1', '   ')).toBeNull()
    expect(getEditedConversation(messages, 'u1', '')).toBeNull()
  })
})

describe('getContinuationSeed', () => {
  it('returns the partial content of a stopped assistant message', () => {
    expect(getContinuationSeed([assistantMessage({ responseStatus: 'stopped' })], 'a1')).toBe('回复内容')
  })

  it('seeds empty for the stopped placeholder message', () => {
    const placeholder = assistantMessage({ content: STOPPED_PLACEHOLDER_CONTENT, responseStatus: 'stopped' })
    expect(getContinuationSeed([placeholder], 'a1')).toBe('')
  })

  it('returns null when the stopped message is no longer the last message', () => {
    const stopped = assistantMessage({ id: 'a1', responseStatus: 'stopped' })
    const messages = [userMessage({ id: 'u1' }), stopped, userMessage({ id: 'u2', content: '追问' })]
    expect(getContinuationSeed(messages, 'a1')).toBeNull()
  })

  it('returns null unless the target is a stopped plain assistant message', () => {
    expect(getContinuationSeed([assistantMessage()], 'a1')).toBeNull()
    expect(getContinuationSeed([assistantMessage({ responseStatus: 'error' })], 'a1')).toBeNull()
    expect(getContinuationSeed([userMessage()], 'u1')).toBeNull()
    expect(getContinuationSeed([], 'a1')).toBeNull()
    const withTool = assistantMessage({
      responseStatus: 'stopped',
      toolData: { callId: 'c1', name: 'get_current_time', displayName: '获取当前时间', risk: 'safe', status: 'completed' }
    })
    expect(getContinuationSeed([withTool], 'a1')).toBeNull()
  })
})

describe('getConversationForRetry stays intact', () => {
  it('still truncates to the last user message for the final assistant reply', () => {
    const messages = [
      userMessage({ id: 'u1' }),
      assistantMessage({ id: 'a1' })
    ]
    expect(getConversationForRetry(messages, 'a1')).toEqual([userMessage({ id: 'u1' })])
  })
})

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

  it('retries the full turn when tool activity sits between user and final answer', () => {
    const messages: Message[] = [
      message('u1', 'user'),
      { ...message('tool', 'assistant'), toolData: { callId: 'c1', name: 'get_current_time', displayName: '获取当前时间', risk: 'safe', status: 'completed' } },
      message('a1', 'assistant')
    ]
    expect(getConversationForRetry(messages, 'a1')).toEqual([messages[0]])
  })
})
