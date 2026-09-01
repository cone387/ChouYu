import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_APP_CONFIG } from '../../../shared/config'
import { joinApiUrl, parseClaudeStreamLine, parseOpenAIStreamLine, streamChat } from './ai-engine'

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

  it('normalizes and validates API URLs', () => {
    expect(joinApiUrl('https://api.example.com/v1/', '/chat/completions')).toBe(
      'https://api.example.com/v1/chat/completions'
    )
    expect(() => joinApiUrl('not-a-url', 'messages')).toThrow('Base URL 格式无效')
    expect(() => joinApiUrl('file:///tmp/api', 'messages')).toThrow('只支持 HTTP 或 HTTPS')
  })

  it('fails early when credentials are missing', async () => {
    await expect(streamChat([], '', { ...DEFAULT_APP_CONFIG, apiKey: '' }, vi.fn())).rejects.toThrow(
      '尚未配置 API Key'
    )
  })

  it('exposes the request id before streaming so events can be routed by session', async () => {
    let streamListener: ((event: { requestId: string; chunk: string; done: boolean }) => void) | undefined
    const onRequestStart = vi.fn()
    const onChunk = vi.fn()
    vi.stubGlobal('window', {
      electronAPI: {
        ai: {
          onStreamEvent(callback: typeof streamListener) { streamListener = callback; return () => {} },
          cancelStream: vi.fn(),
          async startStream(request: { requestId: string }) {
            streamListener?.({ requestId: request.requestId, chunk: '好', done: false })
            streamListener?.({ requestId: request.requestId, chunk: '', done: true })
            return { ok: true }
          }
        }
      }
    })

    await streamChat([], '', { ...DEFAULT_APP_CONFIG, apiKey: 'key', model: 'model' }, onChunk, undefined, onRequestStart)

    expect(onRequestStart).toHaveBeenCalledOnce()
    expect(onChunk).toHaveBeenCalledWith('好', false)
    expect(onChunk).toHaveBeenCalledWith('', true)
    vi.unstubAllGlobals()
  })
})
