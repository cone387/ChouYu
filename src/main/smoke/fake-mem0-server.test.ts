import { afterEach, describe, expect, it } from 'vitest'
import { startFakeMem0Server, type FakeMem0Server } from './fake-mem0-server'

let server: FakeMem0Server | null = null

afterEach(async () => {
  await server?.close()
  server = null
})

const start = async () => {
  server = await startFakeMem0Server({
    apiKey: 'test-key',
    seed: [
      { userId: 'alice', memory: '用户偏好简短回答' },
      { userId: 'alice', memory: 'ChouYu 项目使用 SQLite 记忆' },
      { userId: 'bob', memory: 'Bob 的私人记忆' }
    ]
  })
  return server
}

describe('fake Mem0 server', () => {
  it('lists records scoped to the requesting user', async () => {
    const fake = await start()
    const response = await fetch(`${fake.url}/memories?user_id=alice&page_size=1000`, {
      headers: { 'X-API-Key': 'test-key' }
    })
    expect(response.status).toBe(200)
    const rows = (await response.json()) as Array<{ memory: string }>
    expect(rows).toHaveLength(2)
    expect(rows.map((row: { memory: string }) => row.memory)).toEqual(expect.arrayContaining(['用户偏好简短回答']))
  })

  it('rejects a missing or wrong X-API-Key with 401', async () => {
    const fake = await start()
    const missing = await fetch(`${fake.url}/memories?user_id=alice`)
    expect(missing.status).toBe(401)
    const wrong = await fetch(`${fake.url}/memories?user_id=alice`, { headers: { 'X-API-Key': 'not-the-key' } })
    expect(wrong.status).toBe(401)
  })

  it('stores writes with infer and metadata echoed back', async () => {
    const fake = await start()
    const response = await fetch(`${fake.url}/memories`, {
      method: 'POST',
      headers: { 'X-API-Key': 'test-key', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: '新写入的记忆' }],
        user_id: 'alice',
        infer: false,
        metadata: { chouyu_id: 'local-1' }
      })
    })
    expect(response.status).toBe(200)
    const rows = (await response.json()) as Array<{ memory: string }>
    expect(rows[0].memory).toBe('新写入的记忆')
    expect(fake.records().some((record) => record.userId === 'alice' && record.memory === '新写入的记忆' && record.metadata.chouyu_id === 'local-1')).toBe(true)
    expect(fake.requests().some((entry) => entry.method === 'POST' && entry.path === 'memories' && entry.apiKey === 'test-key' && entry.body?.infer === false)).toBe(true)
  })

  it('filters search results by normalized substring across path variants', async () => {
    const fake = await start()
    for (const path of ['memories/search', 'memories/search/', 'search', 'search/']) {
      const response = await fetch(`${fake.url}/${path}`, {
        method: 'POST',
        headers: { 'X-API-Key': 'test-key', 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '简短回答', user_id: 'alice', limit: 6 })
      })
      expect(response.status).toBe(200)
      const rows = (await response.json()) as Array<{ memory: string }>
      expect(rows).toHaveLength(1)
      expect(rows[0].memory).toBe('用户偏好简短回答')
    }
  })

  it('returns 404 for every search path in search-missing mode while list still works', async () => {
    const fake = await start()
    fake.setMode('search-missing')
    for (const path of ['memories/search', 'search']) {
      const response = await fetch(`${fake.url}/${path}`, {
        method: 'POST',
        headers: { 'X-API-Key': 'test-key', 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '简短回答', user_id: 'alice' })
      })
      expect(response.status).toBe(404)
    }
    const listResponse = await fetch(`${fake.url}/memories?user_id=alice`, { headers: { 'X-API-Key': 'test-key' } })
    expect(listResponse.status).toBe(200)
  })

  it('rejects every endpoint with 401 in auth mode', async () => {
    const fake = await start()
    fake.setMode('auth')
    const list = await fetch(`${fake.url}/memories?user_id=alice`, { headers: { 'X-API-Key': 'test-key' } })
    expect(list.status).toBe(401)
    const search = await fetch(`${fake.url}/memories/search`, {
      method: 'POST',
      headers: { 'X-API-Key': 'test-key', 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '简短回答', user_id: 'alice' })
    })
    expect(search.status).toBe(401)
  })

  it('destroys sockets in refuse mode', async () => {
    const fake = await start()
    fake.setMode('refuse')
    await expect(fetch(`${fake.url}/memories?user_id=alice`, { headers: { 'X-API-Key': 'test-key' } })).rejects.toThrow()
  })
})
