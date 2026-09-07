import { describe, expect, it, vi } from 'vitest'
vi.mock('../ai', () => ({ streamAIChat: vi.fn() }))
import { answerJournalQuestion, journalModelEvidence, parseJournalSummary, selectJournalEvidence } from './summary'
import { streamAIChat } from '../ai'
import type { AppConfig } from '../../shared/config'

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
  it('preserves actionable fields but downgrades title-only outcomes', () => {
    const result = parseJournalSummary(JSON.stringify({ items: [{ title: '接口排查', kind: 'progress', text: '查看接口文档', nextStep: '回到接口文档确认响应', sourceIds: ['activity:1'] }] }), sources)
    expect(result[0]).toMatchObject({ title: '接口排查', kind: 'activity', nextStep: '回到接口文档确认响应' })
  })
  it('keeps chronology and both ends when the input budget is exceeded', () => {
    const input = Array.from({ length: 100 }, (_, at) => ({ id: `activity:${at}`, at, app: 'editor', title: `file ${at}`, text: 'x'.repeat(300) }))
    const selected = selectJournalEvidence(input, 2200)
    expect(selected[0].at).toBe(0); expect(selected.at(-1)?.at).toBe(99)
    expect(JSON.stringify(selected).length).toBeLessThanOrEqual(2200)
    expect(selected.some(item => item.at > 30 && item.at < 70)).toBe(true)
  })
  it('compacts repeated titles without losing occurrence IDs and timestamps', () => {
    const input = [sources[0], { ...sources[0], id: 'activity:2', at: 2, endedAt: 5 }]
    expect(journalModelEvidence(input)).toEqual([{ app: 'test', title: 'test', text: 'test', occurrences: [{ id: 'activity:1', at: 1 }, { id: 'activity:2', at: 2, endedAt: 5 }] }])
  })
  it('does not expose an uncited model assertion as a factual answer', async () => {
    vi.mocked(streamAIChat).mockImplementationOnce(async (_messages, _system, _config, onChunk) => { onChunk('{"text":"已经全部完成","sourceIds":[]}', true) })
    const result = await answerJournalQuestion({ from: 0, to: 10, sources, truncated: false }, '完成了吗', { model: 'test' } as AppConfig, new AbortController().signal)
    expect(result.text).toContain('没有足够依据')
    expect(result.text).not.toContain('全部完成')
  })
  it('rejects invented answer sources', async () => {
    vi.mocked(streamAIChat).mockImplementationOnce(async (_messages, _system, _config, onChunk) => { onChunk('{"text":"有依据","sourceIds":["activity:999"]}', true) })
    await expect(answerJournalQuestion({ from: 0, to: 10, sources, truncated: false }, '在哪', { model: 'test' } as AppConfig, new AbortController().signal)).rejects.toThrow('有效来源')
  })
})
