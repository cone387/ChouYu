import { describe, expect, it } from 'vitest'
import { DEFAULT_SOUL_MD } from '../../../shared/config'
import { buildMessages, buildSystemPrompt } from './prompt-builder'
import type { Message } from '../shared/types'

describe('prompt builder', () => {
  it('uses the default soul for empty input and trims a custom soul', () => {
    expect(buildSystemPrompt('')).toBe(DEFAULT_SOUL_MD)
    expect(buildSystemPrompt('  自定义人格  ')).toBe('自定义人格')
    expect(buildSystemPrompt('人格', '长期记忆')).toBe('人格\n\n长期记忆')
  })

  it('keeps only the newest configured number of messages', () => {
    const messages: Message[] = Array.from({ length: 35 }, (_, index) => ({
      id: String(index),
      role: 'user',
      content: String(index),
      timestamp: index
    }))

    const result = buildMessages(messages, 30)
    expect(result).toHaveLength(30)
    expect(result[0].content).toBe('5')
    expect(result.at(-1)?.content).toBe('34')
  })

  it('does not send UI-only tool timeline cards back as chat history', () => {
    const messages: Message[] = [
      { id: 'u', role: 'user', content: '现在几点？', timestamp: 1 },
      {
        id: 'tool',
        role: 'assistant',
        content: '',
        timestamp: 2,
        toolData: { callId: 'c', name: 'get_current_time', displayName: '获取当前时间', risk: 'safe', status: 'completed' }
      },
      { id: 'a', role: 'assistant', content: '现在是下午三点。', timestamp: 3 }
    ]
    expect(buildMessages(messages)).toEqual([messages[0], messages[2]])
  })
})
