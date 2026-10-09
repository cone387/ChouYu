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
  it('keeps every question and reply across pagination and restart, isolated by owner', () => {
    const { store, path, topic } = fixture()
    const run = store.createRun('alice', '')
    for (let i = 0; i < 27; i++) { store.wait(run, `确认 ${i}`); store.answer('alice', run, `回复 ${i}`) }
    store.wait(run, '最后一个问题')
    const first = store.interactions('alice', topic.id)
    expect(first.items).toHaveLength(50)
    expect(first.items[0]).toMatchObject({ kind: 'waiting', text: '最后一个问题', pending: true })
    expect(first.items[1]).toMatchObject({ kind: 'answer', text: '回复 26', pending: false })
    expect(first.items.filter(item => item.pending)).toHaveLength(1)
    const older = store.interactions('alice', topic.id, first.nextCursor)
    expect(older.items).toHaveLength(5)
    expect(older.nextCursor).toBeUndefined()
    expect(new Set([...first.items, ...older.items].map(item => item.id)).size).toBe(55)
    expect(() => store.interactions('bob', topic.id)).toThrow()
    store.cancel('alice', '暂停')
    expect(store.interactions('alice', topic.id).items[0].pending).toBe(false)
    store.close(); stores.splice(stores.indexOf(store), 1)
    const reopened = new AgentStore(path); stores.push(reopened)
    expect(reopened.interactions('alice', topic.id).items[0].text).toBe('最后一个问题')
  })
  it('survives restart, isolates owners, and does not enqueue duplicate commits', () => {
    const { store, path } = fixture(), runId = finish(store)
    store.finish(runId, store.detail('alice', runId).report!, [], progress)
    expect(store.notices.pending('bob')).toEqual([])
    const first = store.notices.pending('alice')[0]
    expect(first.runId).toBe(runId)
    expect(first.update).toMatchObject({ taskTitle: store.overview('alice').topics[0].title, title: '报告', summary: progress.judgement, nextStep: progress.nextStep, outcome: 'updated' })
    expect(first.content).not.toContain('变化原因：')
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
    expect(store.notices.pending('alice', now + 1000)[0].runId).toBe(changed)
    expect(store.notices.pending('alice', now + 1800001)[0].runId).toBe(changed)
    store.notices.ack('alice', store.notices.pending('alice')[0].id)
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
  it('always delivers blocking questions, even beyond the progress cap or with progress notifications off', () => {
    const { store } = fixture(), now = Date.now()
    store.save('alice', { ...settings, notifyProgress: false })
    for (let i = 0; i < 9; i++) {
      const run = store.createRun('alice', ''); store.wait(run, `问题 ${i}`)
      const pending = store.notices.pending('alice', now + i)
      expect(pending).toHaveLength(1)
      store.notices.ack('alice', pending[0].id, now + i); store.cancel('alice', '下一轮')
    }
    expect(store.notices.pending('alice', now + 86400010)).toHaveLength(0)
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

it('delivers each committed result immediately across revisions and restart, beyond eight per day', () => {
  const { store, path } = fixture()
  const runs = Array.from({ length: 12 }, (_, i) => finish(store, String(i), { ...progress, judgement: `判断 ${i}` }))
  expect(store.notices.pending('alice').map(n => n.runId)).toEqual(runs)
  for (const notice of store.notices.pending('alice').slice(0, 9)) store.notices.ack('alice', notice.id)
  store.close(); stores.splice(stores.indexOf(store), 1)
  const reopened = new AgentStore(path); stores.push(reopened)
  expect(reopened.notices.pending('alice').map(n => n.runId)).toEqual(runs.slice(9))
})
it('retries continuous work promptly, reports failures once, and restores old long waits on restart', () => {
  const { store, path, topic } = fixture()
  store.save('alice', { ...settings, enabled: true, intervalMinutes: 180, notifyProgress: false })
  const first = store.createRun('alice', '')
  const before = Date.now(); store.fail(first, '模型返回不完整'); store.fail(first, '重复回调')
  expect(store.overview('alice').failures).toBe(1)
  expect(store.overview('alice').nextAt).toBeGreaterThanOrEqual(before + 60000)
  expect(store.overview('alice').nextAt).toBeLessThanOrEqual(Date.now() + 60000)
  expect(store.nextScheduledTopic('alice', before)).toBeUndefined()
  expect(store.nextScheduledTopic('alice', Date.now() + 61000)).toBe(topic.id)
  expect(store.notices.pending('alice')).toHaveLength(1)
  expect(store.notices.pending('alice')[0].content).toContain('1 分钟')
  const second = store.createRun('alice', ''); store.fail(second, '再次失败')
  store.db.prepare('UPDATE profiles SET next_at=? WHERE character_id=?').run(Date.now() + 10800000, 'alice')
  store.close(); stores.splice(stores.indexOf(store), 1)
  const reopened = new AgentStore(path); stores.push(reopened)
  expect(reopened.overview('alice').failures).toBe(2)
  expect(reopened.overview('alice').nextAt).toBeLessThanOrEqual(Date.now() + 180000)
  const third = reopened.createRun('alice', ''); reopened.fail(third, '仍然失败')
  expect(reopened.nextScheduledTopic('alice', Date.now() + 86400000)).toBeUndefined()
  expect(reopened.notices.pending('alice').find(n => n.runId === third)?.content).toContain('自动推进已停止')
})

it('preserves interval mode and work-hour limits during failure retry', () => {
  const { store } = fixture()
  store.save('alice', { ...settings, enabled: true, paceWriting: true, intervalMinutes: 180 })
  store.fail(store.createRun('alice', ''), '失败')
  expect(store.overview('alice').nextAt).toBeGreaterThan(Date.now() + 179 * 60000)
  store.save('alice', { ...settings, enabled: true, workHours: { start: '09:00', end: '10:00' } })
  const outside = new Date(); outside.setDate(outside.getDate() + 1); outside.setHours(12, 0, 0, 0)
  expect(store.nextScheduledTopic('alice', outside.getTime())).toBeUndefined()
})
it('rolls back failure status and retry counters when its notification cannot be persisted', () => {
  const { store } = fixture(), run = store.createRun('alice', '')
  store.db.exec("CREATE TRIGGER reject_notice BEFORE INSERT ON notices BEGIN SELECT RAISE(ABORT, 'outbox failure'); END")
  expect(() => store.fail(run, 'failed request')).toThrow('outbox failure')
  expect(store.getRun(run)?.status).toBe('queued')
  expect(store.overview('alice').failures).toBe(0)
  store.db.exec('DROP TRIGGER reject_notice')
  store.fail(run, 'failed request')
  expect(store.notices.pending('alice')).toHaveLength(1)
})
