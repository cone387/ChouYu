import { app } from 'electron'
import path from 'path'
import { SQLiteMemoryProvider } from './sqlite-provider'
import type { MemoryProvider } from './provider'
import type { EmbeddingRebuildResult, EmbeddingStatus, MemoryRecord, MemorySearchResult } from '../../shared/memory'
import { mergeHybridMemoryResults } from '../../shared/memory'
import { getConfig } from '../database'
import { OpenAIEmbeddingClient, cosineSimilarity } from './embedding-client'

let provider: MemoryProvider | null = null

export function initializeMemory(): void {
  if (provider) return
  provider = new SQLiteMemoryProvider(path.join(app.getPath('userData'), 'chouyu-memory.db'))
  provider.initialize()
}

export function getMemoryProvider(): MemoryProvider {
  if (!provider) throw new Error('Memory service is not initialized')
  return provider
}

export function closeMemory(): void {
  provider?.close()
  provider = null
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
