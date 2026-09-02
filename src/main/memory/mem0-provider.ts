import type { AppConfig } from '../../shared/config'
import type { MemoryCandidateInput, MemoryRecord, MemorySyncOutboxStatus, MemoryType } from '../../shared/memory'
import { memorySyncRetryDelay } from '../../shared/memory'
import { getConfig } from '../database'
import { SQLiteMemoryProvider } from './sqlite-provider'
import { Mem0MemorySyncAdapter } from './sync/mem0-adapter'

/**
 * Mem0-backed primary engine. SQLite is an implementation cache only; all
 * remote persistence is written through the selected Mem0 endpoint.
 */
export class Mem0MemoryProvider extends SQLiteMemoryProvider {
  private remote: Mem0MemorySyncAdapter
  private readonly request: typeof fetch
  private remoteConfigSignature: string
  private refreshPromise: Promise<void> | null = null
  private flushPromise: Promise<void> | null = null
  private syncTimer: ReturnType<typeof setInterval> | null = null
  private closed = false

  constructor(filePath: string, config: AppConfig, mode: 'platform' | 'self-hosted', request: typeof fetch = fetch) {
    super(filePath)
    this.request = request
    this.remote = new Mem0MemorySyncAdapter({
      baseUrl: config.memorySyncBaseUrl,
      apiKey: config.memorySyncApiKey,
      userId: config.memorySyncUserId,
      mode
    }, request)
    this.remoteConfigSignature = this.signature(config, mode)
  }

  private signature(config: AppConfig, mode: 'platform' | 'self-hosted'): string {
    return [mode, config.memorySyncBaseUrl, config.memorySyncApiKey, config.memorySyncUserId].join('\u0000')
  }

  private refreshRemoteConfig(): void {
    const config = getConfig()
    const mode = config.memoryEngineProvider === 'mem0-self-hosted-engine' ? 'self-hosted' : 'platform'
    const signature = this.signature(config, mode)
    if (signature === this.remoteConfigSignature) return
    this.remote = new Mem0MemorySyncAdapter({
      baseUrl: config.memorySyncBaseUrl,
      apiKey: config.memorySyncApiKey,
      userId: config.memorySyncUserId,
      mode
    }, this.request)
    this.remoteConfigSignature = signature
  }

  override initialize(): void {
    super.initialize()
    this.closed = false
    this.syncTimer = setInterval(() => { void this.flushOutbox() }, 30_000)
    void this.refreshRemote()
    void this.flushOutbox()
  }

  override close(): void {
    this.closed = true
    if (this.syncTimer) clearInterval(this.syncTimer)
    this.syncTimer = null
    this.refreshPromise = null
    this.flushPromise = null
    super.close()
  }

  async refreshRemote(): Promise<void> {
    this.refreshRemoteConfig()
    if (this.refreshPromise) return this.refreshPromise
    this.refreshPromise = this.loadRemote().finally(() => { this.refreshPromise = null })
    return this.refreshPromise
  }

  private async loadRemote(): Promise<void> {
    try {
      const remoteMemories = await this.remote.list()
      if (remoteMemories.length === 0) {
        const localMemories = this.list({ status: 'active', limit: 2000 })
        if (localMemories.length > 0) {
          await this.remote.push(localMemories)
          return
        }
      }
      for (const memory of remoteMemories) {
        this.cacheRemoteMemory(memory.content, memory.metadata)
      }
    } catch (error) {
      console.warn('[Memory] Mem0 primary refresh failed:', error)
    }
  }

  private cacheRemoteMemory(content: string, metadata: Record<string, unknown>): MemoryRecord {
    const remoteLocalId = typeof metadata.chouyu_id === 'string' ? metadata.chouyu_id : ''
    const existing = this.list({ status: 'all', limit: 2000 }).find((item) =>
      (remoteLocalId && item.id === remoteLocalId) || item.content === content
    )
    if (existing) return existing
    const type = ['fact', 'preference', 'person', 'project', 'workflow'].includes(String(metadata.chouyu_type))
      ? String(metadata.chouyu_type) as MemoryType
      : 'fact'
    return super.createActive({
      type,
      content,
      importance: typeof metadata.chouyu_importance === 'number' ? metadata.chouyu_importance : 0.6,
      confidence: 1,
      sensitivity: metadata.chouyu_sensitivity === 'sensitive' ? 'sensitive' : 'normal',
      sourceSessionId: typeof metadata.chouyu_source_session_id === 'string' ? metadata.chouyu_source_session_id : undefined,
      sourceMessageId: typeof metadata.chouyu_source_message_id === 'string' ? metadata.chouyu_source_message_id : undefined
    })
  }

  async rememberRaw(text: string, source?: { sessionId?: string; messageId?: string }): Promise<MemoryRecord[]> {
    this.refreshRemoteConfig()
    const remoteMemories = await this.remote.rememberRaw(text)
    return remoteMemories.map((memory) => this.cacheRemoteMemory(memory.content, {
      ...memory.metadata,
      chouyu_source_session_id: source?.sessionId,
      chouyu_source_message_id: source?.messageId
    }))
  }

  private enqueueRemote(memory: MemoryRecord): void {
    this.refreshRemoteConfig()
    const now = Date.now()
    try {
      this.db().prepare(`
        INSERT INTO memory_sync_outbox (memory_id, payload, attempts, next_attempt_at, last_error, created_at, updated_at)
        VALUES (?, ?, 0, ?, NULL, ?, ?)
        ON CONFLICT(memory_id) DO UPDATE SET payload = excluded.payload, next_attempt_at = MIN(memory_sync_outbox.next_attempt_at, excluded.next_attempt_at), updated_at = excluded.updated_at
      `).run(memory.id, JSON.stringify(memory), now, now, now)
    } catch (error) {
      console.warn('[Memory] Failed to enqueue Mem0 primary write:', error)
      return
    }
    void this.flushOutbox()
  }

  private async flushOutbox(): Promise<void> {
    if (this.closed || this.flushPromise) return this.flushPromise || Promise.resolve()
    this.refreshRemoteConfig()
    this.flushPromise = (async () => {
      try {
        const rows = this.db().prepare(`
          SELECT memory_id, payload, attempts FROM memory_sync_outbox
          WHERE next_attempt_at <= ? ORDER BY created_at ASC LIMIT 20
        `).all(Date.now()) as Array<{ memory_id: string; payload: string; attempts: number }>
        for (const row of rows) {
          if (this.closed) break
          try {
            const memory = JSON.parse(row.payload) as MemoryRecord
            const result = await this.remote.push([memory])
            if (result.failed > 0 && result.succeeded === 0 && result.skipped === 0) {
              throw new Error('Mem0 上传失败。')
            }
            this.db().prepare('DELETE FROM memory_sync_outbox WHERE memory_id = ?').run(row.memory_id)
          } catch (error) {
            const attempts = row.attempts + 1
            const message = error instanceof Error ? error.message : 'Mem0 上传失败。'
            this.db().prepare(`
              UPDATE memory_sync_outbox
              SET attempts = ?, next_attempt_at = ?, last_error = ?, updated_at = ?
              WHERE memory_id = ?
            `).run(attempts, Date.now() + memorySyncRetryDelay(attempts), message.slice(0, 500), Date.now(), row.memory_id)
          }
        }
      } catch (error) {
        console.warn('[Memory] Mem0 outbox flush failed:', error)
      } finally {
        this.flushPromise = null
      }
    })()
    return this.flushPromise
  }

  getSyncOutboxStatus(): MemorySyncOutboxStatus {
    const summary = this.db().prepare(`
      SELECT COUNT(*) AS pending,
        SUM(CASE WHEN attempts > 0 THEN 1 ELSE 0 END) AS failed,
        MAX(CASE WHEN attempts > 0 THEN updated_at ELSE NULL END) AS last_attempt_at
      FROM memory_sync_outbox
    `).get() as { pending: number; failed: number; last_attempt_at: number | null }
    const lastError = this.db().prepare(`
      SELECT last_error FROM memory_sync_outbox
      WHERE last_error IS NOT NULL ORDER BY updated_at DESC LIMIT 1
    `).get() as { last_error: string } | undefined
    return {
      pending: Number(summary.pending || 0),
      failed: Number(summary.failed || 0),
      lastError: lastError?.last_error,
      lastAttemptAt: summary.last_attempt_at || undefined
    }
  }

  async retrySyncOutbox(): Promise<MemorySyncOutboxStatus> {
    this.db().prepare('UPDATE memory_sync_outbox SET next_attempt_at = ? WHERE attempts > 0').run(Date.now())
    await this.flushOutbox()
    return this.getSyncOutboxStatus()
  }

  override createActive(candidate: MemoryCandidateInput): MemoryRecord {
    const memory = super.createActive(candidate)
    this.enqueueRemote(memory)
    return memory
  }

  override approve(id: string): MemoryRecord {
    const memory = super.approve(id)
    this.enqueueRemote(memory)
    return memory
  }

  override update(id: string, patch: Parameters<SQLiteMemoryProvider['update']>[1]): MemoryRecord {
    const memory = super.update(id, patch)
    this.enqueueRemote(memory)
    return memory
  }

  override reactivate(id: string): MemoryRecord {
    const memory = super.reactivate(id)
    this.enqueueRemote(memory)
    return memory
  }

  override resolveConflict(id: string, action: Parameters<SQLiteMemoryProvider['resolveConflict']>[1]): MemoryRecord | null {
    const memory = super.resolveConflict(id, action)
    if (memory) this.enqueueRemote(memory)
    return memory
  }
}
