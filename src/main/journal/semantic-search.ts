import { semanticHash, semanticSourceHash, type SemanticCache, type SemanticCacheEntry } from './semantic-cache'
import { createHash, randomUUID } from 'crypto'
import type { AppConfig } from '../../shared/config'
import type { JournalEvidence, JournalQuery, JournalSemanticPlan, JournalSemanticResult } from '../../shared/journal'
import { validateJournalQuery } from '../../shared/journal'
import { OpenAIEmbeddingClient } from '../memory/embedding-client'
import { journalSemanticChunks, rankJournalSemanticSources } from './semantic'

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const identity = (source: JournalEvidence) => hash([source.id, source.at, source.app, source.title, source.text])
const profile = (config: AppConfig) => ({ baseUrl: config.embeddingBaseUrl || config.baseUrl, apiKey: config.embeddingApiKey || config.apiKey, model: config.embeddingModel, enabled: config.embeddingEnabled, provider: config.embeddingProvider })

export class JournalSemanticSearch {
  private plan?: { public: JournalSemanticPlan; query: JournalQuery; sources: JournalEvidence[]; texts: string[]; config: ReturnType<typeof profile>; cached: Map<string, number[]>; generation: number; scope: string }
  private controller?: AbortController
  private revision = 0
  private preparing = false
  constructor(private load: (query: JournalQuery) => Promise<JournalEvidence[]>, private config: () => Promise<AppConfig>, private request: typeof fetch = fetch, private cache?: SemanticCache) {}

  cancel(): void { this.revision++; this.controller?.abort(); this.plan = undefined }

  async clearCache(): Promise<void> { this.cancel(); await this.cache?.clear() }

  async prepare(input: JournalQuery): Promise<JournalSemanticPlan> {
    if (this.controller || this.preparing) throw new Error('已有语义检索正在处理，请先取消。')
    const query = validateJournalQuery(input)
    if (!query.query) throw new Error('请输入要找回的内容。')
    const revision = this.revision
    this.plan = undefined; this.preparing = true
    try {
      const config = profile(await this.config())
      if (!config.enabled || !config.baseUrl || !config.apiKey || !config.model) throw new Error('请先在记忆连接设置中配置并开启 Embedding 服务。')
      const url = new URL(config.baseUrl)
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Embedding 地址无效。')
      const sources = await this.load(query)
      const chunks = journalSemanticChunks(sources)
      if (!chunks.length) throw new Error('所选范围没有可检索的文字。')
      if (chunks.length > 512) throw new Error('所选范围超过 512 个文本块，请缩小日期或应用范围。')
      const allTexts = [...new Set([query.query, ...chunks.map(chunk => chunk.text)])]
      const scope = hash(config), cached = new Map<string, number[]>()
      const cache = this.cache ? await this.cache.read(scope, sources.map(source => ({ sourceId: source.id, sourceHash: semanticSourceHash(source) }))) : { generation: 0, entries: [] }
      for (const entry of cache.entries) {
        const expected = chunks.filter(chunk => chunk.sourceId === entry.sourceId)
        if (expected.length !== entry.chunks.length || expected.some((chunk, index) => semanticHash(chunk.text) !== entry.chunks[index].key)) continue
        expected.forEach((chunk, index) => cached.set(chunk.text, entry.chunks[index].vector))
      }
      if (new Set([...cached.values()].map(vector => vector.length)).size > 1) cached.clear()
      const texts = allTexts.filter(text => !cached.has(text))
      const value: JournalSemanticPlan = { id: randomUUID(), createdAt: Date.now(), sources: sources.length, chunks: chunks.length, cachedTexts: allTexts.length - texts.length, texts: texts.length, characters: texts.reduce((sum, text) => sum + text.length, 0), batches: Math.ceil(texts.length / 32), service: url.origin + url.pathname, model: config.model }
      if (revision !== this.revision) throw new Error('语义检索准备已取消。')
      this.plan = { public: value, query, sources, texts, config, cached, generation: cache.generation, scope }
      return value
    } finally { this.preparing = false }
  }

  async search(id: string): Promise<JournalSemanticResult> {
    const plan = this.plan
    if (this.controller) throw new Error('已有语义检索正在处理。')
    if (!plan || plan.public.id !== id || Date.now() - plan.public.createdAt > 600_000) throw new Error('检索预览已失效，请重新准备。')
    this.plan = undefined // One confirmation authorizes one run, never an automatic retry.
    const controller = new AbortController(); this.controller = controller
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(300_000)])
    const check = async () => {
      signal.throwIfAborted()
      if (hash(profile(await this.config())) !== hash(plan.config)) throw new Error('Embedding 配置已变化，请重新准备检索。')
      const current = new Set((await this.load(plan.query)).map(identity))
      if (plan.sources.some(source => !current.has(identity(source)))) throw new Error('日志来源已删除或改写，请重新准备检索。')
      signal.throwIfAborted()
    }
    try {
      const vectors: number[][] = []
      const client = new OpenAIEmbeddingClient(plan.config, this.request)
      for (let offset = 0; offset < plan.texts.length; offset += 32) {
        await check()
        vectors.push(...await client.embed(plan.texts.slice(offset, offset + 32), signal))
      }
      await check()
      const lookup = new Map(plan.cached)
      plan.texts.forEach((text, index) => lookup.set(text, vectors[index]))
      const chunks = journalSemanticChunks(plan.sources)
      const items = rankJournalSemanticSources(plan.sources, chunks, chunks.map(chunk => lookup.get(chunk.text)!), lookup.get(plan.query.query!)!)
      let cacheWarning: string | undefined
      if (this.cache) {
        const entries: SemanticCacheEntry[] = plan.sources.flatMap(source => {
          const own = chunks.filter(chunk => chunk.sourceId === source.id)
          return own.length ? [{ sourceId: source.id, sourceHash: semanticSourceHash(source), chunks: own.map(chunk => ({ key: semanticHash(chunk.text), vector: lookup.get(chunk.text)! })) }] : []
        })
        try { await this.cache.write(plan.scope, plan.generation, entries) }
        catch (error) { cacheWarning = `结果已计算，但本次索引未保留：${String(error)}` }
      }
      await check()
      return { preparedAt: plan.public.createdAt, sources: plan.sources.length, model: plan.config.model, items, cacheWarning }
    } catch (error) { if (signal.aborted) throw new Error('语义检索已取消或超时。'); throw error }
    finally { if (this.controller === controller) this.controller = undefined }
  }
}
