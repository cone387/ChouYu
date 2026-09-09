import { describe, expect, it } from 'vitest'
import { journalSemanticChunks, rankJournalSemanticSources } from './semantic'

const source = { id: 'capture:a', at: 1, app: 'editor', title: 'report', text: 'x'.repeat(30000) + '末尾关键证据' }
describe('journal semantic provenance', () => {
  it('retains the end of long OCR while respecting embedding input limits', () => {
    const chunks = journalSemanticChunks([source])
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every(chunk => chunk.text.length <= 4000 && chunk.sourceId === source.id)).toBe(true)
    expect(chunks.at(-1)?.text).toContain('末尾关键证据')
    expect(chunks[0].text.slice(-400)).toBe(chunks[1].text.slice(0, 400))
  })
  it('returns an original source once even if several chunks match', () => {
    const sources = [{ ...source, text: 'a'.repeat(5000) }, { ...source, id: 'capture:b', text: 'other' }]
    const chunks = journalSemanticChunks(sources)
    const results = rankJournalSemanticSources(sources, chunks, [[0, 1], [1, 0], [0.5, 0.5]], [1, 0])
    expect(results.map(result => result.source.id)).toEqual(['capture:a', 'capture:b'])
    expect(results[0].source).toBe(sources[0])
    expect(results[0].score).toBeCloseTo(1)
  })
  it('does not split a surrogate pair at chunk boundaries', () => {
    const chunks = journalSemanticChunks([{ ...source, app: '', title: '', text: 'x'.repeat(3999) + '😀'.repeat(5000) }])
    expect(chunks.every(chunk => Buffer.from(chunk.text).toString('utf8') === chunk.text && chunk.text.length <= 4000)).toBe(true)
  })
  it('rejects partial or mismatched vector batches instead of assigning wrong evidence', () => {
    const chunks = journalSemanticChunks([{ ...source, text: 'short' }])
    expect(() => rankJournalSemanticSources([source], chunks, [], [1, 0])).toThrow()
    expect(() => rankJournalSemanticSources([source], chunks, [[1]], [1, 0])).toThrow()
  })
})
