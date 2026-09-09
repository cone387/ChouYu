import { describe, expect, it, vi } from 'vitest'
import { OpenAIEmbeddingClient, cosineSimilarity } from './embedding-client'

describe('OpenAI-compatible embedding client', () => {
  it('parses indexed embeddings in response order', async () => {
    const request = vi.fn(async () => Response.json({ data: [
      { index: 1, embedding: [0, 1] },
      { index: 0, embedding: [1, 0] }
    ] })) as typeof fetch
    const client = new OpenAIEmbeddingClient({ baseUrl: 'https://example.com/v1', apiKey: 'key', model: 'embed' }, request)
    expect(await client.embed(['a', 'b'])).toEqual([[1, 0], [0, 1]])
  })

  it('falls back to /v1/embeddings when the root endpoint is missing', async () => {
    const request = vi.fn(async (input: Parameters<typeof fetch>[0]) => String(input).endsWith('/v1/embeddings')
      ? Response.json({ data: [{ index: 0, embedding: [1, 2, 3] }] })
      : new Response('missing', { status: 404 })) as typeof fetch
    const client = new OpenAIEmbeddingClient({ baseUrl: 'https://example.com', apiKey: 'key', model: 'embed' }, request)
    expect((await client.embed(['test']))[0]).toHaveLength(3)
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('calculates cosine similarity safely', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1)
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
    expect(cosineSimilarity([], [])).toBe(0)
    expect(cosineSimilarity([1e308, 1e308], [1e308, 1e308])).toBeCloseTo(1)
    expect(cosineSimilarity([1e-308], [-1e-308])).toBeCloseTo(-1)
    expect(cosineSimilarity([NaN], [1])).toBe(0)
  })

  it('rejects ambiguous indices and nonnumeric or zero vectors instead of misassigning sources', async () => {
    for (const data of [
      [{ index: 0, embedding: [1] }, { index: 0, embedding: [2] }],
      [{ embedding: [1] }, { index: 1, embedding: [2] }],
      [{ index: 0, embedding: [1] }, { index: 2, embedding: [2] }],
      [{ index: 0, embedding: ['1'] }, { index: 1, embedding: [2] }],
      [{ index: 0, embedding: [0] }, { index: 1, embedding: [2] }]
    ]) {
      const request = vi.fn(async () => Response.json({ data }))
      const client = new OpenAIEmbeddingClient({ baseUrl: 'https://example.com', apiKey: 'key', model: 'embed' }, request)
      await expect(client.embed(['a', 'b'])).rejects.toThrow()
      expect(request).toHaveBeenCalledTimes(1)
    }
  })

  it('does not resend unauthorized, rate-limited or server-failed requests to another endpoint', async () => {
    for (const status of [401, 429, 500]) {
      const request = vi.fn(async () => new Response('failure', { status }))
      const client = new OpenAIEmbeddingClient({ baseUrl: 'https://example.com', apiKey: 'key', model: 'embed' }, request)
      await expect(client.embed(['a'])).rejects.toThrow(String(status))
      expect(request).toHaveBeenCalledTimes(1)
    }
  })

  it('honors cancellation before sending and discards a late response after cancellation', async () => {
    const controller = new AbortController()
    const request = vi.fn(async () => { controller.abort(); return Response.json({ data: [{ index: 0, embedding: [1] }] }) })
    const client = new OpenAIEmbeddingClient({ baseUrl: 'https://example.com', apiKey: 'key', model: 'embed' }, request)
    await expect(client.embed(['a'], controller.signal)).rejects.toThrow()
    expect(request).toHaveBeenCalledTimes(1)
    request.mockClear()
    await expect(client.embed(['a'], controller.signal)).rejects.toThrow()
    expect(request).not.toHaveBeenCalled()
  })

  it('does not silently retry a network failure', async () => {
    const request = vi.fn(async () => { throw new Error('connection reset') })
    const client = new OpenAIEmbeddingClient({ baseUrl: 'https://example.com', apiKey: 'key', model: 'embed' }, request)
    await expect(client.embed(['a'])).rejects.toThrow('connection reset')
    expect(request).toHaveBeenCalledTimes(1)
  })
})
