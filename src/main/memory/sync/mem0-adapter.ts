import { joinApiUrl } from '../../../shared/ai'
import type { MemoryRecord } from '../../../shared/memory'
import type { MemorySyncAdapter, RemoteMemoryRecord } from './adapter'

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

  private endpoint(): string {
    this.validate()
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
    const endpoint = new URL(this.endpoint())
    endpoint.searchParams.set('user_id', this.config.userId)
    endpoint.searchParams.set('page_size', '1000')
    const response = await this.send(endpoint, {
      method: 'GET',
      headers: this.headers(),
      signal: signal || AbortSignal.timeout(30_000)
    }, '读取记忆')
    return parseMem0Memories(await this.responseJson(response))
  }

  async test(signal?: AbortSignal): Promise<{ remoteCount: number }> {
    return { remoteCount: (await this.list(signal)).length }
  }

  async search(query: string, limit = 6, signal?: AbortSignal): Promise<RemoteMemoryRecord[]> {
    this.validate()
    const response = await this.send(joinApiUrl(this.config.baseUrl, 'memories/search'), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ query: query.slice(0, 4000), user_id: this.config.userId, limit: Math.min(50, Math.max(1, limit)) }),
      signal: signal || AbortSignal.timeout(30_000)
    }, '搜索记忆')
    if (response.status === 404 || response.status === 405) throw new Error('当前 Mem0 Self-hosted 服务不支持 /memories/search，请检查服务版本。')
    return parseMem0Memories(await this.responseJson(response))
  }

  async rememberRaw(text: string, signal?: AbortSignal): Promise<RemoteMemoryRecord[]> {
    this.validate()
    const response = await this.send(this.endpoint(), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        messages: [{ role: 'user', content: text.slice(0, 4000) }],
        user_id: this.config.userId,
        infer: true
      }),
      signal: signal || AbortSignal.timeout(30_000)
    }, '写入记忆')
    return parseMem0Memories(await this.responseJson(response))
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
          const response = await this.send(this.endpoint(), {
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
          await this.responseJson(response)
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
