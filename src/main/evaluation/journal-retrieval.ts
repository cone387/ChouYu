import { createHash } from 'crypto'
import type { JournalEvidence } from '../../shared/journal'
import { journalSemanticChunks, rankJournalSemanticSources } from '../journal/semantic'

export interface RetrievalCase { id: string; query: string; from: number; to: number; app?: string; relevant: string[] }
export interface RetrievalCorpus { version: number; sources: JournalEvidence[]; cases: RetrievalCase[] }

export function prepareRetrievalEvaluation(corpus: RetrievalCorpus) {
  if (!Array.isArray(corpus.sources) || !Array.isArray(corpus.cases) || !corpus.sources.length || !corpus.cases.length) throw new Error('Empty retrieval corpus')
  const ids = new Set(corpus.sources.map(source => source.id))
  if (ids.size !== corpus.sources.length) throw new Error('Duplicate source IDs')
  const caseIds = new Set<string>()
  const cases = corpus.cases.map(item => {
    if (!item.id || caseIds.has(item.id) || !item.query.trim() || item.query.length > 200 || !Number.isFinite(item.from) || !Number.isFinite(item.to) || item.from >= item.to) throw new Error('Invalid retrieval case')
    caseIds.add(item.id)
    const sources = corpus.sources.filter(source => source.at >= item.from && source.at < item.to && (!item.app || source.app.toLowerCase().includes(item.app.toLowerCase())))
    if (new Set(item.relevant).size !== item.relevant.length || item.relevant.some(id => !sources.some(source => source.id === id))) throw new Error('Relevant source outside selected range')
    if (!sources.length) throw new Error('Evaluation requires distractors even for no-answer cases')
    return { ...item, sources, chunks: journalSemanticChunks(sources) }
  })
  const texts = [...new Set(cases.flatMap(item => [item.query, ...item.chunks.map(chunk => chunk.text)]))]
  return { cases, texts, corpusHash: createHash('sha256').update(JSON.stringify(corpus)).digest('hex') }
}

export function retrievalMetrics(ranked: string[], relevant: string[]) {
  if (!relevant.length) return { recallAt1: null, recallAt3: null, reciprocalRank: null }
  const expected = new Set(relevant)
  const rank = ranked.findIndex(id => expected.has(id))
  return { recallAt1: ranked.slice(0, 1).filter(id => expected.has(id)).length / expected.size,
    recallAt3: ranked.slice(0, 3).filter(id => expected.has(id)).length / expected.size,
    reciprocalRank: rank < 0 ? 0 : 1 / (rank + 1) }
}

export async function evaluateJournalRetrieval(corpus: RetrievalCorpus, embed: (texts: string[]) => Promise<number[][]>) {
  const prepared = prepareRetrievalEvaluation(corpus)
  const vectors: number[][] = []
  for (let offset = 0; offset < prepared.texts.length; offset += 32) {
    const batch = prepared.texts.slice(offset, offset + 32)
    const result = await embed(batch)
    if (result.length !== batch.length || result.some(vector => !vector.length || vector.some(value => !Number.isFinite(value)) || !vector.some(value => value !== 0))) throw new Error('Invalid evaluation vectors')
    vectors.push(...result)
  }
  const lookup = new Map(prepared.texts.map((text, index) => [text, vectors[index]]))
  const cases = prepared.cases.map(item => {
    const ranked = rankJournalSemanticSources(item.sources, item.chunks, item.chunks.map(chunk => lookup.get(chunk.text)!), lookup.get(item.query)!, 20)
    return { id: item.id, relevant: item.relevant, candidates: item.sources.length,
      top: ranked.map(value => ({ id: value.source.id, score: value.score })),
      ...retrievalMetrics(ranked.map(value => value.source.id), item.relevant) }
  })
  const answerable = cases.filter(item => item.relevant.length)
  const mean = (key: 'recallAt1' | 'recallAt3' | 'reciprocalRank') => answerable.length ? answerable.reduce((sum, item) => sum + item[key]!, 0) / answerable.length : null
  return { corpusHash: prepared.corpusHash, cases, answerable: answerable.length,
    recallAt1: mean('recallAt1'), recallAt3: mean('recallAt3'), meanReciprocalRank: mean('reciprocalRank'),
    noAnswer: { count: cases.length - answerable.length, rejectionSupported: false,
      note: 'No calibrated rejection threshold. Scores for unanswerable cases are diagnostics, not successful abstentions.' } }
}
