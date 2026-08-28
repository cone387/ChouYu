import { app } from 'electron'
import { randomUUID } from 'crypto'
import path from 'path'
import { SQLiteMemoryProvider } from './sqlite-provider'
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
  MemoryType
} from '../../shared/memory'
import { buildMemoryClusters, compressMemoryResults, containsSecret, detectMemoryRelation, mergeHybridMemoryResults, normalizeMemoryKey } from '../../shared/memory'
import { getConfig } from '../database'
import { OpenAIEmbeddingClient, cosineSimilarity } from './embedding-client'

let provider: MemoryProvider | null = null
let maintenanceTimer: ReturnType<typeof setInterval> | null = null

export function initializeMemory(): void {
  if (provider) return
  provider = new SQLiteMemoryProvider(path.join(app.getPath('userData'), 'chouyu-memory.db'))
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

export function createMemory(candidate: MemoryCandidateInput): MemoryRecord {
  const memoryProvider = getMemoryProvider()
  const proposed = proposeMemoryCandidate(candidate)
  if (!proposed) {
    const normalizedKey = normalizeMemoryKey(candidate.content)
    const existing = memoryProvider.list({ status: 'all', limit: 2000 }).find((memory) => memory.normalizedKey === normalizedKey && memory.status !== 'archived')
    return existing || memoryProvider.createActive(candidate)
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
  const expiredIds = memoryProvider.expireDue()
  const capacityIds = memoryProvider.enforceCapacity(getConfig().memoryMaxItems)
  return {
    expired: expiredIds.length,
    capacityArchived: capacityIds.length,
    archivedIds: [...expiredIds, ...capacityIds]
  }
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

function embeddingClient(): { client: OpenAIEmbeddingClient; model: string } {
  const config = getConfig()
  const baseUrl = config.embeddingBaseUrl || config.baseUrl
  const apiKey = config.embeddingApiKey || config.apiKey
  const model = config.embeddingModel.trim()
  return { client: new OpenAIEmbeddingClient({ baseUrl, apiKey, model }), model }
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
  if (!config.embeddingEnabled || memory.status !== 'active') return
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
  runMemoryMaintenance()
  const lexical = getMemoryProvider().search(query, Math.max(limit * 3, 12))
  const config = getConfig()
  const finalize = (results: MemorySearchResult[]) => config.memoryCompressionEnabled
    ? compressMemoryResults(results, limit, listMemoryClusters())
    : results.slice(0, limit)
  if (!config.embeddingEnabled) return finalize(lexical)
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
