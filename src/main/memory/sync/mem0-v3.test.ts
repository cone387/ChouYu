import { describe, expect, it, vi } from 'vitest'
import { Mem0MemorySyncAdapter } from './mem0-adapter'

const config = { baseUrl: 'https://example.com/proxy/v3', apiKey: 'fixture', userId: 'alice' }
describe('explicit Mem0 platform V3 routing', () => {
  it('uses POST filters and bounded pages under a proxy prefix', async () => {
    const request = vi.fn(async (_url: Parameters<typeof fetch>[0], _init?: RequestInit) => Response.json({ results: [], count: 0, next: null }))
    expect((await new Mem0MemorySyncAdapter(config, request).listSnapshot()).complete).toBe(true)
    expect(String(request.mock.calls[0][0])).toBe('https://example.com/proxy/v3/memories/?page_size=200')
    expect(request.mock.calls[0][1]?.method).toBe('POST')
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toEqual({ filters: { user_id: 'alice' } })
  })
  it('does not silently downgrade missing V3 search or accept unverified pages', async () => {
    const request = vi.fn(async () => new Response('', { status: 404 }))
    await expect(new Mem0MemorySyncAdapter(config, request).search('test')).rejects.toThrow('404')
    expect(request).toHaveBeenCalledTimes(1)
    await expect(new Mem0MemorySyncAdapter(config, async () => Response.json([])).list()).rejects.toThrow('分页信息')
  })
  it('keeps self-hosted protocol even when its base path is named v3', async () => {
    const request = vi.fn(async (_url: Parameters<typeof fetch>[0], _init?: RequestInit) => Response.json([]))
    await new Mem0MemorySyncAdapter({ ...config, mode: 'self-hosted' }, request).list()
    expect(request.mock.calls[0][1]?.method).toBe('GET')
    expect((request.mock.calls[0][1]?.headers as Record<string, string>)['X-API-Key']).toBe('fixture')
  })
})
