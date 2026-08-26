import { describe, expect, it } from 'vitest'
import { parseClaudeStreamLine, parseOpenAIStreamLine } from './ai-engine'

describe('AI stream parsers', () => {
  it('parses OpenAI-compatible text and completion events', () => {
    expect(parseOpenAIStreamLine('data:{"choices":[{"delta":{"content":"你"}}]}')).toEqual({
      text: '你',
      done: false
    })
    expect(parseOpenAIStreamLine('data: [DONE]')).toEqual({ text: '', done: true })
    expect(parseOpenAIStreamLine('event: ping')).toBeNull()
  })

  it('ignores malformed OpenAI-compatible events', () => {
    expect(parseOpenAIStreamLine('data: not-json')).toBeNull()
  })

  it('parses Claude text and completion events', () => {
    expect(parseClaudeStreamLine('data: {"type":"content_block_delta","delta":{"text":"好"}}')).toEqual({
      text: '好',
      done: false
    })
    expect(parseClaudeStreamLine('data: {"type":"message_stop"}')).toEqual({ text: '', done: true })
  })
})
