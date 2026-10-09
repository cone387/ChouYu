import { describe, expect, it, vi } from 'vitest'
import { probeConversation } from './provider-probe'
import { DEFAULT_APP_CONFIG } from '../shared/config'
const config = { ...DEFAULT_APP_CONFIG, baseUrl: 'https://example.test/v1', apiKey: 'secret-test-key', model: 'alias' }
const request = (body: string, status = 200) => vi.fn(async () => new Response(body, { status })) as unknown as typeof fetch
describe('real conversation diagnostics', () => {
  it('reports actual alias and response text', async () => {
    expect(await probeConversation(config, request('data: {"model":"actual","choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n'))).toMatchObject({ state: 'ready', requestedModel: 'alias', returnedModel: 'actual', reply: 'OK', completed: true })
  })
  it('preserves upstream failures and redacts credentials', async () => {
    const result = await probeConversation(config, request('{"code":"1113","message":"余额不足 secret-test-key"}', 429))
    expect(result).toMatchObject({ state: 'error', httpStatus: 429 })
    expect(result.message).toContain('1113'); expect(result.message).not.toContain(config.apiKey)
  })
  it.each([
    ['data: [DONE]\n', '正文'],
    ['data: {"choices":[{"delta":{"content":"partial"}}]}\n', '未正常结束'],
    ['data: {"choices":[{"delta":{"content":"partial"},"finish_reason":"length"}]}\n', 'length'],
    ['data: {"error":{"message":"stream failed"}}\n', 'stream failed'],
    ['<html>not a model</html>', '正文']
  ])('rejects unusable successful HTTP responses', async (body, message) => {
    const result = await probeConversation(config, request(body)); expect(result.state).toBe('error'); expect(result.message).toContain(message)
  })
  it('supports Anthropic streams', async () => {
    const result = await probeConversation({ ...config, provider: 'claude' }, request('data: {"type":"message_start","message":{"model":"claude-real"}}\n\ndata: {"type":"content_block_delta","delta":{"text":"OK"}}\n\ndata: {"type":"message_stop"}\n'))
    expect(result).toMatchObject({ state: 'ready', returnedModel: 'claude-real', reply: 'OK' })
  })
  it('times out stalled requests', async () => {
    vi.useFakeTimers()
    try {
      const pending = probeConversation(config, ((_url, options) => new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))) as typeof fetch)
      await vi.advanceTimersByTimeAsync(30000)
      expect(await pending).toMatchObject({ state: 'error', message: '对话诊断超过 30 秒，已停止。' })
    } finally { vi.useRealTimers() }
  })
})
