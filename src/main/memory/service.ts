import { app } from 'electron'
import path from 'path'
import { SQLiteMemoryProvider } from './sqlite-provider'
import type { MemoryProvider } from './provider'
import type {
  EmbeddingRebuildResult,
  EmbeddingStatus,
  MemoryCandidateInput,
  MemoryConflictAction,
  MemoryMaintenanceResult,
  MemoryRecord,
  MemorySearchResult
} from '../../shared/memory'
import { detectMemoryRelation, mergeHybridMemoryResults, normalizeMemoryKey } from '../../shared/memory'
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
  if (!config.embeddingEnabled) return lexical.slice(0, limit)
  try {
    const { client, model } = embeddingClient()
    const queryVector = (await client.embed([query]))[0]
    const semantic = getMemoryProvider().getEmbeddings(model)
      .map((item) => ({ ...item.memory, semanticScore: Math.max(0, cosineSimilarity(queryVector, item.vector)) }))
      .filter((item) => item.semanticScore >= 0.15)
      .sort((a, b) => b.semanticScore - a.semanticScore)
      .slice(0, Math.max(limit * 3, 12))

    return mergeHybridMemoryResults(lexical, semantic, limit)
  } catch (error) {
    console.warn('[Memory] Embedding search failed, falling back to lexical retrieval:', error)
    return lexical.slice(0, limit)
  }
}
