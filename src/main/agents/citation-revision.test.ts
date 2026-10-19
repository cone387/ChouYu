import { afterEach, describe, expect, it } from 'vitest'
import { ContactTaskStore } from '../task-center/contact-store'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import { deliveryText, textHash } from '../../shared/contact-content'
const stores: ContactTaskStore[] = []
afterEach(() => stores.splice(0).forEach(s => s.close()))
function fixture() {
  const store = new ContactTaskStore(':memory:'); stores.push(store)
  store.save('alice', { ...DEFAULT_AGENT_SETTINGS, goal: '写海边的故事' })
  const topicId = store.overview('alice').topics[0].id
  const body = '请保留的第一段。\n\n需要修改的第二段。', text = deliveryText(body)
  const progress = { status: 'researching' as const, judgement: '已有正文', reason: '已保存', nextStep: '继续', openQuestions: '' }
  const update = { completionCriteria: '完成作品', stages: [{ id: 's', title: '创作', status: 'active' as const }], summary: '正文', section: { id: 's', title: '海风', body } }
  const report = (runId: string) => ({ runId, title: '海风', body, nextStep: '继续', evidence: [], createdAt: Date.now() })
  const run = store.createRun('alice', '', Date.now(), topicId); store.finish(run, report(run), [], progress, update)
  const citation = { ref: { characterId: 'alice', topicId, version: 1, sectionId: 's' }, anchor: { start: 0, end: 9, quote: text.slice(0, 9), textHash: textHash(text) } }
  return { store, topicId, citation, progress, update, report }
}
describe('revision bound to a cited version', () => {
  it('persists the original version and keep-passage instruction in the actual run', () => {
    const f = fixture(), before = f.store.topics.get('alice', f.topicId)
    const run = f.store.reviseCitation('alice', before.revision, f.citation, '保留这一段，调整其他部分。', '')
    const input = JSON.parse(f.store.getRun(run)!.input)
    expect(input.revisionCitation).toEqual(f.citation)
    expect(input.feedback).toBe('保留这一段，调整其他部分。')
    expect(input.citationContext).toContain('版本 1')
    expect(input.citationContext).toContain(f.citation.anchor.quote)
    expect(input.revisionSectionId).toBe('s')
  })
  it('rejects stale citations before changing a task and cancels late result commits', () => {
    const f = fixture(), before = f.store.topics.get('alice', f.topicId)
    const run = f.store.createRun('alice', '', Date.now(), f.topicId)
    f.store.finish(run, f.report(run), [], f.progress, { ...f.update, section: { ...f.update.section, body: '新版正文' } })
    const count = f.store.overview('alice').runs.length, latest = f.store.topics.get('alice', f.topicId)
    expect(() => f.store.reviseCitation('alice', latest.revision, f.citation, '修改', '')).toThrow('新版')
    expect(f.store.overview('alice').runs).toHaveLength(count)
    expect(f.store.topics.get('alice', f.topicId)).toEqual(latest)
    expect(() => f.store.reviseCitation('alice', before.revision, { ...f.citation, ref: { ...f.citation.ref, version: 2 }, anchor: undefined }, '修改', '')).toThrow()
    const revision = f.store.reviseCitation('alice', latest.revision, { ref: { ...f.citation.ref, version: 2 } }, '修改', '')
    f.store.pause('alice')
    expect(() => f.store.finish(revision, f.report(revision), [], f.progress, f.update)).toThrow()
    expect(f.store.deliveries.get(f.topicId)!.version).toBe(2)
  })
  it('rechecks the source version before committing even if another writer bypasses task revision', () => {
    const f = fixture(), before = f.store.topics.get('alice', f.topicId)
    const run = f.store.reviseCitation('alice', before.revision, f.citation, '修改', '')
    const another = f.store.createRun('alice', '', Date.now(), f.topicId)
    f.store.deliveries.commit(f.topicId, f.report(another), f.progress, { ...f.update, section: { ...f.update.section, body: '并发新正文' } })
    expect(() => f.store.finish(run, f.report(run), [], f.progress, f.update)).toThrow('版本')
    expect(f.store.deliveries.get(f.topicId)!.version).toBe(2)
  })
})
