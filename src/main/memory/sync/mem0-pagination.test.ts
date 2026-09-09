import { describe, expect, it, vi } from 'vitest'
import { Mem0MemorySyncAdapter } from './mem0-adapter'

const config = { baseUrl: 'https://example.com/v1', apiKey: 'secret', userId: 'alice' }
const row = (id: string) => ({ id, memory: `memory ${id}` })

describe('complete Mem0 pagination', () => {
  it('reads all pages and preserves user scope on relative links', async () => {
    const request = vi.fn(async (input: Parameters<typeof fetch>[0]) => new URL(String(input)).searchParams.get('page') === '2'
      ? Response.json({ count: 2, results: [row('b')], next: null })
      : Response.json({ count: 2, results: [row('a')], next: '?page=2' }))
    expect((await new Mem0MemorySyncAdapter(config, request).list()).map(item => item.id)).toEqual(['a', 'b'])
    expect(new URL(String(request.mock.calls[1][0])).searchParams.get('user_id')).toBe('alice')
  })
  it('rejects partial results when a later page fails', async () => {
    const request = vi.fn().mockResolvedValueOnce(Response.json({ results: [row('a')], next: '?page=2' })).mockResolvedValueOnce(new Response('', { status: 503 }))
    await expect(new Mem0MemorySyncAdapter(config, request).list()).rejects.toThrow('503')
  })
  it.each(['https://other.example/v1/memories?page=2', '/v1/other?page=2', '?page=2&user_id=bob', '?page=2&user_id=alice&user_id=bob'])('refuses out-of-scope next page %s', async next => {
    const request = vi.fn(async () => Response.json({ results: [row('a')], next }))
    await expect(new Mem0MemorySyncAdapter(config, request).list()).rejects.toThrow('范围')
    expect(request).toHaveBeenCalledTimes(1)
  })
  it.each([
    {}, { results: [{}] }, { results: [row('a')], count: 2, next: null }, { results: [], next: '?page=2' }, { results: [], count: '0' }
  ])('refuses malformed or incomplete envelopes', async value => {
    await expect(new Mem0MemorySyncAdapter(config, async () => Response.json(value)).list()).rejects.toThrow()
  })
  it('rejects duplicates and changing totals instead of reporting complete', async () => {
    for (const second of [{ count: 2, results: [row('a')], next: null }, { count: 3, results: [row('b')], next: null }]) {
      const request = vi.fn().mockResolvedValueOnce(Response.json({ count: 2, results: [row('a')], next: '?page=2' })).mockResolvedValueOnce(Response.json(second))
      await expect(new Mem0MemorySyncAdapter(config, request).list()).rejects.toThrow()
    }
  })
  it('rejects pre-cancelled and late responses even when transport ignores cancellation', async () => {
    const controller = new AbortController(), request = vi.fn(async () => Response.json([]))
    controller.abort()
    await expect(new Mem0MemorySyncAdapter(config, request).list(controller.signal)).rejects.toThrow()
    expect(request).not.toHaveBeenCalled()
    const late = new AbortController()
    await expect(new Mem0MemorySyncAdapter(config, async () => { late.abort(); return Response.json([]) }).list(late.signal)).rejects.toThrow()
  })
  it('supports a nested paginated envelope and unpaginated OSS arrays', async () => {
    expect(await new Mem0MemorySyncAdapter(config, async () => Response.json({ data: { memories: [row('a')], count: 1, next: null } })).list()).toHaveLength(1)
    expect(await new Mem0MemorySyncAdapter(config, async () => Response.json([])).list()).toEqual([])
    await expect(new Mem0MemorySyncAdapter(config, async () => Response.json({ count: 2, next: null, data: { results: [row('a')] } })).list()).rejects.toThrow('完整列表')
  })
})
