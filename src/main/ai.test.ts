import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_APP_CONFIG } from '../shared/config'
import { diagnoseProvider, fetchProviderModels } from './ai'
afterEach(() => vi.unstubAllGlobals())

describe('provider model diagnostics', () => {
  it('does not call a listed model usable when its actual conversation fails', async () => {
    const request = vi.fn(async (input: Parameters<typeof fetch>[0]) => String(input).endsWith('/models')
      ? Response.json({ data: [{ id: 'chat-model' }] })
      : new Response('{"error":{"code":"1113","message":"余额不足"}}', { status: 429 })) as typeof fetch
    const result = await diagnoseProvider({ ...DEFAULT_APP_CONFIG, baseUrl: 'https://example.test/v1', apiKey: 'key', model: 'chat-model' }, request)
    expect(result.modelList.configuredModelValid).toBe(true)
    expect(result.state).toBe('error')
    expect(result.conversation.httpStatus).toBe(429)
    expect(result.message).toContain('1113')
  })
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
      : String(input).endsWith('/chat/completions') ? new Response('data: {"model":"actual-model","choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
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
    expect(request).toHaveBeenCalledTimes(3)
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
