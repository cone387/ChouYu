import { joinApiUrl } from '../../shared/ai'

export interface EmbeddingClientConfig {
  baseUrl: string
  apiKey: string
  model: string
}

function endpointCandidates(baseUrl: string): string[] {
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  const candidates = [joinApiUrl(normalized, 'embeddings')]
  if (!/\/v1$/i.test(normalized)) candidates.push(joinApiUrl(`${normalized}/v1`, 'embeddings'))
  return candidates
}

function validateVectors(value: unknown, expectedCount: number): number[][] {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  if (!Array.isArray(record.data)) throw new Error('Embedding 接口响应缺少 data 数组。')
  const rows = record.data as Array<Record<string, unknown>>
  const vectors = [...rows]
    .sort((a, b) => Number(a.index || 0) - Number(b.index || 0))
    .map((row) => {
      if (!Array.isArray(row.embedding)) throw new Error('Embedding 响应缺少向量。')
      const vector = row.embedding.map(Number)
      if (vector.length === 0 || vector.length > 8192 || vector.some((item) => !Number.isFinite(item))) {
        throw new Error('Embedding 向量格式无效。')
      }
      return vector
    })
  if (vectors.length !== expectedCount) throw new Error(`Embedding 数量不匹配：期望 ${expectedCount}，收到 ${vectors.length}。`)
  const dimensions = vectors[0]?.length
  if (!dimensions || vectors.some((vector) => vector.length !== dimensions)) throw new Error('Embedding 向量维度不一致。')
  return vectors
}

export class OpenAIEmbeddingClient {
  constructor(private readonly config: EmbeddingClientConfig, private readonly request: typeof fetch = fetch) {}

  async embed(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    if (!this.config.baseUrl.trim()) throw new Error('尚未配置 Embedding Base URL。')
    if (!this.config.apiKey.trim()) throw new Error('尚未配置 Embedding API Key。')
    if (!this.config.model.trim()) throw new Error('尚未配置 Embedding 模型。')
    if (texts.length === 0 || texts.length > 64) throw new Error('Embedding 单批数量必须在 1 到 64 之间。')
    const input = texts.map((text) => text.trim().slice(0, 8000))
    let lastError = 'Embedding 请求失败。'
    for (const endpoint of endpointCandidates(this.config.baseUrl)) {
      try {
        const response = await this.request(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.apiKey}` },
          body: JSON.stringify({ model: this.config.model, input }),
          signal: signal || AbortSignal.timeout(30_000)
        })
        if (!response.ok) {
          lastError = `Embedding API error ${response.status}: ${(await response.text()).slice(0, 1000)}`
          if ([404, 405].includes(response.status)) continue
          throw new Error(lastError)
        }
        return validateVectors(await response.json(), input.length)
      } catch (error) {
        lastError = error instanceof Error ? error.message : lastError
      }
    }
    throw new Error(lastError)
  }
}

export function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  if (left.length === 0 || left.length !== right.length) return 0
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < left.length; index++) {
    dot += left[index] * right[index]
    leftNorm += left[index] * left[index]
    rightNorm += right[index] * right[index]
  }
  if (!leftNorm || !rightNorm) return 0
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm))
}
