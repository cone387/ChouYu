import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_APP_CONFIG } from '../../../shared/config'
import { streamNativeChat } from './runner'
import { accumulateClaudeToolCalls } from './providers/claude'
import { accumulateOpenAIToolCalls } from './providers/openai'

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
  it('exposes every tool-loop request to budget hooks and can stop before the next request', async () => {
    const start = vi.fn((round: number, input: string) => { if (round === 1) { expect(input).toContain('actual tool result'); throw new Error('budget exhausted') }; return 900 })
    const end = vi.fn()
    const request = vi.fn(async () => streamResponse('data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call1', function: { name: 'read_skill_file', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] }) + '\n\ndata: [DONE]\n\n'))
    vi.stubGlobal('fetch', request)
    await expect(streamNativeChat([{ role: 'user', content: 'work' }], 'system', { ...DEFAULT_APP_CONFIG, provider: 'openai', baseUrl: 'https://provider.example/v1', apiKey: 'test', model: 'test' }, () => {}, undefined,
      { definitions: [{ name: 'read_skill_file', displayName: 'read', description: 'read', source: 'builtin', risk: 'read', requiresConfirmation: false, inputSchema: { type: 'object', properties: {} } }], execute: async () => 'actual tool result' },
      { beforeRound: start, afterRound: end })).rejects.toThrow('budget exhausted')
    expect(start).toHaveBeenCalledTimes(2); expect(end).toHaveBeenCalledTimes(1); expect(request).toHaveBeenCalledTimes(1)
  })
  it.each(['openai', 'claude'] as const)('passes an explicit background output cap to %s', async provider => {
    const request = vi.fn(async () => streamResponse(provider === 'openai' ? 'data: [DONE]\n\n' : 'data: {"type":"message_stop"}\n\n'))
    vi.stubGlobal('fetch', request)
    await streamNativeChat([{ role: 'user', content: '研究资料' }], 'system', { ...DEFAULT_APP_CONFIG, provider, baseUrl: 'https://provider.example/v1', apiKey: 'test', model: 'test' }, () => {}, undefined, undefined, { maxOutputTokens: 2200 })
    expect(JSON.parse((request.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).max_tokens).toBe(2200)
    expect(request).toHaveBeenCalledTimes(1)
  })
  it.each(['as-glm-5.2', 'as-glm-5.3'])('applies disabled thinking only to the explicitly configured model: %s', async model => {
    const request = vi.fn(async () => streamResponse('data: [DONE]\n\n'))
    vi.stubGlobal('fetch', request)
    await streamNativeChat([{ role: 'user', content: '今天的任务' }], 'system', { ...DEFAULT_APP_CONFIG, baseUrl: 'https://provider.example/v1', apiKey: 'test', model, thinkingDisabledModels: ['as-glm-5.2'] }, () => {})
    const body = JSON.parse((request.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(body.thinking).toEqual(model === 'as-glm-5.2' ? { type: 'disabled' } : undefined)
  })
  it.each(['openai', 'claude'] as const)('allows %s to resolve, search, read, mutate and then summarize a task', async provider => {
    const names = ['list_task_projects', 'search_tasks', 'get_task', 'update_task']
    let round = 0
    const fetchMock = vi.fn(async () => {
      const name = names[round++]
      const payload = provider === 'openai'
        ? { choices: [{ delta: name ? { tool_calls: [{ index: 0, id: `call_${round}`, function: { name, arguments: '{}' } }] } : { content: '任务已更新' } }] }
        : name ? { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: `call_${round}`, name, input: {} } }
          : { type: 'content_block_delta', delta: { type: 'text_delta', text: '任务已更新' } }
      return streamResponse(`data: ${JSON.stringify(payload)}\n\ndata: ${provider === 'openai' ? '[DONE]' : '{"type":"message_stop"}'}\n\n`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const execute = vi.fn(async () => '{}'), chunks: string[] = []
    await streamNativeChat([{ role: 'user', content: '修改这个任务' }], 'system', { ...DEFAULT_APP_CONFIG, provider, baseUrl: 'https://provider.example/v1', apiKey: 'test', model: 'test' }, chunk => { if (chunk) chunks.push(chunk) }, undefined, { definitions: [], execute })
    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(execute).toHaveBeenCalledTimes(4)
    expect(chunks).toEqual(['任务已更新'])
  })
  it.each(['openai', 'claude'] as const)('finishes %s at the protocol end without waiting for the connection to close', async provider => {
    const cancel = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(provider === 'openai'
          ? 'data: {"choices":[{"delta":{"content":"完成"}}]}\n\ndata: [DONE]\n\n'
          : 'data: {"type":"content_block_delta","delta":{"text":"完成"}}\n\ndata: {"type":"message_stop"}\n\n'))
      }, cancel
    }))))
    const chunk = vi.fn()
    await streamNativeChat([{ role: 'user', content: 'test' }], 'system', { ...DEFAULT_APP_CONFIG, provider, baseUrl: 'https://provider.example/v1', apiKey: 'test', model: 'test' }, chunk)
    expect(chunk).toHaveBeenCalledWith('完成', false)
    expect(chunk).toHaveBeenLastCalledWith('', true)
    expect(cancel).toHaveBeenCalledOnce()
  })

  it.each(['openai', 'claude'] as const)('keeps active %s streams alive past 60 seconds but aborts a stalled stream', async provider => {
    vi.useFakeTimers()
    try {
      let stream!: ReadableStreamDefaultController<Uint8Array>
      let signal!: AbortSignal
      vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
        signal = options.signal
        return new Response(new ReadableStream({ start(controller) {
          stream = controller
          signal.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true })
        } }))
      }))
      const chunk = vi.fn()
      const outcome = streamNativeChat([{ role: 'user', content: 'test' }], 'system', { ...DEFAULT_APP_CONFIG, provider, baseUrl: 'https://provider.example/v1', apiKey: 'test', model: 'test' }, chunk).catch(error => error)
      const event = provider === 'openai' ? { choices: [{ delta: { content: '继续' } }] } : { type: 'content_block_delta', delta: { text: '继续' } }
      for (let i = 0; i < 3; i++) {
        await vi.advanceTimersByTimeAsync(40_000)
        stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
        await vi.advanceTimersByTimeAsync(0)
        expect(signal.aborted).toBe(false)
      }
      expect(chunk).toHaveBeenCalledTimes(3)
      await vi.advanceTimersByTimeAsync(60_000)
      expect((await outcome).message).toContain('连续 60 秒未收到新数据')
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })

  it('requests usage and falls back only when a compatible endpoint rejects that option', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('unsupported stream_options', { status: 400 })).mockResolvedValueOnce(streamResponse('data: {"model":"actual-model","choices":[],"usage":{"prompt_tokens":12,"completion_tokens":3,"total_tokens":15}}\n\ndata: [DONE]\n\n'))
    vi.stubGlobal('fetch', fetchMock)
    const metadata = vi.fn()
    await streamNativeChat([{ role: 'user', content: 'test' }], 'system', { ...DEFAULT_APP_CONFIG, provider: 'openai', baseUrl: 'https://provider.example/v1', apiKey: 'test', model: 'requested' }, () => {}, undefined, undefined, { onMetadata: metadata })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).stream_options).toEqual({ include_usage: true })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).stream_options).toBeUndefined()
    expect(metadata).toHaveBeenLastCalledWith({ model: 'actual-model', usage: { inputTokens: 12, outputTokens: 3, totalTokens: 15 } })
  })
  it.each([['openai', 60_000], ['openai', 120_000], ['claude', 60_000], ['claude', 120_000]] as const)('bounds %s requests at %i ms without changing the default', async (provider, timeoutMs) => {
    vi.useFakeTimers()
    try {
      let signal: AbortSignal | undefined
      vi.stubGlobal('fetch', vi.fn((_url, options) => new Promise((_resolve, reject) => {
        signal = options.signal
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      })))
      const request = streamNativeChat([{ role: 'user', content: 'test' }], 'system', { ...DEFAULT_APP_CONFIG, provider, baseUrl: 'https://provider.example/v1', apiKey: 'test', model: 'test' }, () => {}, undefined, undefined, timeoutMs === 60_000 ? undefined : { timeoutMs })
      const outcome = request.catch(error => error)
      await vi.advanceTimersByTimeAsync(timeoutMs - 1)
      expect(signal?.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect((await outcome).message).toContain(`${timeoutMs / 1000} 秒`)
    } finally { vi.useRealTimers() }
  })
  it('uses the saved OpenAI-compatible endpoint and bearer credentials', async () => {
    const fetchMock = vi.fn(async (_input: Parameters<typeof fetch>[0], _options?: Parameters<typeof fetch>[1]) => streamResponse(
      'data: {"choices":[{"delta":{"content":"你好"}}]}\n\ndata: [DONE]\n\n'
    ))
    vi.stubGlobal('fetch', fetchMock)
    const chunks: string[] = []

    await streamNativeChat(
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

    await streamNativeChat(
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

    await streamNativeChat(
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
