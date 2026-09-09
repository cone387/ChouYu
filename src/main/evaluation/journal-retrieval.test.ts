import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { evaluateJournalRetrieval, prepareRetrievalEvaluation, retrievalMetrics, type RetrievalCorpus } from './journal-retrieval'

const corpus: RetrievalCorpus = { version: 1, sources: [
  { id: 'a', at: 1, app: 'editor', title: 'first', text: 'source A' },
  { id: 'b', at: 2, app: 'browser', title: 'second', text: 'source B' }
], cases: [{ id: 'found', from: 0, to: 3, query: 'query', relevant: ['b'] }, { id: 'absent', from: 0, to: 3, query: 'unknown', relevant: [] }] }

describe('journal retrieval evaluation', () => {
  it('measures full relevant-set recall and reciprocal rank separately', () => {
    expect(retrievalMetrics(['c', 'a', 'b'], ['a', 'b'])).toEqual({ recallAt1: 0, recallAt3: 1, reciprocalRank: .5 })
    expect(retrievalMetrics(['a'], ['a', 'b'])).toEqual({ recallAt1: .5, recallAt3: .5, reciprocalRank: 1 })
    expect(retrievalMetrics(['a'], [])).toEqual({ recallAt1: null, recallAt3: null, reciprocalRank: null })
  })
  it('runs production chunking and ranking without claiming successful no-answer detection', async () => {
    const report = await evaluateJournalRetrieval(corpus, async texts => texts.map(text => text.includes('source B') || text === 'query' ? [1, 0] : [0, 1]))
    expect(report.recallAt1).toBe(1)
    expect(report.cases[0].top[0].id).toBe('b')
    expect(report.noAnswer).toMatchObject({ count: 1, rejectionSupported: false })
    expect(report.cases[1].recallAt1).toBeNull()
  })
  it('rejects invalid labels and excludes date/app distractors before ranking', () => {
    const filtered = { ...corpus, cases: [{ ...corpus.cases[0], from: 2, app: 'BROWSER' }] }
    expect(prepareRetrievalEvaluation(filtered).cases[0].sources.map(source => source.id)).toEqual(['b'])
    expect(() => prepareRetrievalEvaluation({ ...filtered, cases: [{ ...filtered.cases[0], relevant: ['a'] }] })).toThrow('outside')
    expect(() => prepareRetrievalEvaluation({ ...corpus, sources: [corpus.sources[0], corpus.sources[0]] })).toThrow('Duplicate')
  })
  it('validates the checked-in corpus including long OCR, title-only and no-answer cases', () => {
    const data = JSON.parse(readFileSync('tests/fixtures/journal-retrieval.json', 'utf8')) as RetrievalCorpus
    const preview = prepareRetrievalEvaluation(data)
    expect(preview.cases).toHaveLength(12)
    expect(preview.cases.filter(item => !item.relevant.length)).toHaveLength(4)
    expect(preview.cases.find(item => item.id === 'long-ocr-tail')!.chunks.filter(chunk => chunk.sourceId === 'capture:tail').length).toBeGreaterThan(1)
    expect(preview.cases.find(item => item.id === 'title-only')!.sources.find(source => source.id === 'capture:title')!.text).toBe('')
  })
  it('rejects incomplete, nonfinite or inconsistent model vectors', async () => {
    await expect(evaluateJournalRetrieval(corpus, async () => [])).rejects.toThrow('Invalid')
    await expect(evaluateJournalRetrieval(corpus, async texts => texts.map(() => [NaN]))).rejects.toThrow('Invalid')
    await expect(evaluateJournalRetrieval(corpus, async texts => texts.map((_, index) => index ? [1] : [1, 1]))).rejects.toThrow('维度')
  })
})
