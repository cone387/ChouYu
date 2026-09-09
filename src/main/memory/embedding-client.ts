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
  if (rows.length !== expectedCount) throw new Error(`Embedding 数量不匹配：期望 ${expectedCount}，收到 ${rows.length}。`)
  const indices = new Set<number>()
  for (const row of rows) {
    if (!row || !Number.isSafeInteger(row.index) || Number(row.index) < 0 || Number(row.index) >= expectedCount || indices.has(Number(row.index))) throw new Error('Embedding 响应索引缺失、重复或越界。')
    indices.add(Number(row.index))
  }
  const vectors = [...rows].sort((a, b) => Number(a.index) - Number(b.index)).map(row => {
    if (!Array.isArray(row.embedding) || row.embedding.length === 0 || row.embedding.length > 8192 || row.embedding.some(value => typeof value !== 'number' || !Number.isFinite(value)) || !row.embedding.some(value => value !== 0)) throw new Error('Embedding 向量格式无效。')
    return row.embedding as number[]
  })
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
    // A caller-provided cancellation signal must not disable the request deadline.
    const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000)
    requestSignal.throwIfAborted()
    for (const endpoint of endpointCandidates(this.config.baseUrl)) {
      requestSignal.throwIfAborted()
      const response = await this.request(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.apiKey}` },
        body: JSON.stringify({ model: this.config.model, input }), signal: requestSignal
      })
      requestSignal.throwIfAborted()
      if ([404, 405].includes(response.status)) { await response.body?.cancel(); continue }
      if (!response.ok) throw new Error(`Embedding API error ${response.status}: ${(await response.text()).slice(0, 1000)}`)
      const data = await response.json()
      requestSignal.throwIfAborted()
      return validateVectors(data, input.length)
    }
    throw new Error('Embedding 接口不存在或不支持 POST，请检查 Base URL。')
  }
}

export function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  if (left.length === 0 || left.length !== right.length) return 0
  let leftScale = 0, rightScale = 0
  for (let index = 0; index < left.length; index++) {
    if (!Number.isFinite(left[index]) || !Number.isFinite(right[index])) return 0
    leftScale = Math.max(leftScale, Math.abs(left[index]))
    rightScale = Math.max(rightScale, Math.abs(right[index]))
  }
  if (!leftScale || !rightScale) return 0
  let dot = 0, leftNorm = 0, rightNorm = 0
  for (let index = 0; index < left.length; index++) {
    const l = left[index] / leftScale, r = right[index] / rightScale
    dot += l * r; leftNorm += l * l; rightNorm += r * r
  }
  return Math.max(-1, Math.min(1, dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm))))
}
