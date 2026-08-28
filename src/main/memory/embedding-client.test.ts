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
  })
})
