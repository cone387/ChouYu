import { describe, expect, it, vi } from 'vitest'
vi.mock('../ai', () => ({ streamAIChat: vi.fn() }))
import { parseJournalSummary } from './summary'

const sources = [{ id: 'activity:1', at: 1, app: 'test', title: 'test', text: 'test' }]
describe('journal summary provenance', () => {
  it('accepts only known source IDs and deduplicates references', () => {
    expect(parseJournalSummary('```json\n{"items":[{"text":"查看文档","sourceIds":["activity:1","activity:1"]}]}\n```', sources)).toEqual([{ text: '查看文档', sourceIds: ['activity:1'] }])
  })
  it('rejects invented evidence and unsupported statements without sources', () => {
    for (const sourceIds of [[], ['activity:999'], ['capture:fake']]) expect(() => parseJournalSummary(JSON.stringify({ items: [{ text: '完成开发', sourceIds }] }), sources)).toThrow()
  })
  it('rejects malformed or excessive output', () => {
    for (const text of ['hello', '{"items":[]}', JSON.stringify({ items: [{ text: 'x'.repeat(1600), sourceIds: ['activity:1'] }] })]) expect(() => parseJournalSummary(text, sources)).toThrow()
  })
})
