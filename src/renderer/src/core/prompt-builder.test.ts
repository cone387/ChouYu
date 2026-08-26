import { describe, expect, it } from 'vitest'
import { DEFAULT_SOUL_MD } from '../../../shared/config'
import { buildMessages, buildSystemPrompt } from './prompt-builder'
import type { Message } from '../shared/types'

describe('prompt builder', () => {
  it('uses the default soul for empty input and trims a custom soul', () => {
    expect(buildSystemPrompt('')).toBe(DEFAULT_SOUL_MD)
    expect(buildSystemPrompt('  自定义人格  ')).toBe('自定义人格')
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
})
