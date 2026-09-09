import type { JournalEvidence } from '../../shared/journal'
import { cosineSimilarity } from '../memory/embedding-client'

export interface JournalSemanticChunk { sourceId: string; text: string }

/** Chunk before embedding; the shared client's input limit must never silently cut OCR. */
export function journalSemanticChunks(sources: JournalEvidence[]): JournalSemanticChunk[] {
  const chunks: JournalSemanticChunk[] = []
  for (const source of sources) {
    const text = `${source.app}\n${source.title}\n${source.text}`.trim()
    if (!text) continue
    for (let start = 0; start < text.length; start += 3600) {
      // Keep a little overlap for concepts spanning a chunk boundary.
      if (start && /[\uDC00-\uDFFF]/.test(text[start]) && /[\uD800-\uDBFF]/.test(text[start - 1])) start--
      let end = Math.min(text.length, start + 4000)
      if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) end--
      chunks.push({ sourceId: source.id, text: text.slice(start, end) })
      if (end >= text.length) break
    }
  }
  return chunks
}

export function rankJournalSemanticSources(sources: JournalEvidence[], chunks: JournalSemanticChunk[], vectors: number[][], queryVector: number[], limit = 20): Array<{ source: JournalEvidence; score: number }> {
  if (chunks.length !== vectors.length || !queryVector.length || vectors.some(vector => vector.length !== queryVector.length)) throw new Error('日志语义向量数量或维度不匹配。')
  const scores = new Map<string, number>()
  chunks.forEach((chunk, index) => {
    const score = cosineSimilarity(queryVector, vectors[index])
    scores.set(chunk.sourceId, Math.max(scores.get(chunk.sourceId) ?? -1, score))
  })
  return sources.filter(source => scores.has(source.id)).map(source => ({ source, score: scores.get(source.id)! }))
    .sort((a, b) => b.score - a.score || b.source.at - a.source.at || a.source.id.localeCompare(b.source.id))
    .slice(0, Math.max(0, Math.min(100, limit)))
}
