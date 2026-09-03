import type { AppConfig } from '../../shared/config'
import type { MemoryCandidateInput, MemoryRecord, MemoryType } from '../../shared/memory'
import { getConfig } from '../database'
import { SQLiteMemoryProvider } from './sqlite-provider'
import { Mem0MemorySyncAdapter } from './sync/mem0-adapter'

/**
 * Mem0-backed primary engine. SQLite is an implementation cache only; all
 * remote persistence is written through the selected Mem0 endpoint.
 */
export class Mem0MemoryProvider extends SQLiteMemoryProvider {
  private remote: Mem0MemorySyncAdapter
  private remoteConfigSignature: string

  constructor(filePath: string, config: AppConfig, mode: 'platform' | 'self-hosted') {
    super(filePath)
    this.remote = new Mem0MemorySyncAdapter({
      baseUrl: config.memorySyncBaseUrl,
      apiKey: config.memorySyncApiKey,
      userId: config.memorySyncUserId,
      mode
    })
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
    })
    this.remoteConfigSignature = signature
  }

  override initialize(): void {
    super.initialize()
  }

  async searchRemote(query: string, limit = 6): Promise<MemoryRecord[]> {
    this.refreshRemoteConfig()
    const remoteMemories = await this.remote.search(query, limit)
    return remoteMemories.map((memory) => this.cacheRemoteMemory(memory.content, memory.metadata))
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
    void this.remote.push([memory]).catch((error) => console.warn('[Memory] Mem0 primary write failed:', error))
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
