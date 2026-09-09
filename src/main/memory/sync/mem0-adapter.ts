import { joinApiUrl } from '../../../shared/ai'
import type { MemoryRecord } from '../../../shared/memory'
import type { MemorySyncAdapter, RemoteMemoryRecord } from './adapter'
import { confirmMem0Event } from './mem0-event'

export interface Mem0AdapterConfig {
  baseUrl: string
  apiKey: string
  userId: string
  mode?: 'platform' | 'self-hosted'
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function resultRows(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  const record = asRecord(value)
  if (Array.isArray(record.results)) return record.results
  if (Array.isArray(record.memories)) return record.memories
  if (Array.isArray(record.output)) return record.output
  if (Array.isArray(record.data)) return record.data
  const data = asRecord(record.data)
  if (Array.isArray(data.results)) return data.results
  if (Array.isArray(data.memories)) return data.memories
  return []
}

function recallFromList(memories: RemoteMemoryRecord[], query: string, limit: number): RemoteMemoryRecord[] {
  const normalizedQuery = query.toLowerCase().replace(/\s+/g, '')
  const queryBigrams = new Set(Array.from(normalizedQuery).flatMap((_, index, chars) => index + 1 < chars.length ? [chars.slice(index, index + 2).join('')] : []))
  return memories
    .map((memory, index) => {
      const content = memory.content.toLowerCase().replace(/\s+/g, '')
      const exact = normalizedQuery && content.includes(normalizedQuery) ? 1 : 0
      const overlap = queryBigrams.size > 0
        ? [...queryBigrams].filter((bigram) => content.includes(bigram)).length / queryBigrams.size
        : 0
      return { memory, score: exact * 2 + overlap, index }
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map((item) => item.memory)
}

export function parseMem0Memories(value: unknown): RemoteMemoryRecord[] {
  return resultRows(value).flatMap((row, index) => {
    const record = asRecord(row)
    const content = typeof record.memory === 'string' ? record.memory : typeof record.content === 'string' ? record.content : ''
    if (!content.trim()) return []
    const created = typeof record.created_at === 'string' || typeof record.created_at === 'number' ? new Date(record.created_at).getTime() : undefined
    return [{
      id: typeof record.id === 'string' ? record.id.slice(0, 256) : `remote-${index}`,
      content: content.trim().slice(0, 500),
      metadata: asRecord(record.metadata),
      createdAt: created && Number.isFinite(created) ? created : undefined
    }]
  })
}

export class Mem0MemorySyncAdapter implements MemorySyncAdapter {
  readonly provider = 'mem0' as const

  constructor(private readonly config: Mem0AdapterConfig, private readonly request: typeof fetch = fetch) {}

  private validate(): void {
    if (!this.config.baseUrl.trim()) throw new Error('尚未配置 Mem0 Base URL。')
    if ((this.config.mode || 'platform') === 'platform' && !this.config.apiKey.trim()) throw new Error('尚未配置 Mem0 API Key。')
    if (!this.config.userId.trim()) throw new Error('尚未配置 Mem0 User ID。')
    let parsed: URL
    try {
      parsed = new URL(this.config.baseUrl)
    } catch {
      throw new Error('Mem0 Base URL 格式无效。')
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Mem0 Base URL 必须是有效的 HTTP(S) 地址。')
  }

  private get platformV3(): boolean {
    return (this.config.mode || 'platform') === 'platform' && /\/v3\/?$/.test(new URL(this.config.baseUrl).pathname)
  }

  private endpoint(operation: 'list' | 'add' | 'search' | 'manage' = 'list'): string {
    this.validate()
    if (this.platformV3) {
      const url = new URL(this.config.baseUrl)
      const prefix = url.pathname.replace(/\/v3\/?$/, '')
      url.pathname = operation === 'manage' ? `${prefix}/v1/memories` : `${prefix}/v3/memories/${operation === 'list' ? '' : operation + '/'}`
      url.search = ''; url.hash = ''
      return url.href
    }
    return joinApiUrl(this.config.baseUrl, 'memories')
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.config.apiKey.trim()) {
      if ((this.config.mode || 'platform') === 'self-hosted') headers['X-API-Key'] = this.config.apiKey
      else headers.Authorization = `Token ${this.config.apiKey}`
    }
    return headers
  }

  private async responseJson(response: Response): Promise<unknown> {
    if (response.status === 204) return []
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 1000)
      if (response.status === 401 || response.status === 403) throw new Error('Mem0 认证失败，请检查 API Key。')
      throw new Error(`Mem0 API error ${response.status}${detail ? `: ${detail}` : ''}`)
    }
    try {
      return await response.json()
    } catch {
      throw new Error('Mem0 返回了无法解析的响应。')
    }
  }

  private async send(input: Parameters<typeof fetch>[0], init: RequestInit, operation: string): Promise<Response> {
    try {
      return await this.request(input, init)
    } catch (error) {
      const name = error instanceof Error ? error.name : ''
      if (name === 'AbortError' || name === 'TimeoutError') throw new Error(`Mem0 ${operation}超时，请检查服务状态和网络。`)
      throw new Error(`无法连接 Mem0 执行${operation}，请检查 Base URL 和服务是否已启动。`)
    }
  }

  async list(signal?: AbortSignal): Promise<RemoteMemoryRecord[]> {
    return (await this.listSnapshot(signal)).memories
  }

  async listSnapshot(signal?: AbortSignal): Promise<{ memories: RemoteMemoryRecord[]; complete: boolean }> {
    const endpoint = new URL(this.endpoint())
    if (!this.platformV3) endpoint.searchParams.set('user_id', this.config.userId)
    endpoint.searchParams.set('page_size', this.platformV3 ? '200' : '1000')
    const deadline = AbortSignal.timeout(30_000)
    const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline
    const visited = new Set<string>(), ids = new Set<string>()
    const memories: RemoteMemoryRecord[] = []
    let next: URL | null = endpoint, total: number | undefined
    while (next) {
      requestSignal.throwIfAborted()
      if (visited.has(next.href) || visited.size >= 100) throw new Error('Mem0 分页循环或超过 100 页，未取得完整列表。')
      visited.add(next.href)
      const response = await this.send(next, { method: this.platformV3 ? 'POST' : 'GET', body: this.platformV3 ? JSON.stringify({ filters: { user_id: this.config.userId } }) : undefined, headers: this.headers(), signal: requestSignal, redirect: 'error' }, '读取记忆')
      const value = await this.responseJson(response)
      requestSignal.throwIfAborted()
      const record = asRecord(value), nested = asRecord(record.data)
      const envelope = Array.isArray(nested.results) || Array.isArray(nested.memories) ? { ...record, ...nested } : record
      if (this.platformV3 && (!Array.isArray(record.results) || record.count === undefined || !Object.hasOwn(record, 'next'))) throw new Error('Mem0 V3 列表缺少分页信息。')
      const rows = resultRows(value)
      const recognized = Array.isArray(value) || ['results', 'memories', 'output', 'data'].some(key => Array.isArray(envelope[key]))
      if (!recognized || rows.some(row => {
        const item = asRecord(row)
        return typeof item.id !== 'string' || !item.id.trim() || item.id.length > 256 ||
          !(typeof item.memory === 'string' && item.memory.trim() || typeof item.content === 'string' && item.content.trim())
      })) throw new Error('Mem0 列表格式无效，未取得完整列表。')
      const page = parseMem0Memories(value)
      for (const memory of page) {
        if (ids.has(memory.id)) throw new Error('Mem0 分页出现重复记录，请重试以取得一致列表。')
        ids.add(memory.id); memories.push(memory)
      }
      if (memories.length > 20_000) throw new Error('Mem0 列表超过 20000 条，未取得完整列表。')
      if (envelope.count !== undefined) {
        if (!Number.isSafeInteger(envelope.count) || Number(envelope.count) < 0 || total !== undefined && total !== envelope.count) throw new Error('Mem0 分页总数无效或发生变化，请重试。')
        total = Number(envelope.count)
      }
      const link = envelope.next
      if (link === undefined || link === null || link === '') {
        if (total !== undefined && total !== memories.length) throw new Error('Mem0 分页尚未取完或总数不一致，未取得完整列表。')
        next = null
      } else {
        if (typeof link !== 'string' || !page.length) throw new Error('Mem0 下一页格式无效，未取得完整列表。')
        const candidate: URL = new URL(link, next)
        if (candidate.origin !== endpoint.origin || candidate.pathname.replace(/\/$/, '') !== endpoint.pathname.replace(/\/$/, '') || candidate.username || candidate.password || candidate.hash ||
          candidate.searchParams.getAll('user_id').some(user => user !== this.config.userId)) throw new Error('Mem0 下一页超出当前服务或用户范围。')
        if (!this.platformV3) candidate.searchParams.set('user_id', this.config.userId)
        next = candidate
      }
    }
    return { memories, complete: total !== undefined }
  }

  async test(signal?: AbortSignal): Promise<{ remoteCount: number }> {
    return { remoteCount: (await this.list(signal)).length }
  }

  /** Mutations are scoped to an ID returned by the configured user's list. */
  private async ownedEndpoint(remoteId: string, signal?: AbortSignal): Promise<string> {
    if (!remoteId || remoteId.length > 256) throw new Error('Mem0 记忆 ID 无效。')
    const owned = await this.list(signal)
    if (!owned.some(memory => memory.id === remoteId)) throw new Error('当前 Mem0 用户范围内找不到这条记忆，已取消修改。')
    return `${this.endpoint('manage')}/${encodeURIComponent(remoteId)}${this.platformV3 ? '/' : ''}`
  }

  async updateRemote(remoteId: string, content: string, metadata: Record<string, unknown>, signal?: AbortSignal): Promise<void> {
    if (!content.trim() || content.length > 500) throw new Error('Mem0 记忆正文长度无效。')
    const endpoint = await this.ownedEndpoint(remoteId, signal)
    // Both HTTP APIs accept `text`; OSS's Python SDK uses `data` instead.
    const body = { text: content, metadata }
    const response = await this.send(endpoint, { method: 'PUT', headers: this.headers(), body: JSON.stringify(body), signal: signal || AbortSignal.timeout(30_000) }, '更新记忆')
    await this.responseJson(response)
    const stored = (await this.list(signal)).find(memory => memory.id === remoteId)
    if (stored?.content !== content.trim()) throw new Error('Mem0 尚未确认更新后的内容，请刷新后重试；本地内容未修改。')
    if (Object.entries(metadata).some(([key, value]) => JSON.stringify(stored.metadata[key]) !== JSON.stringify(value))) throw new Error('Mem0 尚未确认更新后的属性，请刷新后重试；本地状态未修改。')
  }

  async deleteRemote(remoteId: string, signal?: AbortSignal): Promise<void> {
    const endpoint = await this.ownedEndpoint(remoteId, signal)
    const response = await this.send(endpoint, { method: 'DELETE', headers: this.headers(), signal: signal || AbortSignal.timeout(30_000) }, '删除记忆')
    await this.responseJson(response)
    if ((await this.list(signal)).some(memory => memory.id === remoteId)) throw new Error('Mem0 尚未确认删除，请刷新后重试；本地记录已保留。')
  }

  async search(query: string, limit = 6, signal?: AbortSignal): Promise<RemoteMemoryRecord[]> {
    this.validate()
    const boundedLimit = Math.min(50, Math.max(1, limit))
    if (this.platformV3) {
      const bounded = signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000)
      bounded.throwIfAborted()
      const response = await this.send(this.endpoint('search'), { method: 'POST', headers: this.headers(), body: JSON.stringify({ query: query.slice(0, 4000), filters: { user_id: this.config.userId }, top_k: boundedLimit }), signal: bounded, redirect: 'error' }, '搜索记忆')
      const value = await this.responseJson(response)
      bounded.throwIfAborted()
      return parseMem0Memories(value)
    }
    const endpoints = ['memories/search', 'memories/search/', 'search', 'search/']
    let response: Response | null = null
    for (const endpoint of endpoints) {
      const candidate = await this.send(joinApiUrl(this.config.baseUrl, endpoint), {
        method: 'POST',
        headers: this.headers(),
        // `top_k` is accepted by older Mem0 OSS builds while newer builds use
        // `limit`; sending both keeps the adapter compatible across versions.
        body: JSON.stringify({ query: query.slice(0, 4000), user_id: this.config.userId, limit: boundedLimit, top_k: boundedLimit }),
        signal: signal || AbortSignal.timeout(30_000)
      }, '搜索记忆')
      if (candidate.status !== 404 && candidate.status !== 405) {
        response = candidate
        break
      }
    }
    if (!response) {
      // Some self-hosted deployments expose listing but not semantic search.
      // Keep recall functional using only the remote records returned for this
      // user; this is a compatibility fallback, not a second local store.
      return recallFromList(await this.list(signal), query, boundedLimit)
    }
    return parseMem0Memories(await this.responseJson(response))
  }

  async rememberRaw(text: string, signal?: AbortSignal): Promise<RemoteMemoryRecord[]> {
    this.validate()
    const response = await this.send(this.endpoint('add'), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        messages: [{ role: 'user', content: text.slice(0, 4000) }],
        user_id: this.config.userId,
        infer: true
      }),
      signal: signal || AbortSignal.timeout(30_000)
    }, '写入记忆')
    return parseMem0Memories(await this.confirmWrite(await this.responseJson(response), signal))
  }

  private confirmWrite(value: unknown, signal?: AbortSignal): Promise<unknown> {
    return confirmMem0Event(value, async (id, bounded) => {
      const base = new URL(this.config.baseUrl)
      base.pathname = `${base.pathname.replace(/\/+$/, '').replace(/\/v[123]$/, '')}/v1/event/${encodeURIComponent(id)}/`
      base.search = ''; base.hash = ''
      const response = await this.send(base, { method: 'GET', headers: this.headers(), signal: bounded, redirect: 'error' }, '确认写入')
      return this.responseJson(response)
    }, signal)
  }

  async push(memories: readonly MemoryRecord[], signal?: AbortSignal): Promise<{ attempted: number; succeeded: number; skipped: number; failed: number }> {
    this.validate()
    const remote = await this.list(signal)
    const remoteLocalIds = new Set(remote.map((memory) => memory.metadata.chouyu_id).filter((id): id is string => typeof id === 'string'))
    const remoteContents = new Set(remote.map((memory) => memory.content.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')))
    let succeeded = 0
    let skipped = 0
    let failed = 0
    let lastError: Error | null = null
    const batch = memories.slice(0, 2000)
    const pending = batch.filter((memory) => {
      if (remoteLocalIds.has(memory.id) || remoteContents.has(memory.normalizedKey)) {
        skipped += 1
        return false
      }
      return true
    })
    for (let start = 0; start < pending.length; start += 5) {
      await Promise.all(pending.slice(start, start + 5).map(async (memory) => {
        try {
          const response = await this.send(this.endpoint('add'), {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify({
              messages: [{ role: 'user', content: memory.content }],
              user_id: this.config.userId,
              // ChouYu has already extracted and validated this memory with
              // its own LLM. Do not make the self-hosted server call another
              // upstream provider while persisting it.
              infer: false,
              metadata: {
                chouyu_id: memory.id,
                chouyu_type: memory.type,
                chouyu_sensitivity: memory.sensitivity,
                chouyu_importance: memory.importance,
                chouyu_updated_at: memory.updatedAt,
                chouyu_expires_at: memory.expiresAt || null,
                chouyu_source_session_id: memory.sourceSessionId || null,
                chouyu_source_message_id: memory.sourceMessageId || null
              }
            }),
            signal: signal || AbortSignal.timeout(30_000)
          }, '写入记忆')
          await this.confirmWrite(await this.responseJson(response), signal)
          succeeded += 1
        } catch (error) {
          failed += 1
          lastError = error instanceof Error ? error : new Error('Mem0 上传失败。')
        }
      }))
    }
    if (failed > 0 && succeeded === 0 && skipped === 0 && lastError) throw lastError
    return { attempted: batch.length, succeeded, skipped, failed }
  }
}
