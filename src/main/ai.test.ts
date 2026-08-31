import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_APP_CONFIG } from '../shared/config'
import { accumulateClaudeToolCalls, accumulateOpenAIToolCalls, diagnoseProvider, fetchProviderModels, streamAIChat } from './ai'

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

describe('provider model diagnostics', () => {
  it('reports missing provider fields without attempting a network request', async () => {
    const request = vi.fn() as typeof fetch
    const result = await diagnoseProvider({ ...DEFAULT_APP_CONFIG }, request)
    expect(result.state).toBe('unconfigured')
    expect(result.modelList.errorCode).toBe('missing-base-url')
    expect(result.embedding.state).toBe('disabled')
    expect(request).not.toHaveBeenCalled()
  })

  it('probes embedding support separately from model listing', async () => {
    const request = vi.fn(async (input: Parameters<typeof fetch>[0]) => String(input).endsWith('/models')
      ? Response.json({ data: [{ id: 'chat-model' }] })
      : Response.json({ data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }] })) as typeof fetch
    const result = await diagnoseProvider({
      ...DEFAULT_APP_CONFIG,
      baseUrl: 'https://provider.example/v1',
      apiKey: 'key',
      model: 'chat-model',
      embeddingEnabled: true,
      embeddingProvider: 'openai-compatible',
      embeddingModel: 'embed-model'
    }, request)
    expect(result.state).toBe('ready')
    expect(result.embedding).toMatchObject({ state: 'ready', dimensions: 3 })
    expect(request).toHaveBeenCalledTimes(2)
  })
  it('falls back to /v1/models and reports the corrected base URL', async () => {
    const request = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input)
      if (url.endsWith('/v1/models')) {
        return Response.json({ data: [{ id: 'model-a' }, { id: 'model-b' }] })
      }
      return new Response('<html>home</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' }
      })
    }) as typeof fetch

    const result = await fetchProviderModels({
      ...DEFAULT_APP_CONFIG,
      baseUrl: 'https://provider.example',
      apiKey: 'key',
      model: 'model-b'
    }, request)

    expect(result).toMatchObject({
      ok: true,
      models: ['model-a', 'model-b'],
      baseUrl: 'https://provider.example/v1',
      baseUrlAdjusted: true,
      configuredModelValid: true
    })
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('distinguishes authentication failures from an empty model list', async () => {
    const request = vi.fn(async () => Response.json(
      { error: { message: 'invalid key' } },
      { status: 401 }
    )) as typeof fetch

    const result = await fetchProviderModels({
      ...DEFAULT_APP_CONFIG,
      baseUrl: 'https://provider.example/v1',
      apiKey: 'bad-key'
    }, request)

    expect(result).toMatchObject({
      ok: false,
      errorCode: 'authentication',
      httpStatus: 401,
      models: []
    })
    expect(result.message).toContain('API Key')
  })

  it('reports when the configured model is not offered by the provider', async () => {
    const request = vi.fn(async () => Response.json({ data: [{ id: 'available-model' }] })) as typeof fetch

    const result = await fetchProviderModels({
      ...DEFAULT_APP_CONFIG,
      baseUrl: 'https://provider.example/v1',
      apiKey: 'key',
      model: 'missing-model'
    }, request)

    expect(result.ok).toBe(true)
    expect(result.configuredModelValid).toBe(false)
  })
})

describe('provider tool-call stream parsing', () => {
  it('assembles fragmented OpenAI tool calls', () => {
    const calls = new Map<number, { id: string; name: string; arguments: string }>()
    accumulateOpenAIToolCalls({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_', function: { name: 'read_', arguments: '{"' } }] } }] }, calls)
    accumulateOpenAIToolCalls({ choices: [{ delta: { tool_calls: [{ index: 0, id: '1', function: { name: 'clipboard', arguments: 'x":1}' } }] } }] }, calls)
    expect(calls.get(0)).toEqual({ id: 'call_1', name: 'read_clipboard', arguments: '{"x":1}' })
  })

  it('assembles Claude tool input JSON deltas', () => {
    const calls = new Map<number, { id: string; name: string; arguments: string }>()
    accumulateClaudeToolCalls({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tool_1', name: 'write_clipboard', input: {} } }, calls)
    accumulateClaudeToolCalls({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"text":' } }, calls)
    accumulateClaudeToolCalls({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"hello"}' } }, calls)
    expect(calls.get(1)).toEqual({ id: 'tool_1', name: 'write_clipboard', arguments: '{"text":"hello"}' })
  })

  it('executes an OpenAI tool call and continues the streamed answer', async () => {
    const responses = [
      streamResponse('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"get_current_time","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n'),
      streamResponse('data: {"choices":[{"delta":{"content":"现在是下午三点"}}]}\n\ndata: [DONE]\n\n')
    ]
    const fetchMock = vi.fn(async (_input: Parameters<typeof fetch>[0], _options?: Parameters<typeof fetch>[1]) => responses.shift()!)
    vi.stubGlobal('fetch', fetchMock)
    const execute = vi.fn(async () => '{"formatted":"下午三点"}')
    const chunks: string[] = []

    await streamAIChat(
      [{ role: 'user', content: '现在几点？' }],
      'system',
      { ...DEFAULT_APP_CONFIG, baseUrl: 'https://provider.example/v1', apiKey: 'key', model: 'tool-model' },
      (chunk) => { if (chunk) chunks.push(chunk) },
      undefined,
      {
        definitions: [{
          name: 'get_current_time',
          displayName: '获取当前时间',
          description: '获取时间',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
          risk: 'safe',
          requiresConfirmation: false,
          source: 'builtin'
        }],
        execute
      }
    )

    expect(execute).toHaveBeenCalledWith({ id: 'call_1', name: 'get_current_time', arguments: '{}' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body))
    expect(secondBody.messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'call_1' })
    expect(chunks).toEqual(['现在是下午三点'])
  })
})
