import { describe, expect, it, vi } from 'vitest'
import type { MemoryRecord } from '../../../shared/memory'
import { Mem0MemorySyncAdapter, parseMem0Memories } from './mem0-adapter'

const config = { baseUrl: 'https://api.mem0.test/v1', apiKey: 'secret', userId: 'user-1', mode: 'platform' as const }

describe('Mem0 memory sync adapter', () => {
  it('parses common Mem0 list response shapes', () => {
    expect(parseMem0Memories({ results: [{ id: 'r1', memory: '偏好简短回答', metadata: { chouyu_type: 'preference' } }] })).toEqual([
      expect.objectContaining({ id: 'r1', content: '偏好简短回答', metadata: { chouyu_type: 'preference' } })
    ])
    expect(parseMem0Memories({ data: { memories: [{ id: 'r2', content: '项目使用 SQLite' }] } })).toHaveLength(1)
  })

  it('lists memories with user scoping and token authentication', async () => {
    const request = vi.fn(async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) => Response.json({ results: [{ id: 'r1', memory: '远程记忆' }] }))
    const adapter = new Mem0MemorySyncAdapter(config, request as typeof fetch)
    expect(await adapter.test()).toEqual({ remoteCount: 1 })
    expect(String(request.mock.calls[0][0])).toContain('user_id=user-1')
    expect((request.mock.calls[0][1]?.headers as Record<string, string>).Authorization).toBe('Token secret')
  })

  it('searches the selected user scope without falling back to local records', async () => {
    const request = vi.fn(async (_input: Parameters<typeof fetch>[0], init?: RequestInit) =>
      init?.method === 'POST'
        ? Response.json({ results: [{ id: 'r-search', memory: '喜欢简洁回答' }] })
        : Response.json({ results: [] }))
    const adapter = new Mem0MemorySyncAdapter(config, request as typeof fetch)
    const result = await adapter.search('回答风格', 4)
    expect(result).toHaveLength(1)
    expect(String(request.mock.calls[0][0])).toContain('/memories/search')
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toMatchObject({ query: '回答风格', user_id: 'user-1', limit: 4 })
  })

  it('normalizes authentication and malformed-response failures', async () => {
    const authRequest = vi.fn(async () => new Response('denied', { status: 401 })) as typeof fetch
    await expect(new Mem0MemorySyncAdapter(config, authRequest).search('test')).rejects.toThrow('Mem0 认证失败')

    const malformedRequest = vi.fn(async () => new Response('not-json', { status: 200, headers: { 'Content-Type': 'text/plain' } })) as typeof fetch
    await expect(new Mem0MemorySyncAdapter(config, malformedRequest).search('test')).rejects.toThrow('无法解析的响应')
  })

  it('reports self-hosted search compatibility and connection failures clearly', async () => {
    const unsupportedRequest = vi.fn(async () => new Response('missing', { status: 404 })) as typeof fetch
    await expect(new Mem0MemorySyncAdapter({ ...config, mode: 'self-hosted' }, unsupportedRequest).search('test'))
      .rejects.toThrow('不支持记忆搜索接口')

    const offlineRequest = vi.fn(async () => { throw new TypeError('fetch failed') }) as typeof fetch
    await expect(new Mem0MemorySyncAdapter({ ...config, mode: 'self-hosted' }, offlineRequest).search('test'))
      .rejects.toThrow('请检查 Base URL 和服务是否已启动')

    const timeoutRequest = vi.fn(async () => { throw new DOMException('timed out', 'TimeoutError') }) as typeof fetch
    await expect(new Mem0MemorySyncAdapter({ ...config, mode: 'self-hosted' }, timeoutRequest).search('test'))
      .rejects.toThrow('搜索记忆超时')
  })

  it('skips existing remote records and pushes new local memories', async () => {
    const request = vi.fn(async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => init?.method === 'GET'
      ? Response.json({ results: [{ id: 'r1', memory: '已同步', metadata: { chouyu_id: 'local-1' } }] })
      : Response.json({ results: [{ id: 'created' }] }, { status: 201 }))
    const base = {
      type: 'fact' as const, normalizedKey: '', keywords: [], importance: 0.7, confidence: 1,
      sensitivity: 'normal' as const, status: 'active' as const, createdAt: 1, updatedAt: 1,
      accessCount: 0, helpfulCount: 0, unhelpfulCount: 0
    }
    const memories: MemoryRecord[] = [
      { ...base, id: 'local-1', content: '已同步', normalizedKey: '已同步' },
      { ...base, id: 'local-2', content: '需要同步', normalizedKey: '需要同步' }
    ]
    const result = await new Mem0MemorySyncAdapter(config, request as typeof fetch).push(memories)
    expect(result).toEqual({ attempted: 2, succeeded: 1, skipped: 1, failed: 0 })
    expect(request).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String(request.mock.calls[1][1]?.body))).toMatchObject({ user_id: 'user-1', metadata: { chouyu_id: 'local-2', chouyu_sensitivity: 'normal', chouyu_source_session_id: null, chouyu_source_message_id: null } })
    expect(JSON.parse(String(request.mock.calls[1][1]?.body))).toMatchObject({ infer: false })
  })

  it('supports self-hosted root paths and X-API-Key authentication', async () => {
    const request = vi.fn(async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) => Response.json({ results: [] }))
    await new Mem0MemorySyncAdapter({ baseUrl: 'http://localhost:8888', apiKey: 'local-key', userId: 'local-user', mode: 'self-hosted' }, request as typeof fetch).list()
    expect(String(request.mock.calls[0][0])).toContain('http://localhost:8888/memories?')
    expect((request.mock.calls[0][1]?.headers as Record<string, string>)['X-API-Key']).toBe('local-key')
    expect((request.mock.calls[0][1]?.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('delegates raw message extraction to Mem0 when requested', async () => {
    const request = vi.fn(async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => Response.json({ results: [{ id: 'r1', memory: '提取出的记忆' }] }))
    const adapter = new Mem0MemorySyncAdapter(config, request as typeof fetch)
    await adapter.rememberRaw('我喜欢简洁的回答')
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toMatchObject({ infer: true, messages: [{ content: '我喜欢简洁的回答' }] })
  })
})
