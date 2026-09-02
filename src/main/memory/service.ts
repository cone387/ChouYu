import { app } from 'electron'
import { randomUUID } from 'crypto'
import type { MemoryProvider } from './provider'
import type {
  EmbeddingRebuildResult,
  EmbeddingStatus,
  MemoryCandidateInput,
  MemoryConflictAction,
  MemoryCluster,
  MemoryImportDecision,
  MemoryImportItem,
  MemoryImportPreview,
  MemoryImportResult,
  MemoryInsights,
  MemoryMaintenanceResult,
  MemoryRecord,
  MemorySearchResult,
  MemorySyncPullPreview,
  MemorySyncPushResult,
  MemorySyncOutboxStatus,
  MemorySyncStatus,
  MemoryType
} from '../../shared/memory'
import { buildMemoryClusters, compressMemoryResults, containsSecret, detectMemoryRelation, extractPersonName, getPersonIdentityKey, inferMemoryQueryTypes, isLikelyPersonName, mergeHybridMemoryResults, normalizeMemoryKey } from '../../shared/memory'
import { getConfig, saveConfig } from '../database'
import { cosineSimilarity } from './embedding-client'
import { capabilityRegistry } from '../capabilities/registry'
import { Mem0MemorySyncAdapter } from './sync/mem0-adapter'

let provider: MemoryProvider | null = null
let maintenanceTimer: ReturnType<typeof setInterval> | null = null

export function initializeMemory(): void {
  if (provider) return
  const config = getConfig()
  try {
    provider = capabilityRegistry.createMemoryEngine(config.memoryEngineProvider, { userDataPath: app.getPath('userData'), config })
  } catch (error) {
    console.warn(`[Memory] Failed to load engine ${config.memoryEngineProvider}; falling back to chouyu-sqlite:`, error)
    provider = capabilityRegistry.createMemoryEngine('chouyu-sqlite', { userDataPath: app.getPath('userData'), config })
    saveConfig({ memoryEngineProvider: 'chouyu-sqlite' })
  }
  provider.initialize()
  runMemoryMaintenance()
  maintenanceTimer = setInterval(() => {
    try {
      runMemoryMaintenance()
    } catch (error) {
      console.warn('[Memory] Scheduled maintenance failed:', error)
    }
  }, 15 * 60_000)
}

export function getMemoryProvider(): MemoryProvider {
  if (!provider) throw new Error('Memory service is not initialized')
  return provider
}

export function getMemorySyncOutboxStatus(): MemorySyncOutboxStatus | null {
  const memoryProvider = getMemoryProvider()
  return memoryProvider.getSyncOutboxStatus?.() || null
}

export function closeMemory(): void {
  if (maintenanceTimer) clearInterval(maintenanceTimer)
  maintenanceTimer = null
  provider?.close()
  provider = null
}

export function proposeMemoryCandidate(candidate: MemoryCandidateInput): MemoryRecord | null {
  const memoryProvider = getMemoryProvider()
  const config = getConfig()
  const candidateWithLifecycle: MemoryCandidateInput = candidate.expiresAt === undefined && config.memoryDefaultTtlDays > 0
    ? { ...candidate, expiresAt: Date.now() + config.memoryDefaultTtlDays * 86_400_000 }
    : candidate
  const candidateMemory = memoryProvider.createCandidate(candidateWithLifecycle)
  if (!candidateMemory) return null
  const activeMemories = memoryProvider.list({ status: 'active', limit: 2000 })
  activeMemories.forEach((existing) => {
    const relation = detectMemoryRelation(candidateWithLifecycle, existing)
    if (relation) memoryProvider.createConflict(candidateMemory.id, existing.id, relation.kind, relation.reason)
  })
  const conflicts = memoryProvider.listConflicts(candidateMemory.id)
  return conflicts.length > 0 ? { ...candidateMemory, conflicts } : candidateMemory
}

export async function rememberRawMemory(text: string, source?: { sessionId?: string; messageId?: string }): Promise<MemoryRecord[]> {
  const active = getMemoryProvider() as MemoryProvider & { rememberRaw?: (value: string) => Promise<MemoryRecord[]> }
  if (!active.rememberRaw) return []
  return (active.rememberRaw as (value: string, source?: { sessionId?: string; messageId?: string }) => Promise<MemoryRecord[]>)(text, source)
}

export function createMemory(candidate: MemoryCandidateInput): MemoryRecord {
  const memoryProvider = getMemoryProvider()
  const proposed = proposeMemoryCandidate(candidate)
  if (!proposed) {
    const normalizedKey = normalizeMemoryKey(candidate.content)
    const existing = memoryProvider.list({ status: 'all', limit: 2000 }).find((memory) => memory.normalizedKey === normalizedKey && memory.status !== 'archived')
    return existing || memoryProvider.createActive(candidate)
  }
  // A direct, high-confidence name statement is the user's profile update.
  // Replace the previous identity automatically instead of leaving a hidden
  // pending conflict in the default automatic-write mode.
  if (candidate.type === 'person' && extractPersonName(candidate.content) && proposed.conflicts?.some((conflict) => conflict.status === 'pending')) {
    const replaced = resolveMemoryConflict(proposed.id, 'replace')
    if (replaced) return replaced
  }
  if (proposed.conflicts?.some((conflict) => conflict.status === 'pending')) return proposed
  const memory = memoryProvider.approve(proposed.id)
  void indexMemory(memory).catch((error) => console.warn('[Memory] Failed to index new memory:', error))
  runMemoryMaintenance()
  return memory
}

export function resolveMemoryConflict(candidateId: string, action: MemoryConflictAction): MemoryRecord | null {
  const memory = getMemoryProvider().resolveConflict(candidateId, action)
  if (memory) void indexMemory(memory).catch((error) => console.warn('[Memory] Failed to index resolved memory:', error))
  runMemoryMaintenance()
  return memory
}

export function restoreMemoryRevision(memoryId: string, revisionId: string): MemoryRecord {
  const memory = getMemoryProvider().restoreRevision(memoryId, revisionId)
  void indexMemory(memory).catch((error) => console.warn('[Memory] Failed to index restored memory:', error))
  return memory
}

export function reactivateMemory(memoryId: string): MemoryRecord {
  const memoryProvider = getMemoryProvider()
  if (memoryProvider.stats().active >= getConfig().memoryMaxItems) throw new Error('当前记忆容量已满，请先提高容量上限或归档其他记忆。')
  const memory = memoryProvider.reactivate(memoryId)
  void indexMemory(memory).catch((error) => console.warn('[Memory] Failed to index reactivated memory:', error))
  return memory
}

export function runMemoryMaintenance(): MemoryMaintenanceResult {
  const memoryProvider = getMemoryProvider()
  const invalidIdentityIds = memoryProvider.list({ status: 'active', type: 'person', limit: 2000 })
    .filter((memory) => {
      const match = memory.content.match(/^我的名字是\s*(.+)$/i)
      return Boolean(match && !isLikelyPersonName(match[1]))
    })
    .map((memory) => memory.id)
  const identityMemories = memoryProvider.list({ status: 'active', type: 'person', limit: 2000 })
  const duplicateIdentityIds: string[] = []
  const identityGroups = new Map<string, MemoryRecord[]>()
  identityMemories
    .filter((memory) => !invalidIdentityIds.includes(memory.id))
    .forEach((memory) => {
      const key = getPersonIdentityKey(memory.content)
      if (!key) return
      identityGroups.set(key, [...(identityGroups.get(key) || []), memory])
    })
  identityGroups.forEach((group) => {
    group.sort((left, right) => right.confidence - left.confidence || right.updatedAt - left.updatedAt)
    duplicateIdentityIds.push(...group.slice(1).map((memory) => memory.id))
  })
  const invalidArchivedIds = memoryProvider.archiveMany([...invalidIdentityIds, ...duplicateIdentityIds], 'cleanup')
  const expiredIds = memoryProvider.expireDue()
  const capacityIds = memoryProvider.enforceCapacity(getConfig().memoryMaxItems)
  return {
    expired: expiredIds.length,
    capacityArchived: capacityIds.length,
    archivedIds: [...invalidArchivedIds, ...expiredIds, ...capacityIds]
  }
}

export function getIdentityProfile(): MemoryRecord | null {
  runMemoryMaintenance()
  const people = getMemoryProvider().list({ status: 'active', type: 'person', limit: 2000 })
    .filter((memory) => Boolean(extractPersonName(memory.content)))
    .sort((left, right) => right.confidence - left.confidence || right.updatedAt - left.updatedAt)
  return people[0] || null
}

export function listMemoryClusters(): MemoryCluster[] {
  runMemoryMaintenance()
  const memoryProvider = getMemoryProvider()
  return buildMemoryClusters(
    memoryProvider.list({ status: 'active', limit: 2000 }),
    memoryProvider.listTopics(),
    memoryProvider.listClusterExcludedIds()
  )
}

export function createMemoryTopic(label: string, memoryIds: string[]): MemoryCluster {
  const topic = getMemoryProvider().createTopic(label, memoryIds)
  const cluster = listMemoryClusters().find((item) => item.id === topic.id)
  if (!cluster) throw new Error('创建人工主题失败。')
  return cluster
}

export function splitMemoryCluster(clusterId: string, memoryIds: string[], manual: boolean): string[] {
  return manual
    ? getMemoryProvider().splitTopic(clusterId)
    : getMemoryProvider().excludeFromClusters(memoryIds)
}

export function getMemoryInsights(): MemoryInsights {
  runMemoryMaintenance()
  const all = getMemoryProvider().list({ status: 'all', limit: 2000 })
  const clusters = listMemoryClusters()
  const types: MemoryType[] = ['fact', 'preference', 'person', 'project', 'workflow']
  const archiveReasons = ['expired', 'capacity', 'cleanup', 'manual', 'replace'] as const
  const now = new Date()
  const createdByWeek = Array.from({ length: 8 }, (_, reverseIndex) => {
    const index = 7 - reverseIndex
    const end = new Date(now)
    end.setHours(23, 59, 59, 999)
    end.setDate(end.getDate() - index * 7)
    const start = new Date(end)
    start.setDate(start.getDate() - 6)
    start.setHours(0, 0, 0, 0)
    return {
      label: `${start.getMonth() + 1}/${start.getDate()}`,
      count: all.filter((memory) => memory.createdAt >= start.getTime() && memory.createdAt <= end.getTime()).length
    }
  })
  return {
    byType: types.map((type) => ({ type, count: all.filter((memory) => memory.status === 'active' && memory.type === type).length })),
    createdByWeek,
    archiveReasons: archiveReasons.map((reason) => ({ reason, count: all.filter((memory) => memory.status === 'archived' && memory.archivedReason === reason).length })),
    helpful: all.reduce((total, memory) => total + memory.helpfulCount, 0),
    unhelpful: all.reduce((total, memory) => total + memory.unhelpfulCount, 0),
    clustered: clusters.reduce((total, cluster) => total + cluster.memoryIds.length, 0),
    clusters: clusters.length,
    savedCharacters: clusters.reduce((total, cluster) => total + cluster.savedCharacters, 0)
  }
}

function importCandidate(value: unknown): MemoryCandidateInput | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Record<string, unknown>
  if (!['fact', 'preference', 'person', 'project', 'workflow'].includes(String(input.type))) return null
  if (typeof input.content !== 'string' || !input.content.trim() || input.content.length > 500) return null
  return {
    type: input.type as MemoryType,
    content: input.content.trim(),
    importance: typeof input.importance === 'number' && Number.isFinite(input.importance) ? Math.min(1, Math.max(0, input.importance)) : 0.6,
    confidence: typeof input.confidence === 'number' && Number.isFinite(input.confidence) ? Math.min(1, Math.max(0, input.confidence)) : 1,
    sensitivity: input.sensitivity === 'sensitive' ? 'sensitive' : 'normal',
    expiresAt: typeof input.expiresAt === 'number' && Number.isFinite(input.expiresAt) && input.expiresAt > Date.now() ? input.expiresAt : undefined
  }
}

export function previewMemoryImport(value: unknown): Omit<MemoryImportPreview, 'canceled' | 'fileName'> {
  const source = Array.isArray(value) ? value : value && typeof value === 'object' && Array.isArray((value as { memories?: unknown }).memories)
    ? (value as { memories: unknown[] }).memories
    : []
  const active = getMemoryProvider().list({ status: 'active', limit: 2000 })
  const items: MemoryImportItem[] = []
  let invalid = 0
  let blockedSecrets = 0
  source.slice(0, 2000).forEach((raw) => {
    const candidate = importCandidate(raw)
    if (!candidate) {
      invalid += 1
      return
    }
    if (containsSecret(candidate.content)) {
      blockedSecrets += 1
      return
    }
    const duplicate = active.find((memory) => memory.normalizedKey === normalizeMemoryKey(candidate.content))
    if (duplicate) {
      items.push({ id: randomUUID(), candidate, status: 'duplicate', suggestedAction: 'skip', existingMemoryId: duplicate.id, existingContent: duplicate.content, reason: '与已有记忆内容相同' })
      return
    }
    const related = active.map((memory) => ({ memory, relation: detectMemoryRelation(candidate, memory) })).find((item) => item.relation)
    if (related?.relation) {
      items.push({ id: randomUUID(), candidate, status: 'conflict', suggestedAction: 'keep', existingMemoryId: related.memory.id, existingContent: related.memory.content, conflictKind: related.relation.kind, reason: related.relation.reason })
      return
    }
    items.push({ id: randomUUID(), candidate, status: 'new', suggestedAction: 'add' })
  })
  return { items, invalid, blockedSecrets }
}

export function importMemories(decisions: MemoryImportDecision[]): MemoryImportResult {
  const result: MemoryImportResult = { added: 0, kept: 0, replaced: 0, skipped: 0, failed: 0 }
  for (const decision of decisions.slice(0, 2000)) {
    const candidate = importCandidate(decision.item?.candidate)
    if (!candidate || containsSecret(candidate.content) || !['add', 'keep', 'replace', 'skip'].includes(decision.action)) {
      result.failed += 1
      continue
    }
    if (decision.action === 'skip') {
      result.skipped += 1
      continue
    }
    try {
      const proposed = proposeMemoryCandidate(candidate)
      if (!proposed) {
        result.skipped += 1
        continue
      }
      const hasConflict = proposed.conflicts?.some((conflict) => conflict.status === 'pending')
      if (hasConflict) {
        if (decision.action === 'add') throw new Error('导入期间检测到新的冲突。')
        resolveMemoryConflict(proposed.id, decision.action)
        if (decision.action === 'keep') result.kept += 1
        else result.replaced += 1
      } else {
        const memory = getMemoryProvider().approve(proposed.id)
        void indexMemory(memory).catch((error) => console.warn('[Memory] Failed to index imported memory:', error))
        result.added += 1
      }
    } catch {
      result.failed += 1
    }
  }
  runMemoryMaintenance()
  return result
}

export async function testMemorySync(): Promise<MemorySyncStatus> {
  try {
    const config = getConfig()
    const adapter = capabilityRegistry.createMemorySync(config.memorySyncProvider, config)
    const result = await adapter.test()
    return { ok: true, provider: adapter.provider, remoteCount: result.remoteCount, message: `连接成功，Mem0 中有 ${result.remoteCount} 条记忆。` }
  } catch (error) {
    return { ok: false, provider: 'mem0', message: error instanceof Error ? error.message : 'Mem0 连接失败。' }
  }
}

export async function testMemoryEngine(): Promise<MemorySyncStatus> {
  const config = getConfig()
  const mode = config.memoryEngineProvider === 'mem0-self-hosted-engine' ? 'self-hosted' : config.memoryEngineProvider === 'mem0-platform-engine' ? 'platform' : null
  if (!mode) return { ok: true, provider: 'mem0', message: '当前使用本地 ChouYu SQLite 主记忆引擎。' }
  try {
    const adapter = new Mem0MemorySyncAdapter({ baseUrl: config.memorySyncBaseUrl, apiKey: config.memorySyncApiKey, userId: config.memorySyncUserId, mode })
    const result = await adapter.test()
    return { ok: true, provider: 'mem0', remoteCount: result.remoteCount, message: `Mem0 主记忆引擎连接成功，已有 ${result.remoteCount} 条记忆。` }
  } catch (error) {
    return { ok: false, provider: 'mem0', message: error instanceof Error ? error.message : 'Mem0 主记忆引擎连接失败。' }
  }
}

export async function previewMemorySyncPull(): Promise<MemorySyncPullPreview> {
  const config = getConfig()
  const adapter = capabilityRegistry.createMemorySync(config.memorySyncProvider, config)
  const remote = await adapter.list()
  const input = remote.map((memory) => {
    const metadata = memory.metadata
    const type = ['fact', 'preference', 'person', 'project', 'workflow'].includes(String(metadata.chouyu_type))
      ? metadata.chouyu_type
      : ['fact', 'preference', 'person', 'project', 'workflow'].includes(String(metadata.type)) ? metadata.type : 'fact'
    return {
      type,
      content: memory.content,
      importance: typeof metadata.chouyu_importance === 'number' ? metadata.chouyu_importance : 0.6,
      confidence: 0.8,
      sensitivity: 'normal',
      expiresAt: typeof metadata.chouyu_expires_at === 'number' ? metadata.chouyu_expires_at : undefined
    }
  })
  return { canceled: false, fileName: 'Mem0', provider: adapter.provider, remoteCount: remote.length, ...previewMemoryImport(input) }
}

export async function pushMemoriesToSync(): Promise<MemorySyncPushResult> {
  runMemoryMaintenance()
  const config = getConfig()
  const adapter = capabilityRegistry.createMemorySync(config.memorySyncProvider, config)
  const active = getMemoryProvider().list({ status: 'active', limit: 2000 })
  const result = await adapter.push(active)
  return { provider: adapter.provider, ...result }
}

function embeddingClient(): { client: ReturnType<typeof capabilityRegistry.createEmbedding>; model: string } {
  const config = getConfig()
  const model = config.embeddingModel.trim()
  return { client: capabilityRegistry.createEmbedding(config.embeddingProvider, config), model }
}

export async function testEmbedding(): Promise<EmbeddingStatus> {
  try {
    const { client, model } = embeddingClient()
    const vector = (await client.embed(['ChouYu embedding connection test']))[0]
    return { ok: true, model, dimensions: vector.length, message: `连接成功，向量维度 ${vector.length}。` }
  } catch (error) {
    return { ok: false, model: getConfig().embeddingModel, message: error instanceof Error ? error.message : 'Embedding 连接失败。' }
  }
}

export async function indexMemory(memory: MemoryRecord): Promise<void> {
  const config = getConfig()
  if (!config.embeddingEnabled || config.embeddingProvider === 'none' || memory.status !== 'active') return
  const { client, model } = embeddingClient()
  const vector = (await client.embed([memory.content]))[0]
  getMemoryProvider().upsertEmbedding(memory.id, model, vector)
}

export async function rebuildEmbeddings(): Promise<EmbeddingRebuildResult> {
  const { client, model } = embeddingClient()
  const memories = getMemoryProvider().list({ status: 'active', limit: 2000 })
  getMemoryProvider().clearEmbeddings()
  let indexed = 0
  let failed = 0
  for (let start = 0; start < memories.length; start += 32) {
    const batch = memories.slice(start, start + 32)
    try {
      const vectors = await client.embed(batch.map((memory) => memory.content))
      vectors.forEach((vector, index) => getMemoryProvider().upsertEmbedding(batch[index].id, model, vector))
      indexed += batch.length
    } catch {
      failed += batch.length
    }
  }
  return { indexed, failed, model }
}

export async function searchMemories(query: string, limit = 6): Promise<MemorySearchResult[]> {
  const remoteProvider = getMemoryProvider() as MemoryProvider & { refreshRemote?: () => Promise<void> }
  await remoteProvider.refreshRemote?.()
  runMemoryMaintenance()
  const provider = remoteProvider
  const targeted = inferMemoryQueryTypes(query)
    .flatMap((type) => provider.list({ status: 'active', type, limit: Math.max(limit, 6) }))
    .sort((left, right) => {
      const leftName = left.type === 'person' && /名字|name/i.test(left.content) ? 1 : 0
      const rightName = right.type === 'person' && /名字|name/i.test(right.content) ? 1 : 0
      return rightName - leftName || right.updatedAt - left.updatedAt
    })
    .map((memory, index) => ({ ...memory, score: Math.max(0.9, 1 - index * 0.01) }))
  const targetedIds = new Set(targeted.map((memory) => memory.id))
  const lexical = [
    ...targeted,
    ...provider.search(query, Math.max(limit * 3, 12)).filter((memory) => !targetedIds.has(memory.id))
  ]
  const config = getConfig()
  const finalize = (results: MemorySearchResult[]) => config.memoryCompressionEnabled
    ? compressMemoryResults(results, limit, listMemoryClusters())
    : results.slice(0, limit)
  if (!config.embeddingEnabled || config.embeddingProvider === 'none') return finalize(lexical)
  try {
    const { client, model } = embeddingClient()
    const queryVector = (await client.embed([query]))[0]
    const semantic = getMemoryProvider().getEmbeddings(model)
      .map((item) => ({ ...item.memory, semanticScore: Math.max(0, cosineSimilarity(queryVector, item.vector)) }))
      .filter((item) => item.semanticScore >= 0.15)
      .sort((a, b) => b.semanticScore - a.semanticScore)
      .slice(0, Math.max(limit * 3, 12))

    return finalize(mergeHybridMemoryResults(lexical, semantic, Math.max(limit * 3, 12)))
  } catch (error) {
    console.warn('[Memory] Embedding search failed, falling back to lexical retrieval:', error)
    return finalize(lexical)
  }
}
