import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TaskCenter } from '../task-center/store'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
const cleanup: (() => void)[] = []
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close() })
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'output-preferences-')), path = join(dir, 'agents.db'), store = new TaskCenter(path)
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }), () => store.close())
  store.save('alice', { ...DEFAULT_AGENT_SETTINGS, goal: '写作' }, Date.now(), false); store.ensure('bob')
  const topic = store.topics.create('alice', { title: '写作', goal: '写一篇文章', constraints: '' }), run = store.createRun('alice', '', Date.now(), topic.id)
  const report = { runId: run, title: '正文', body: '实际正文', nextStep: '继续', evidence: [], createdAt: Date.now() }
  const progress = { judgement: '已保存', openQuestions: '', nextStep: '继续', reason: '依据正文', status: 'researching' as const }
  store.deliveries.commit(topic.id, report, progress)
  return { store, path, topic, run, report, progress }
}
it('persists layered preferences without changing content, version, task state or queued work', () => {
  const f = fixture(), before = f.store.overview('alice'), artifact = f.store.deliveries.get(f.topic.id)
  f.store.outputs.save('alice', { kind: 'contact' }, 0, { kind: 'review' })
  f.store.outputs.save('alice', { kind: 'task', topicId: f.topic.id }, 0, { density: 'compact' })
  f.store.outputs.save('alice', { kind: 'delivery', topicId: f.topic.id, version: 1 }, 0, { kind: 'plain' })
  const reopened = new TaskCenter(f.path); cleanup.push(() => reopened.close())
  expect(reopened.outputs.list('alice', f.topic.id, 1).map(p => p.preference)).toEqual([{ kind: 'review' }, { density: 'compact' }, { kind: 'plain' }])
  expect(reopened.outputs.list('alice', f.topic.id).map(p => p.preference)).toEqual([{ kind: 'review' }, { density: 'compact' }])
  expect(reopened.deliveries.get(f.topic.id)).toEqual(artifact)
  expect(reopened.overview('alice')).toMatchObject({ revision: before.revision, settings: before.settings, topics: before.topics, runs: before.runs })
  expect(reopened.outputs.list('bob')[0].preference).toEqual({})
})
it('rejects stale, foreign, deleted, invalid and unrecorded version targets', () => {
  const f = fixture(), scope = { kind: 'task' as const, topicId: f.topic.id }
  f.store.outputs.save('alice', scope, 0, { density: 'compact' })
  expect(() => f.store.outputs.save('alice', scope, 0, { kind: 'writing' })).toThrow('变化')
  expect(() => f.store.outputs.save('bob', scope, 0, {})).toThrow()
  expect(() => f.store.outputs.save('alice', { kind: 'delivery', topicId: f.topic.id, version: 2 }, 0, {})).toThrow()
  expect(() => f.store.outputs.save('alice', scope, 1, { code: 'unsafe' })).toThrow()
  f.store.deleteTopic('alice', f.topic.id, f.store.topics.get('alice', f.topic.id).revision)
  expect(() => f.store.outputs.list('alice', f.topic.id)).toThrow()
})
it('rolls back a failed preference save and keeps the previous revision', () => {
  const f = fixture()
  f.store.outputs.save('alice', { kind: 'contact' }, 0, { kind: 'writing' })
  f.store.db.exec("CREATE TRIGGER fail_output BEFORE UPDATE ON contact_output_preferences BEGIN SELECT RAISE(ABORT,'disk full'); END")
  expect(() => f.store.outputs.save('alice', { kind: 'contact' }, 1, { density: 'compact' })).toThrow('disk full')
  expect(f.store.outputs.list('alice')[0]).toMatchObject({ revision: 1, preference: { kind: 'writing' } })
})
it('does not save future generation instructions on an immutable delivery version', () => {
  const f = fixture(), scope = { kind: 'delivery' as const, topicId: f.topic.id, version: 1 }
  expect(() => f.store.outputs.save('alice', scope, 0, { instruction: '先给结论' })).toThrow('正文修订')
  expect(f.store.outputs.get('alice', scope)).toMatchObject({ revision: 0, preference: {} })
})
