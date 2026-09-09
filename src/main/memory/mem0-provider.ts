import type { AppConfig } from '../../shared/config'
import type { MemoryArchiveReason, MemoryCandidateInput, MemoryConflictAction, MemoryRecord, MemoryType } from '../../shared/memory'
import { normalizeMemoryKey } from '../../shared/memory'
import { getConfig } from '../database'
import { SQLiteMemoryProvider } from './sqlite-provider'
import { Mem0MemorySyncAdapter } from './sync/mem0-adapter'
import { memoryConnectionScope } from './connection-scope'
import type { MemoryUpdate } from './provider'
import { remoteMemoryAttributes } from './remote-attributes'

/**
 * Mem0-backed primary engine. SQLite is an implementation cache only; all
 * remote persistence is written through the selected Mem0 endpoint.
 */
export class Mem0MemoryProvider extends SQLiteMemoryProvider {
  private remote: Mem0MemorySyncAdapter
  private remoteConfigSignature: string
  private mutationQueue: Promise<unknown> = Promise.resolve()
  private readonly cacheScope: string

  private scope(): string {
    return memoryConnectionScope(getConfig())
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.mutationQueue.then(operation)
    this.mutationQueue = next.catch(() => {})
    return next
  }

  constructor(filePath: string, config: AppConfig, mode: 'platform' | 'self-hosted') {
    // Keep local-only memories, other services, and other users in separate
    // databases, including candidates, revisions, topics, and embeddings.
    super(`${filePath}.mem0-${memoryConnectionScope(config)}.db`)
    this.cacheScope = memoryConnectionScope(config)
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
    if (this.scope() !== this.cacheScope) throw new Error('记忆连接已切换，请重新加载后重试。')
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
    this.db().exec('CREATE TABLE IF NOT EXISTS mem0_links (scope TEXT NOT NULL, local_id TEXT NOT NULL, remote_id TEXT NOT NULL, PRIMARY KEY (scope, local_id))')
  }

  async searchRemote(query: string, limit = 6): Promise<MemoryRecord[]> {
    return this.serialize(async () => {
      this.refreshRemoteConfig()
      const remoteMemories = await this.remote.search(query, limit)
      if (this.scope() !== this.cacheScope) throw new Error('记忆连接已切换，已丢弃旧连接的搜索结果。')
      return remoteMemories.map((memory) => this.cacheRemoteMemory(memory.content, memory.metadata, memory.id))
        .filter(memory => memory.status === 'active' && (!memory.expiresAt || memory.expiresAt > Date.now()))
    })
  }

  refreshRemoteList(): Promise<{ refreshedAt: number; remoteCount: number; removed: number; complete: boolean }> {
    return this.serialize(async () => {
      this.refreshRemoteConfig()
      const signature = this.remoteConfigSignature
      const snapshot = await this.remote.listSnapshot()
      const config = getConfig()
      const mode = config.memoryEngineProvider === 'mem0-self-hosted-engine' ? 'self-hosted' : 'platform'
      if (this.scope() !== this.cacheScope || this.signature(config, mode) !== signature) throw new Error('记忆连接已切换，已丢弃旧连接的列表。')
      return this.db().transaction(() => {
        const retained = new Set<string>()
        const remoteIds = new Set(snapshot.memories.map(memory => memory.id))
        for (const remote of snapshot.memories) {
          const local = this.cacheRemoteMemory(remote.content, remote.metadata, remote.id)
          if (local.status === 'pending' || retained.has(local.id)) throw new Error('远端条目与本地候选或其他远端条目存在映射冲突，缓存未修改。')
          retained.add(local.id)
        }
        let removed = 0
        if (snapshot.complete) {
          const links = this.db().prepare('SELECT local_id,remote_id FROM mem0_links WHERE scope = ?').all(this.cacheScope) as Array<{ local_id: string; remote_id: string }>
          for (const link of links) {
            if (remoteIds.has(link.remote_id) || retained.has(link.local_id)) continue
            const row = this.db().prepare('SELECT status FROM memories WHERE id = ?').get(link.local_id) as { status: string } | undefined
            if (row && row.status !== 'pending') { super.delete(link.local_id); removed++ }
            this.db().prepare('DELETE FROM mem0_links WHERE scope = ? AND local_id = ?').run(this.cacheScope, link.local_id)
          }
        }
        return { refreshedAt: Date.now(), remoteCount: snapshot.memories.length, removed, complete: snapshot.complete }
      })()
    })
  }

  private cacheRemoteMemory(content: string, metadata: Record<string, unknown>, remoteId: string): MemoryRecord {
    const scope = this.scope()
    const link = this.db().prepare('SELECT local_id FROM mem0_links WHERE scope = ? AND remote_id = ?').get(scope, remoteId) as { local_id: string } | undefined
    const remoteLocalId = typeof metadata.chouyu_id === 'string' ? metadata.chouyu_id : ''
    const match = this.db().prepare('SELECT id FROM memories WHERE id = ? OR id = ? OR content = ? ORDER BY CASE WHEN id = ? THEN 0 WHEN id = ? THEN 1 ELSE 2 END LIMIT 1')
      .get(link?.local_id || '', remoteLocalId, content, link?.local_id || '', remoteLocalId) as { id: string } | undefined
    const existing = match ? this.getRequired(match.id) : undefined
    const attributes = remoteMemoryAttributes(metadata, existing)
    const memory = existing || super.createActive({ ...attributes, content, confidence: 1 })
    this.db().prepare('INSERT OR REPLACE INTO mem0_links(scope, local_id, remote_id) VALUES (?, ?, ?)').run(scope, memory.id, remoteId)
    if (attributes.status === 'archived' && memory.status === 'active') super.archive(memory.id)
    else if (attributes.status === 'active' && memory.status === 'archived') super.reactivate(memory.id)
    const afterStatus = this.getRequired(memory.id)
    if (afterStatus.content !== content || afterStatus.type !== attributes.type || afterStatus.importance !== attributes.importance || afterStatus.expiresAt !== attributes.expiresAt) {
      super.update(memory.id, { content, type: attributes.type, importance: attributes.importance, expiresAt: attributes.expiresAt ?? null })
    }
    if (memory.sensitivity !== attributes.sensitivity || memory.sourceSessionId !== attributes.sourceSessionId || memory.sourceMessageId !== attributes.sourceMessageId) {
      this.db().prepare('UPDATE memories SET sensitivity = ?,source_session_id = ?,source_message_id = ?,updated_at = ? WHERE id = ?')
        .run(attributes.sensitivity, attributes.sourceSessionId ?? null, attributes.sourceMessageId ?? null, Date.now(), memory.id)
    }
    return this.getRequired(memory.id)
  }

  async rememberRaw(text: string, source?: { sessionId?: string; messageId?: string }): Promise<MemoryRecord[]> {
    return this.serialize(async () => {
      this.refreshRemoteConfig()
      const remoteMemories = await this.remote.rememberRaw(text)
      if (this.scope() !== this.cacheScope) throw new Error('远端已接收请求，但记忆连接已切换，请刷新原连接确认。')
      return remoteMemories.map((memory) => this.cacheRemoteMemory(memory.content, {
        ...memory.metadata,
        chouyu_source_session_id: source?.sessionId,
        chouyu_source_message_id: source?.messageId
      }, memory.id))
    })
  }

  private async findRemoteId(memory: MemoryRecord, remote: Mem0MemorySyncAdapter, scope: string): Promise<string | undefined> {
    const link = this.db().prepare('SELECT remote_id FROM mem0_links WHERE scope = ? AND local_id = ?').get(scope, memory.id) as { remote_id: string } | undefined
    const records = await remote.list()
    const matches = records.filter(item => link ? item.id === link.remote_id : item.metadata.chouyu_id === memory.id || (memory.status !== 'pending' && item.content === memory.content))
    if (matches.length > 1) throw new Error('Mem0 中存在多条匹配记录，请先在远端确认目标，避免误改。')
    const id = matches[0]?.id
    if (id) this.db().prepare('INSERT OR REPLACE INTO mem0_links(scope, local_id, remote_id) VALUES (?, ?, ?)').run(scope, memory.id, id)
    return id
  }

  updateConfirmed(id: string, patch: MemoryUpdate): Promise<MemoryRecord> {
    return this.serialize(async () => {
      this.refreshRemoteConfig()
      const remote = this.remote, scope = this.scope()
      const current = this.getRequired(id)
      if (current.status === 'pending') return super.update(id, patch)
      const content = (patch.content ?? current.content).trim()
      if (!content || content.length > 500) throw new Error('记忆内容不能为空或超过 500 字符。')
      const remoteId = await this.findRemoteId(current, remote, scope)
      if (!remoteId) throw new Error('远端记忆不存在，本地内容未修改，请刷新远端记忆。')
      await remote.updateRemote(remoteId, content, { chouyu_id: id, chouyu_type: patch.type ?? current.type, chouyu_importance: patch.importance ?? current.importance, chouyu_sensitivity: current.sensitivity, chouyu_expires_at: patch.expiresAt === undefined ? current.expiresAt || null : patch.expiresAt })
      if (scope !== this.scope()) throw new Error('远端已更新，但连接配置已切换；请重新加载记忆。')
      return super.update(id, patch)
    })
  }

  approveConfirmed(id: string): Promise<MemoryRecord> {
    return this.serialize(async () => {
      this.refreshRemoteConfig()
      const remote = this.remote, scope = this.scope()
      const current = this.getRequired(id)
      if (current.status !== 'pending') throw new Error('记忆候选不存在或已处理。')
      if (this.listConflicts(id).some(conflict => conflict.status === 'pending')) throw new Error('该候选与已有记忆冲突，请先处理冲突。')
      const result = await remote.push([current])
      if (result.failed) throw new Error('Mem0 写入未完成，候选已保留，可重试。')
      const stored = (await remote.list()).filter(memory => memory.metadata.chouyu_id === id || memory.content === current.content)
      if (stored.length !== 1 || stored[0].content !== current.content) throw new Error('Mem0 尚未确认保存内容，候选已保留，请刷新后重试。')
      if (scope !== this.scope()) throw new Error('远端已写入，但连接配置已切换；请重新加载记忆。')
      this.db().prepare('INSERT OR REPLACE INTO mem0_links(scope, local_id, remote_id) VALUES (?, ?, ?)').run(scope, id, stored[0].id)
      return super.approve(id)
    })
  }

  restoreRevisionConfirmed(id: string, revisionId: string): Promise<MemoryRecord> {
    return this.serialize(async () => {
      this.refreshRemoteConfig()
      const remote = this.remote, scope = this.scope()
      const current = this.getRequired(id)
      if (current.status !== 'active') throw new Error('只能恢复已启用记忆的历史版本。')
      const revision = this.listRevisions(id).find(item => item.id === revisionId)
      if (!revision) throw new Error('记忆版本不存在。')
      const remoteId = await this.findRemoteId(current, remote, scope)
      if (!remoteId) throw new Error('远端记忆不存在，未恢复本地历史版本。')
      await remote.updateRemote(remoteId, revision.content, {
        chouyu_id: id, chouyu_type: revision.type, chouyu_importance: revision.importance,
        chouyu_sensitivity: current.sensitivity, chouyu_expires_at: current.expiresAt || null
      })
      if (scope !== this.scope()) throw new Error('远端已恢复，但连接配置已切换，请重新加载记忆。')
      return super.restoreRevision(id, revisionId)
    })
  }

  deleteConfirmed(id: string, pendingOnly = false): Promise<void> {
    return this.serialize(async () => {
      this.refreshRemoteConfig()
      const remote = this.remote, scope = this.scope()
      const current = this.getRequired(id)
      if (pendingOnly && current.status !== 'pending') throw new Error('记忆候选不存在或已处理。')
      const remoteId = await this.findRemoteId(current, remote, scope)
      if (remoteId) await remote.deleteRemote(remoteId)
      if (scope !== this.scope()) throw new Error('连接配置已切换，请重新加载记忆后确认删除结果。')
      super.delete(id)
      this.db().prepare('DELETE FROM mem0_links WHERE scope = ? AND local_id = ?').run(scope, id)
    })
  }

  async rejectConfirmed(id: string): Promise<void> {
    await this.deleteConfirmed(id, true)
  }

  archiveManyConfirmed(ids: string[], reason: MemoryArchiveReason): Promise<string[]> {
    return this.serialize(async () => {
      this.refreshRemoteConfig()
      const remote = this.remote, scope = this.scope()
      const targets = [...new Set(ids)].slice(0, 500).map(id => this.getRequired(id)).filter(memory => memory.status === 'active')
      const archived: string[] = []
      try {
        for (const memory of targets) {
          const remoteId = await this.findRemoteId(memory, remote, scope)
          if (!remoteId) throw new Error('远端记忆不存在，请刷新后重试。')
          await remote.updateRemote(remoteId, memory.content, { chouyu_status: 'archived', chouyu_archived_reason: reason })
          if (scope !== this.scope()) throw new Error('连接配置已切换，请刷新原连接确认结果。')
          super.archive(memory.id, reason)
          archived.push(memory.id)
        }
      } catch (error) {
        throw new Error(`已归档 ${archived.length}/${targets.length} 条；其余未确认，请刷新后重试。${error instanceof Error ? error.message : ''}`)
      }
      return archived
    })
  }

  clearConfirmed(): Promise<void> {
    return this.serialize(async () => {
      this.refreshRemoteConfig()
      const remote = this.remote, scope = this.scope()
      let deleted = 0
      try {
        for (;;) {
          const records = await remote.list()
          if (scope !== this.scope()) throw new Error('连接配置已切换，请刷新原连接。')
          if (!records.length) break
          for (const record of records) {
            if (deleted >= 10_000) throw new Error('已达到本次 10000 条处理上限，请再次清空剩余记录。')
            await remote.deleteRemote(record.id)
            if (scope !== this.scope()) throw new Error('连接配置已切换，请刷新原连接。')
            const linked = this.db().prepare('SELECT local_id FROM mem0_links WHERE scope = ? AND remote_id = ?').all(scope, record.id) as { local_id: string }[]
            this.db().transaction(() => {
              linked.forEach(item => super.delete(item.local_id))
              this.db().prepare('DELETE FROM mem0_links WHERE scope = ? AND remote_id = ?').run(scope, record.id)
            })()
            deleted += 1
          }
        }
        super.clear()
        this.db().prepare('DELETE FROM mem0_links WHERE scope = ?').run(scope)
      } catch (error) {
        throw new Error(`清空未完成，本次已确认删除 ${deleted} 条远端记忆；其余记录及本地候选仍保留，请刷新后重试。${error instanceof Error ? error.message : ''}`)
      }
    })
  }

  reactivateConfirmed(id: string): Promise<MemoryRecord> {
    return this.serialize(async () => {
      this.refreshRemoteConfig()
      const remote = this.remote, scope = this.scope()
      const current = this.getRequired(id)
      if (current.status !== 'archived') throw new Error('归档记忆不存在或已经恢复。')
      const remoteId = await this.findRemoteId(current, remote, scope)
      if (!remoteId) throw new Error('远端记忆不存在，请刷新远端后重新添加。')
      await remote.updateRemote(remoteId, current.content, { chouyu_status: 'active', chouyu_archived_reason: null, chouyu_expires_at: null })
      if (scope !== this.scope()) throw new Error('远端已启用，但连接配置已切换，请刷新原连接确认。')
      return super.reactivate(id)
    })
  }

  resolveConflictConfirmed(id: string, action: MemoryConflictAction): Promise<MemoryRecord | null> {
    return this.serialize(async () => {
      this.refreshRemoteConfig()
      const remote = this.remote, scope = this.scope()
      const candidate = this.getRequired(id)
      const conflicts = this.listConflicts(id).filter(conflict => conflict.status === 'pending')
      if (candidate.status !== 'pending' || !conflicts.length) throw new Error('该候选没有待处理冲突。')
      if (action === 'reject') {
        const remoteId = await this.findRemoteId(candidate, remote, scope)
        if (remoteId) await remote.deleteRemote(remoteId)
        if (scope !== this.scope()) throw new Error('连接配置已切换，请刷新原连接。')
        super.reject(id)
        this.db().prepare('DELETE FROM mem0_links WHERE scope = ? AND local_id = ?').run(scope, id)
        return null
      }
      let archived = 0
      try {
        if (action === 'replace') {
          for (const existingId of new Set(conflicts.map(conflict => conflict.existingMemoryId))) {
            const existing = this.getRequired(existingId)
            if (existing.status !== 'active') continue
            const remoteId = await this.findRemoteId(existing, remote, scope)
            if (!remoteId) throw new Error('待替换记忆在远端不存在。')
            await remote.updateRemote(remoteId, existing.content, { chouyu_status: 'archived', chouyu_archived_reason: 'replace' })
            if (scope !== this.scope()) throw new Error('连接配置已切换，请刷新原连接。')
            this.db().transaction(() => {
              this.insertRevision(existing, 'replace')
              super.archive(existing.id, 'replace')
            })()
            archived += 1
          }
        }
        const result = await remote.push([candidate])
        if (result.failed) throw new Error('候选写入未完成。')
        const stored = (await remote.list()).filter(memory => memory.metadata.chouyu_id === id || memory.content === candidate.content)
        if (stored.length !== 1 || stored[0].content !== candidate.content) throw new Error('尚未确认候选内容。')
        await remote.updateRemote(stored[0].id, candidate.content, { chouyu_status: 'active' })
        if (scope !== this.scope()) throw new Error('连接配置已切换，请刷新原连接。')
        this.db().prepare('INSERT OR REPLACE INTO mem0_links(scope, local_id, remote_id) VALUES (?, ?, ?)').run(scope, id, stored[0].id)
        return super.resolveConflict(id, action)
      } catch (error) {
        throw new Error(`冲突处理未完成，本次已归档 ${archived} 条旧记忆，候选仍保留。请刷新后重试；已归档记忆也可重新启用。${error instanceof Error ? error.message : ''}`)
      }
    })
  }

  async createActiveConfirmed(candidate: MemoryCandidateInput): Promise<MemoryRecord> {
    this.refreshRemoteConfig()
    if (!candidate.content.trim() || candidate.content.length > 500) throw new Error('记忆正文不能为空或超过 500 字符。')
    const pending = super.createCandidate(candidate)
    const existing = pending || this.findByNormalizedKey(normalizeMemoryKey(candidate.content))
    if (!existing) throw new Error('无法创建记忆候选。')
    return existing.status === 'pending' ? this.approveConfirmed(existing.id) : existing
  }

  // A synchronous API cannot confirm network persistence. Fail before any
  // mutation if a future caller bypasses the asynchronous engine interface.
  private requiresConfirmation(): never { throw new Error('Mem0 操作必须等待远端确认，请使用异步记忆接口。') }
  override createActive(_candidate: MemoryCandidateInput): MemoryRecord { return this.requiresConfirmation() }
  override approve(_id: string): MemoryRecord { return this.requiresConfirmation() }
  override reject(_id: string): void { this.requiresConfirmation() }
  override update(_id: string, _patch: MemoryUpdate): MemoryRecord { return this.requiresConfirmation() }
  override delete(_id: string): void { this.requiresConfirmation() }
  override clear(): void { this.requiresConfirmation() }
  override archive(_id: string, _reason?: MemoryArchiveReason): void { this.requiresConfirmation() }
  override archiveMany(_ids: string[], _reason: MemoryArchiveReason): string[] { return this.requiresConfirmation() }
  override reactivate(_id: string): MemoryRecord { return this.requiresConfirmation() }
  override resolveConflict(_id: string, _action: MemoryConflictAction): MemoryRecord | null { return this.requiresConfirmation() }
  override restoreRevision(_id: string, _revisionId: string): MemoryRecord { return this.requiresConfirmation() }
}
