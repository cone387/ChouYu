import { describe, expect, it, vi } from 'vitest'
import { JournalSemanticSearch } from './semantic-search'
import { DEFAULT_APP_CONFIG } from '../../shared/config'
import { semanticSourceHash, type SemanticCache, type SemanticCacheEntry } from './semantic-cache'

const config = { ...DEFAULT_APP_CONFIG, embeddingEnabled: true, embeddingBaseUrl: 'https://example.com/v1', embeddingApiKey: 'secret', embeddingModel: 'fixture' }
const query = { from: 0, to: 10, query: 'connection timeout' }
const source = { id: 'capture:1', at: 1, app: 'editor', title: '页面', text: '请求等待超过时限' }
const request = () => vi.fn(async (_url: unknown, init?: RequestInit) => Response.json({ data: JSON.parse(String(init?.body)).input.map((_text: string, index: number) => ({ index, embedding: [1, 0] })) }))
const cacheFixture = () => {
  let generation = 0
  const rows = new Map<string, SemanticCacheEntry>()
  const cache: SemanticCache = {
    read: async (scope, sources) => ({ generation, entries: sources.flatMap(source => { const entry = rows.get(`${scope}:${source.sourceId}`); return entry?.sourceHash === source.sourceHash ? [entry] : [] }) }),
    write: vi.fn(async (scope: string, expected: number, entries: SemanticCacheEntry[]) => { if (generation !== expected) throw new Error('cleared'); entries.forEach(entry => rows.set(`${scope}:${entry.sourceId}`, entry)) }),
    clear: async () => { generation++; rows.clear() }
  }
  return { cache, rows }
}

describe('explicit journal semantic execution', () => {
  it('reuses source vectors across search instances and only sends the new query', async () => {
    const { cache, rows } = cacheFixture(), fetch = request()
    const first = new JournalSemanticSearch(async () => [source], async () => config, fetch, cache)
    await first.search((await first.prepare(query)).id)
    const second = new JournalSemanticSearch(async () => [source], async () => config, fetch, cache)
    const plan = await second.prepare({ ...query, query: 'another question' })
    expect(plan.cachedTexts).toBe(1); expect(plan.texts).toBe(1)
    expect(fetch).toHaveBeenCalledTimes(1)
    await second.search(plan.id)
    expect(JSON.parse(String(fetch.mock.calls[1][1]?.body)).input).toEqual(['another question'])
    expect(JSON.stringify([...rows.values()])).not.toContain(source.text)
    expect(JSON.stringify([...rows.values()])).not.toContain(query.query)
  })
  it('requires new source vectors after text or connection credentials change', async () => {
    const { cache } = cacheFixture(), fetch = request()
    const first = new JournalSemanticSearch(async () => [source], async () => config, fetch, cache)
    await first.search((await first.prepare(query)).id)
    for (const [nextSource, nextConfig] of [[{ ...source, text: 'new OCR' }, config], [source, { ...config, embeddingApiKey: 'new-key' }]] as const) {
      const next = new JournalSemanticSearch(async () => [nextSource], async () => nextConfig, fetch, cache)
      expect((await next.prepare(query)).cachedTexts).toBe(0)
    }
    const shifted = { ...source, at: 99 }
    expect(semanticSourceHash(shifted)).toBe(semanticSourceHash(source))
  })
  it('clearing discards an in-flight request and never restores its vectors', async () => {
    const { cache, rows } = cacheFixture()
    let release!: (value: Response) => void
    const fetch = vi.fn(() => new Promise<Response>(resolve => { release = resolve }))
    const search = new JournalSemanticSearch(async () => [source], async () => config, fetch, cache)
    const pending = search.search((await search.prepare(query)).id)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    await search.clearCache()
    release(Response.json({ data: [{ index: 0, embedding: [1, 0] }, { index: 1, embedding: [1, 0] }] }))
    await expect(pending).rejects.toThrow('取消')
    expect(rows.size).toBe(0); expect(cache.write).not.toHaveBeenCalled()
  })
  it('returns valid results with a warning when index persistence fails', async () => {
    const { cache } = cacheFixture(), fetch = request()
    cache.write = async () => { throw new Error('disk failure') }
    const search = new JournalSemanticSearch(async () => [source], async () => config, fetch, cache)
    const result = await search.search((await search.prepare(query)).id)
    expect(result.items).toHaveLength(1)
    expect(result.cacheWarning).toContain('disk failure')
  })
  it('prepares without network requests and allows one confirmed run', async () => {
    const fetch = request(), search = new JournalSemanticSearch(async () => [source], async () => config, fetch)
    const plan = await search.prepare(query)
    expect(fetch).not.toHaveBeenCalled()
    expect(JSON.stringify(plan)).not.toContain('secret')
    expect(plan.sources).toBe(1)
    const result = await search.search(plan.id)
    expect(result.items[0].source).toEqual(source)
    expect(fetch).toHaveBeenCalledTimes(1)
    await expect(search.search(plan.id)).rejects.toThrow('失效')
  })
  it('refuses changed sources or configuration before sending any text', async () => {
    for (const changed of ['source', 'config']) {
      let sources = [source], current = config
      const fetch = request(), search = new JournalSemanticSearch(async () => sources, async () => current, fetch)
      const plan = await search.prepare(query)
      if (changed === 'source') sources = [{ ...source, text: 'changed' }]
      else current = { ...config, embeddingModel: 'another' }
      await expect(search.search(plan.id)).rejects.toThrow('重新准备')
      expect(fetch).not.toHaveBeenCalled()
    }
  })
  it('discards late vectors when cancelled and cannot reuse the confirmation', async () => {
    let release!: (value: Response) => void
    const fetch = vi.fn(() => new Promise<Response>(resolve => { release = resolve }))
    const search = new JournalSemanticSearch(async () => [source], async () => config, fetch)
    const plan = await search.prepare(query)
    const pending = search.search(plan.id)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    search.cancel()
    release(Response.json({ data: [{ index: 0, embedding: [1] }, { index: 1, embedding: [1] }] }))
    await expect(pending).rejects.toThrow()
    await expect(search.search(plan.id)).rejects.toThrow('失效')
  })
  it('does not drop old records when new activity arrives but rejects deletion after a request', async () => {
    let sources = [source]
    const fetch = request(), search = new JournalSemanticSearch(async () => sources, async () => config, fetch)
    const plan = await search.prepare(query)
    sources = [source, { ...source, id: 'capture:2' }]
    expect((await search.search(plan.id)).sources).toBe(1)
    const second = await search.prepare(query)
    fetch.mockImplementationOnce(async (_url, init) => { sources = []; return Response.json({ data: JSON.parse(String(init?.body)).input.map((_text: string, index: number) => ({ index, embedding: [1, 0] })) }) })
    await expect(search.search(second.id)).rejects.toThrow('来源已删除')
  })
})
