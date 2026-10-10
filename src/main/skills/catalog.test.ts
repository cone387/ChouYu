import { expect, it, vi } from 'vitest'
import { SkillCatalog, catalogUrl, parseCatalog } from './catalog'

it('opens the official score-ranked catalog without a keyword and validates filters', () => {
  expect(catalogUrl({})).toBe('https://api.skillhub.cn/api/skills?page=1&pageSize=24&sortBy=score&order=desc')
  const url = new URL(catalogUrl({ page: 2, sortBy: 'downloads', category: 'dev-programming', source: 'community', keyword: '写作 & 评审' }))
  expect(url.searchParams.get('keyword')).toBe('写作 & 评审')
  expect(url.searchParams.get('page')).toBe('2')
  expect(() => catalogUrl({ page: -1 })).toThrow()
  expect(() => catalogUrl({ sortBy: 'other' as never })).toThrow()
})

it('preserves official order, canonical identity and real metadata without fabricating missing counts', () => {
  const result = parseCatalog({ code: 0, data: { total: 32, skills: [
    { slug: 'writing', namespace: { canonicalName: '@alice/writing' }, name: '写作', description_zh: '中文介绍', description: 'English', downloads: 456, stars: 12, category: 'content', source: 'community', labels: { requires_api_key: 'false' } },
    { slug: 'review', namespace: { canonicalName: '@bob/review' }, name: '评审' }
  ] } })
  expect(result.total).toBe(32)
  expect(result.skills.map(s => s.id)).toEqual(['@alice/writing', '@bob/review'])
  expect(result.skills[0]).toMatchObject({ description: '中文介绍', downloads: 456, stars: 12, requiresApiKey: false })
  expect(result.skills[1].downloads).toBeUndefined()
  expect(() => parseCatalog({ code: 5, message: 'offline' })).toThrow()
  expect(() => parseCatalog({ code: 0, data: {} })).toThrow()
  expect(() => parseCatalog({ code: 0, data: { total: 1, skills: [{ slug: 'writing', source: 'clawhub' }] } })).toThrow(/标识/)
})

it('preserves official HTTPS icons and rejects invalid image addresses', () => {
  const iconUrl = 'https://cloudcache.tencent-cloud.com/qcloud/ui/static/other_external_resource/icon.png'
  const page = (icon: unknown) => parseCatalog({ code: 0, data: { total: 1, skills: [{ namespace: { canonicalName: '@alice/writing' }, iconUrl: icon }] } }).skills[0]
  expect(page(iconUrl).iconUrl).toBe(iconUrl)
  for (const invalid of [null, '', 'javascript:alert(1)', 'file:///C:/secret.png', 'https://name:secret@example.com/icon.png']) expect(page(invalid).iconUrl).toBeUndefined()
})

it('fetches pages independently of CLI installation and reports HTTP failures', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ code: 0, data: { total: 0, skills: [] } })))
  const catalog = new SkillCatalog(fetcher)
  expect(await catalog.browse({})).toEqual({ skills: [], total: 0 })
  expect(fetcher.mock.calls[0][0]).toContain('sortBy=score')
  fetcher.mockResolvedValue(new Response('offline', { status: 503 }))
  await expect(catalog.browse({ page: 2 })).rejects.toThrow(/503/)
})

it('bounds remote responses and maps only active categories', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ items: [
    { key: 'writing', name: '写作', active: true, sortOrder: 2 },
    { key: 'old', name: '旧分类', active: false, sortOrder: 1 }
  ] })))
  expect(await new SkillCatalog(fetcher).categories()).toEqual([{ key: 'writing', name: '写作' }])
  fetcher.mockResolvedValue(new Response('x'.repeat(4 * 1024 * 1024 + 1)))
  await expect(new SkillCatalog(fetcher).browse({})).rejects.toThrow(/过大/)
})
