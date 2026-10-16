import { afterEach, expect, it, vi } from 'vitest'
import { DEFAULT_APP_CONFIG } from '../../../shared/config'
import { streamNativeChat } from './runner'
import type { AIToolDefinition } from '../../../shared/tools'

afterEach(() => vi.unstubAllGlobals())
const definition: AIToolDefinition = { name: 'write', displayName: 'write', description: 'write', source: 'builtin', risk: 'write', requiresConfirmation: false, inputSchema: { type: 'object', properties: {} } }
it.each([['openai', 'error'], ['claude', 'error'], ['openai', 'eof'], ['claude', 'eof']] as const)('rejects %s stream %s without completing or executing partial tool calls', async (provider, failure) => {
    const execute = vi.fn(async () => 'written'), onChunk = vi.fn();
    const partial = provider === 'claude'
      ? [{ type: 'content_block_delta', delta: { type: 'text_delta', text: 'partial' } }, { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'call', name: 'write', input: {} } }]
      : [{ choices: [{ delta: { content: 'partial', tool_calls: [{ index: 0, id: 'call', function: { name: 'write', arguments: '{}' } }] } }] }];
    const error = { type: 'error', error: { type: 'overloaded_error', message: 'provider overloaded' } };
    const frames: unknown[] = failure === 'error' ? [...partial, error] : partial;
    const fetchMock = vi.fn(async () => new Response(frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join('')));
    vi.stubGlobal('fetch', fetchMock);
    await expect(streamNativeChat([{ role: 'user', content: 'work' }], '', { ...DEFAULT_APP_CONFIG, provider, baseUrl: 'https://fixture.example', apiKey: 'fixture', model: 'fixture' }, onChunk, undefined,
      { definitions: [definition], execute })).rejects.toThrow(failure === 'error' ? 'provider overloaded' : '中断');
    expect(execute).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(onChunk).not.toHaveBeenCalledWith('', true);
});
it.each(['openai', 'claude'] as const)('accepts the final %s protocol marker without a trailing newline', async provider => {
  vi.stubGlobal('fetch', async () => new Response(provider === 'claude' ? 'data: {"type":"message_stop"}' : 'data: [DONE]'));
  const onChunk = vi.fn();
  await streamNativeChat([{ role: 'user', content: 'work' }], '', { ...DEFAULT_APP_CONFIG, provider, baseUrl: 'https://fixture.example', apiKey: 'fixture', model: 'fixture' }, onChunk);
  expect(onChunk).toHaveBeenLastCalledWith('', true);
});
function response(provider: string, count = 2) {
  const events = Array.from({ length: count }, (_, index) => provider === 'claude'
    ? { type: 'content_block_start', index, content_block: { type: 'tool_use', id: `call${index}`, name: 'write', input: {} } }
    : { choices: [{ delta: { tool_calls: [{ index, id: `call${index}`, function: { name: 'write', arguments: '{}' } }] } }] })
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + (provider === 'claude' ? 'data: {"type":"message_stop"}\n\n' : 'data: [DONE]\n\n'))
}

it.each(['openai', 'claude'] as const)('stops %s before tools if cancellation arrives as the model round completes', async provider => {
  const abort = new AbortController(), execute = vi.fn(async () => 'saved'), fetchMock = vi.fn(async () => response(provider))
  vi.stubGlobal('fetch', fetchMock)
  await expect(streamNativeChat([{ role: 'user', content: 'work' }], '', { ...DEFAULT_APP_CONFIG, provider, baseUrl: 'https://fixture.example', apiKey: 'fixture', model: 'fixture' }, () => {}, abort.signal,
    { definitions: [definition], execute }, { afterRound: () => abort.abort() })).rejects.toThrow()
  expect(execute).not.toHaveBeenCalled()
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

it.each(['openai', 'claude'] as const)('stops %s between tool calls without starting a second write', async provider => {
  const abort = new AbortController(), execute = vi.fn(async () => { abort.abort(); return 'saved first' }), fetchMock = vi.fn(async () => response(provider))
  vi.stubGlobal('fetch', fetchMock)
  await expect(streamNativeChat([{ role: 'user', content: 'work' }], '', { ...DEFAULT_APP_CONFIG, provider, baseUrl: 'https://fixture.example', apiKey: 'fixture', model: 'fixture' }, () => {}, abort.signal,
    { definitions: [definition], execute })).rejects.toThrow()
  expect(execute).toHaveBeenCalledTimes(1)
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

it.each(['openai', 'claude'] as const)('does not request or release a second %s round when its budget is denied', async provider => {
  const execute = vi.fn(async () => 'saved'), fetchMock = vi.fn(async () => response(provider, 1))
  const beforeRound = vi.fn((round: number, input: string) => { if (round === 1) { expect(input).toContain('saved'); throw new Error('budget exhausted') }; return 900 })
  const afterRound = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  await expect(streamNativeChat([{ role: 'user', content: 'work' }], '', { ...DEFAULT_APP_CONFIG, provider, baseUrl: 'https://fixture.example', apiKey: 'fixture', model: 'fixture' }, () => {}, undefined,
    { definitions: [definition], execute }, { beforeRound, afterRound })).rejects.toThrow('budget exhausted')
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(execute).toHaveBeenCalledTimes(1)
  expect(beforeRound).toHaveBeenCalledTimes(2)
  expect(afterRound).toHaveBeenCalledTimes(1)
})

it.each(['openai', 'claude'] as const)('limits %s execution to six model rounds', async provider => {
  const fetchMock = vi.fn(async () => response(provider, 1)), execute = vi.fn(async () => 'read result')
  vi.stubGlobal('fetch', fetchMock)
  await expect(streamNativeChat([{ role: 'user', content: 'work' }], '', { ...DEFAULT_APP_CONFIG, provider, baseUrl: 'https://fixture.example', apiKey: 'fixture', model: 'fixture' }, () => {}, undefined,
    { definitions: [definition], execute })).rejects.toThrow('安全上限')
  expect(fetchMock).toHaveBeenCalledTimes(6)
})

it.each(['openai', 'claude'] as const)('encodes the image in the %s model request', async provider => {
  let body: any
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => { body = JSON.parse(String(init.body)); return response(provider, 0) })
  await streamNativeChat([{ role: 'user', content: 'image', imageUrl: 'data:image/png;base64,AAAA' }], 'system', { ...DEFAULT_APP_CONFIG, provider, baseUrl: 'https://fixture.example', apiKey: 'fixture', model: 'fixture' }, () => {})
  expect(body.messages.at(-1).content).toContainEqual(provider === 'claude'
    ? { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }
    : { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA', detail: 'high' } })
})
