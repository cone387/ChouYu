import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentStore } from './store'
import { DEFAULT_AGENT_SETTINGS, type AgentTopicProgress } from '../../shared/agents'

const stores: AgentStore[] = [], dirs: string[] = []
const progress: AgentTopicProgress = { judgement: '需求存在', reason: '资料提供线索', nextStep: '核对付费意愿', openQuestions: '谁愿付费', status: 'needs_evidence' }
const settings = { ...DEFAULT_AGENT_SETTINGS, goal: '研究需求', sources: ['https://example.com'] }
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'chouyu-notices-')); dirs.push(dir)
  const path = join(dir, 'agents.db'), store = new AgentStore(path); stores.push(store)
  store.save('alice', settings); store.save('bob', settings)
  return { store, path, topic: store.overview('alice').topics[0] }
}
function finish(store: AgentStore, hash = 'one', change = progress) {
  const runId = store.createRun('alice', '')
  const report = { runId, title: '报告', body: '真实资料', nextStep: change.nextStep, createdAt: Date.now(), evidence: [{ url: 'https://example.com', title: '资料', text: '公开资料', capturedAt: Date.now(), hash }] }
  store.finish(runId, report, [], change)
  return runId
}
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('contact notice outbox', () => {
  it('survives restart, isolates owners, and does not enqueue duplicate commits', () => {
    const { store, path } = fixture(), runId = finish(store)
    store.finish(runId, store.detail('alice', runId).report!, [], progress)
    expect(store.notices.pending('bob')).toEqual([])
    const first = store.notices.pending('alice')[0]
    expect(first.runId).toBe(runId)
    store.close(); stores.splice(stores.indexOf(store), 1)
    const recovered = new AgentStore(path); stores.push(recovered)
    expect(recovered.notices.pending('alice')).toEqual([first])
    recovered.notices.ack('bob', first.id)
    expect(recovered.notices.pending('alice')).toHaveLength(1)
    recovered.notices.ack('alice', first.id)
    expect(recovered.notices.pending('alice', Date.now() + 86400000)).toEqual([])
  })
  it('suppresses repeated evidence paraphrases, but delivers changed judgement and terminal status', () => {
    const { store } = fixture(), now = Date.now()
    finish(store); store.notices.ack('alice', store.notices.pending('alice')[0].id, now)
    finish(store, 'one', { ...progress, judgement: '同一需求的不同表述' })
    expect(store.notices.pending('alice', now + 1800001)).toEqual([])
    const changed = finish(store, 'two', { ...progress, judgement: '新证据推翻个人付费假设' })
    expect(store.notices.pending('alice', now + 1000)).toEqual([])
    expect(store.notices.pending('alice', now + 1800001)[0].runId).toBe(changed)
    const ended = finish(store, 'two', { ...progress, judgement: '停止投入', status: 'abandoned', nextStep: '' })
    expect(store.notices.pending('alice', now + 1800001).map(n => n.runId)).toEqual([ended])
  })
  it('prioritizes waiting questions, suppresses answered/stale questions, and respects opt-out', () => {
    const { store, topic } = fixture(), now = Date.now()
    finish(store); store.notices.ack('alice', store.notices.pending('alice')[0].id, now)
    const run = store.createRun('alice', ''); store.wait(run, '是否继续？'); store.wait(run, '是否继续？')
    expect(store.notices.pending('alice', now + 1)).toHaveLength(1)
    store.answer('alice', run, '是')
    expect(store.notices.pending('alice', now + 1)).toEqual([])
    store.cancel('alice', '重新运行')
    const next = store.createRun('alice', ''); store.wait(next, '预算多少？')
    store.changeTopic('alice', topic.id, 2, { status: 'paused', reason: '稍后研究' })
    expect(store.notices.pending('alice', now + 1800001)).toEqual([])
    store.save('alice', { ...settings, notifyProgress: false })
    store.continueTopic('alice', topic.id, 3, '继续', '')
    finish(store)
    expect(store.notices.pending('alice', now + 86400000)).toEqual([])
  })
  it('caps all notices at eight per rolling day including questions', () => {
    const { store } = fixture(), now = Date.now()
    for (let i = 0; i < 9; i++) {
      const run = store.createRun('alice', ''); store.wait(run, `问题 ${i}`)
      const pending = store.notices.pending('alice', now + i)
      expect(pending).toHaveLength(i < 8 ? 1 : 0)
      if (i < 8) { store.notices.ack('alice', pending[0].id, now + i); store.cancel('alice', '下一轮') }
    }
    expect(store.notices.pending('alice', now + 86400010)).toHaveLength(1)
  })
  it('rolls back the outbox with a failed report and removes it with its owner', () => {
    const { store } = fixture()
    store.db.exec("CREATE TRIGGER reject_report BEFORE INSERT ON reports BEGIN SELECT RAISE(ABORT, 'fixture'); END")
    expect(() => finish(store)).toThrow('fixture')
    expect(store.notices.pending('alice')).toEqual([])
    store.db.exec('DROP TRIGGER reject_report'); finish(store)
    store.remove('alice')
    expect(store.db.prepare('SELECT * FROM notices').all()).toEqual([])
  })
  it('rolls back resume/focus when the daily budget prevents a run', () => {
    const { store, topic } = fixture()
    store.save('alice', { ...settings, dailyCalls: 2 })
    const run = store.createRun('alice', '')
    store.charge(run); store.charge(run)
    store.changeTopic('alice', topic.id, topic.revision, { status: 'paused', reason: '暂停' })
    expect(() => store.continueTopic('alice', topic.id, 2, '继续', '')).toThrow('上限')
    expect(store.topics.get('alice', topic.id).status).toBe('paused')
    expect(store.topics.get('alice', topic.id).revision).toBe(2)
  })
})
