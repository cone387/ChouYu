import type { AppConfig } from '../../shared/config'
import type { MemoryCandidateInput, MemoryRecord, MemoryType } from '../../shared/memory'
import { SQLiteMemoryProvider } from './sqlite-provider'
import { Mem0MemorySyncAdapter } from './sync/mem0-adapter'

/**
 * Mem0-backed primary engine. SQLite is an implementation cache only; all
 * remote persistence is written through the selected Mem0 endpoint.
 */
export class Mem0MemoryProvider extends SQLiteMemoryProvider {
  private readonly remote: Mem0MemorySyncAdapter
  private refreshPromise: Promise<void> | null = null

  constructor(filePath: string, config: AppConfig, mode: 'platform' | 'self-hosted') {
    super(filePath)
    this.remote = new Mem0MemorySyncAdapter({
      baseUrl: config.memorySyncBaseUrl,
      apiKey: config.memorySyncApiKey,
      userId: config.memorySyncUserId,
      mode
    })
  }

  override initialize(): void {
    super.initialize()
    void this.refreshRemote()
  }

  async refreshRemote(): Promise<void> {
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
    const existing = this.list({ status: 'all', limit: 2000 }).find((item) => item.content === content)
    if (existing) return existing
    const type = ['fact', 'preference', 'person', 'project', 'workflow'].includes(String(metadata.chouyu_type))
      ? String(metadata.chouyu_type) as MemoryType
      : 'fact'
    return super.createActive({
      type,
      content,
      importance: typeof metadata.chouyu_importance === 'number' ? metadata.chouyu_importance : 0.6,
      confidence: 1,
      sensitivity: 'normal'
    })
  }

  async rememberRaw(text: string): Promise<MemoryRecord[]> {
    const remoteMemories = await this.remote.rememberRaw(text)
    return remoteMemories.map((memory) => this.cacheRemoteMemory(memory.content, memory.metadata))
  }

  private enqueueRemote(memory: MemoryRecord): void {
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
