import { skillReference, type SkillCatalogItem, type SkillCatalogPage, type SkillCatalogQuery, type SkillCategory } from '../../shared/skills'

const ORIGIN = 'https://api.skillhub.cn'
const record = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value : {}
const string = (value: unknown, limit: number) => typeof value === 'string' ? value.slice(0, limit) : ''
const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
function iconUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return
  try {
    const url = new URL(value)
    if (url.protocol === 'https:' && !url.username && !url.password) return url.href
  } catch { /* Missing or invalid icons use the renderer's fallback. */ }
}

/** Same public catalog endpoint and sort semantics as skillhub.cn/skills. */
export function catalogUrl(input: SkillCatalogQuery): string {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('技能筛选参数无效。')
  const { page = 1, sortBy = 'score', source = 'all', category = '', keyword = '' } = input
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000 || !['score', 'downloads', 'updated_at'].includes(sortBy) || !['all', 'community', 'clawhub'].includes(source)
    || typeof category !== 'string' || (category !== '' && !/^[a-z0-9_-]{1,80}$/.test(category)) || typeof keyword !== 'string' || keyword.length > 200) throw new Error('技能筛选参数无效。')
  const params = new URLSearchParams({ page: String(page), pageSize: '24', sortBy, order: 'desc' })
  if (keyword.trim()) params.set('keyword', keyword.trim())
  if (category) params.set('category', category)
  if (source !== 'all') params.set('source', source)
  return `${ORIGIN}/api/skills?${params}`
}

export function parseCatalog(value: unknown): SkillCatalogPage {
  const data = record(value), body = record(data.data)
  if (data.code !== 0 || !Array.isArray(body.skills) || !Number.isSafeInteger(body.total) || body.total < 0) throw new Error('SkillHub 技能目录返回异常，请重试。')
  const skills: SkillCatalogItem[] = body.skills.slice(0, 24).map((value: unknown) => {
    const item = record(value), namespace = record(item.namespace), labels = record(item.labels)
    // Never discard a namespace and install an ambiguous same-name skill.
    const id = skillReference(namespace.canonicalName)
    return { id, name: string(item.name, 120) || id, description: string(item.description_zh || item.description, 2000), version: string(item.version, 80) || undefined,
      iconUrl: iconUrl(item.iconUrl), category: string(item.category, 80) || undefined, source: ['community', 'clawhub'].includes(item.source) ? item.source : undefined,
      downloads: count(item.downloads), stars: count(item.stars), requiresApiKey: labels.requires_api_key === 'true' ? true : labels.requires_api_key === 'false' ? false : undefined,
      paid: labels.pricing_type === 'paid' ? true : undefined }
  })
  return { skills, total: body.total }
}

export class SkillCatalog {
  private categoryCache?: { expires: number; items: SkillCategory[] }
  constructor(private readonly fetcher: typeof fetch = fetch) {}
  private async json(url: string) {
    try {
      const response = await this.fetcher(url, { signal: AbortSignal.timeout(20000), redirect: 'error' })
      if (!response.ok || !response.body) throw new Error(`SkillHub 目录加载失败（${response.status}）。`)
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.length
          if (size > 4 * 1024 * 1024) { await reader.cancel(); throw new Error('SkillHub 目录响应过大。') }
          chunks.push(value)
        }
      } finally { reader.releaseLock() }
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('SkillHub')) throw error
      throw new Error('SkillHub 目录暂时无法加载，请检查网络后重试。')
    }
  }
  async browse(query: SkillCatalogQuery) { return parseCatalog(await this.json(catalogUrl(query))) }
  async categories(): Promise<SkillCategory[]> {
    if (this.categoryCache && this.categoryCache.expires > Date.now()) return this.categoryCache.items
    const data = record(await this.json(`${ORIGIN}/api/v1/categories`))
    if (!Array.isArray(data.items)) throw new Error('SkillHub 分类返回异常，请重试。')
    const items = data.items.filter((item: any) => item?.active === true && /^[a-z0-9_-]{1,80}$/.test(item.key) && typeof item.name === 'string')
      .sort((a: any, b: any) => (a.sortOrder || 0) - (b.sortOrder || 0)).slice(0, 100).map((item: any) => ({ key: item.key, name: item.name.slice(0, 80) }))
    this.categoryCache = { items, expires: Date.now() + 10 * 60 * 1000 }
    return items
  }
}
