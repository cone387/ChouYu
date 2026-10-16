import { afterEach, describe, expect, it } from 'vitest'
import { TaskCenter } from '../task-center/store'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import { deliveryText, textHash } from '../../shared/contact-content'
import { citationContext, validateCitation } from './citations'

const stores: TaskCenter[] = []
afterEach(() => stores.splice(0).forEach(s => s.close()))
function fixture() {
  const store = new TaskCenter(':memory:'); stores.push(store)
  store.save('alice', { ...DEFAULT_AGENT_SETTINGS, goal: '写故事' })
  const topic = store.overview('alice').topics[0], runId = store.createRun('alice', '')
  const body = '重复😀\n\n重复😀', text = deliveryText(body)
  store.finish(runId, { runId, title: '故事', body, nextStep: '继续', evidence: [], createdAt: 1 }, [], { status: 'researching', judgement: '有正文', reason: '保存', nextStep: '继续', openQuestions: '' },
    { completionCriteria: '完成', stages: [{ id: 's', title: '故事', status: 'active' }], summary: '已保存', section: { id: 's', title: '海风', body } })
  const citation = { ref: { characterId: 'alice', topicId: topic.id, version: 1, sectionId: 's' }, anchor: { start: 6, end: 10, quote: text.slice(6, 10), textHash: textHash(text) } }
  return { store, citation }
}
describe('validated formal citations', () => {
  it('preserves the exact duplicate interval and rejects forged text, hash, owner and offsets', () => {
    const { store, citation } = fixture()
    expect(validateCitation('alice', citation, store.portfolio)).toEqual(citation)
    for (const anchor of [{ ...citation.anchor, quote: '假的' }, { ...citation.anchor, textHash: 'fake' }, { ...citation.anchor, start: -1 }, { ...citation.anchor, end: 999 }, { ...citation.anchor, start: 5 }]) {
      expect(() => validateCitation('alice', { ...citation, anchor }, store.portfolio)).toThrow()
    }
    expect(() => validateCitation('bob', citation, store.portfolio)).toThrow()
    expect(() => validateCitation('alice', { ...citation, ref: { ...citation.ref, version: 2 } }, store.portfolio)).toThrow()
    store.db.prepare('DELETE FROM topics WHERE id=?').run(citation.ref.topicId)
    expect(() => validateCitation('alice', citation, store.portfolio)).toThrow()
  })
  it('builds bounded quoted data without starting a run or leaking internal ids into prose', () => {
    const { store, citation } = fixture(), count = store.overview('alice').runs.length
    const context = citationContext('alice', [citation], store.portfolio)
    expect(context).toContain('重复😀'); expect(context).toContain('版本 1'); expect(context).toContain('数据')
    expect(context).not.toContain(citation.ref.topicId)
    expect(store.overview('alice').runs).toHaveLength(count)
    expect(() => citationContext('alice', Array(5).fill(citation), store.portfolio)).toThrow()
  })
})
