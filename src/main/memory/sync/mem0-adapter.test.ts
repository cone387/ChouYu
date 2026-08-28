import { describe, expect, it, vi } from 'vitest'
import type { MemoryRecord } from '../../../shared/memory'
import { Mem0MemorySyncAdapter, parseMem0Memories } from './mem0-adapter'

const config = { baseUrl: 'https://api.mem0.test/v1', apiKey: 'secret', userId: 'user-1' }

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
    expect(JSON.parse(String(request.mock.calls[1][1]?.body))).toMatchObject({ user_id: 'user-1', metadata: { chouyu_id: 'local-2' } })
  })
})
