import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_APP_CONFIG } from '../shared/config'
import { streamAIChat } from './ai'

function streamResponse(lines: string): Response {
  return new Response(lines, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' }
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('main-process AI provider routing', () => {
  it('uses the saved OpenAI-compatible endpoint and bearer credentials', async () => {
    const fetchMock = vi.fn(async (_input: Parameters<typeof fetch>[0], _options?: Parameters<typeof fetch>[1]) => streamResponse(
      'data: {"choices":[{"delta":{"content":"你好"}}]}\n\ndata: [DONE]\n\n'
    ))
    vi.stubGlobal('fetch', fetchMock)
    const chunks: string[] = []

    await streamAIChat(
      [{ role: 'user', content: '你好' }],
      'system',
      { ...DEFAULT_APP_CONFIG, baseUrl: 'https://provider.example/v1/', apiKey: 'openai-key', model: 'custom-model' },
      (chunk) => { if (chunk) chunks.push(chunk) }
    )

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('https://provider.example/v1/chat/completions')
    expect((options?.headers as Record<string, string>).Authorization).toBe('Bearer openai-key')
    expect(JSON.parse(String(options?.body))).toMatchObject({ model: 'custom-model', stream: true })
    expect(chunks).toEqual(['你好'])
  })

  it('uses the Claude endpoint and Anthropic credentials when selected', async () => {
    const fetchMock = vi.fn(async (_input: Parameters<typeof fetch>[0], _options?: Parameters<typeof fetch>[1]) => streamResponse(
      'data: {"type":"content_block_delta","delta":{"text":"收到"}}\n\ndata: {"type":"message_stop"}\n\n'
    ))
    vi.stubGlobal('fetch', fetchMock)
    const chunks: string[] = []

    await streamAIChat(
      [{ role: 'user', content: '你好' }],
      'system',
      {
        ...DEFAULT_APP_CONFIG,
        provider: 'claude',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'claude-key',
        model: 'claude-test'
      },
      (chunk) => { if (chunk) chunks.push(chunk) }
    )

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect((options?.headers as Record<string, string>)['x-api-key']).toBe('claude-key')
    expect((options?.headers as Record<string, string>)['anthropic-version']).toBe('2023-06-01')
    expect(JSON.parse(String(options?.body))).toMatchObject({ model: 'claude-test', system: 'system', stream: true })
    expect(chunks).toEqual(['收到'])
  })
})
