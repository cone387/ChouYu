import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ContactTaskStore } from '../contact-store'

const cleanup: (() => void)[] = []
afterEach(() => cleanup.splice(0).reverse().forEach(fn => fn()))
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'chouyu-task-requests-')), file = join(dir, 'tasks.db')
  let store = new ContactTaskStore(file)
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }), () => store.close())
  store.ensure('alice'); store.ensure('bob')
  const topic = store.topics.create('alice', { title: '文章', goal: '写文章', constraints: '保留依据' })
  const submission = (id = 'request-1', text = '增加一个案例') => ({ source: { requestId: id, sessionId: 'session-1', messageId: `message-${id}`, text, acceptedAt: 100 }, tool: 'edit_contact_task', arguments: { topicId: topic.id, revision: topic.revision, constraints: '保留依据，增加案例', reason: text } })
  const apply = (input = submission()) => store.requests.apply('alice', input, () => {
    store.editTaskFromChat('alice', topic.id, store.topics.get('alice', topic.id).revision, { constraints: '保留依据，增加案例' }, input.source.text)
    return { topicId: topic.id, effect: 'requirements' as const }
  })
  return { get store() { return store }, topic, submission, apply, reopen() { store.close(); store = new ContactTaskStore(file) } }
}

it('keeps a stable receipt across restart without applying a task change twice', () => {
  const f = fixture(), first = f.apply(), revision = f.store.topics.get('alice', f.topic.id).revision
  f.reopen()
  expect(f.apply()).toEqual(first)
  expect(f.store.topics.get('alice', f.topic.id).revision).toBe(revision)
  expect(f.store.requests.list('alice', f.topic.id).items).toMatchObject([{ source: { text: '增加一个案例', sessionId: 'session-1', messageId: 'message-request-1' }, status: 'saved' }])
  expect(() => f.apply({ ...f.submission(), arguments: { ...f.submission().arguments, constraints: '删除所有依据' } })).toThrow('请求')
})

it('marks only the request snapshot actually included in a model call', () => {
  const f = fixture()
  f.apply()
  const runId = f.store.createRun('alice', '', Date.now(), f.topic.id)
  const sent = f.store.requests.context(runId).map(row => row.id)
  f.store.requests.apply('alice', f.submission('late', '补充回答'), () => ({ topicId: f.topic.id, effect: 'answer', runId }))
  f.store.requests.supplied(runId, sent)
  expect(f.store.requests.list('alice', f.topic.id).items).toMatchObject([
    { source: { requestId: 'late' }, attempts: [{ runId }] },
    { source: { requestId: 'request-1' }, attempts: [{ suppliedAt: expect.any(Number) }] }
  ])
  expect(f.store.requests.list('alice', f.topic.id).items[0].attempts[0].suppliedAt).toBeUndefined()
})

it('rolls back both the task mutation and the receipt when request persistence fails', () => {
  const f = fixture()
  f.store.db.exec("CREATE TRIGGER request_failure BEFORE INSERT ON contact_task_requests BEGIN SELECT RAISE(ABORT, 'request write failure'); END")
  expect(() => f.apply()).toThrow('request write failure')
  expect(f.store.topics.get('alice', f.topic.id)).toEqual(f.topic)
  expect(f.store.requests.list('alice', f.topic.id).items).toEqual([])
})

it('keeps consecutive requests separately and paginates by a stable cursor', () => {
  const f = fixture()
  f.apply(f.submission('first')); f.apply(f.submission('second', '结论也保留'))
  const page = f.store.requests.list('alice', f.topic.id, undefined, 1)
  f.apply(f.submission('third', '再补一项'))
  expect(page.items.map(row => row.source.requestId)).toEqual(['second'])
  expect(f.store.requests.list('alice', f.topic.id, page.nextCursor, 1).items.map(row => row.source.requestId)).toEqual(['first'])
  expect(() => f.store.requests.list('bob', f.topic.id)).toThrow()
  expect(f.store.requests.get('bob', f.submission())).toBeNull()
})

it('rejects a foreign target inside the transaction and does not accept an asynchronous mutation', () => {
  const f = fixture()
  expect(() => f.store.requests.apply('bob', f.submission(), () => ({ topicId: f.topic.id, effect: 'requirements' }))).toThrow()
  expect(() => f.store.requests.apply('alice', f.submission(), (() => Promise.resolve({ topicId: f.topic.id, effect: 'requirements' })) as never)).toThrow()
  expect(f.store.requests.get('alice', f.submission())).toBeNull()
})

it('keeps paused tasks paused and does not fabricate a run or model consumption', () => {
  const f = fixture()
  f.store.changeTopic('alice', f.topic.id, f.topic.revision, { status: 'paused', reason: '暂停' })
  f.apply(); f.reopen()
  expect(f.store.topics.get('alice', f.topic.id).status).toBe('paused')
  expect(f.store.requests.list('alice', f.topic.id).items[0]).toMatchObject({ status: 'saved', attempts: [] })
})

it('binds both saved requirements to real runs, records model supply, and preserves facts across restart', () => {
  const f = fixture()
  f.apply(f.submission('first')); f.apply(f.submission('second', '结论也保留'))
  const runId = f.store.createRun('alice', '', Date.now(), f.topic.id)
  expect(f.store.requests.list('alice', f.topic.id).items.map(row => row.status)).toEqual(['queued', 'queued'])
  expect(f.store.requests.context(runId).map(row => row.text)).toEqual(['增加一个案例', '结论也保留'])
  f.store.requests.supplied(runId, f.store.requests.context(runId).map(row => row.id))
  f.store.setStatus(runId, 'interrupted'); f.reopen()
  expect(f.store.requests.list('alice', f.topic.id).items).toMatchObject([
    { status: 'interrupted', attempts: [{ runId, suppliedAt: expect.any(Number) }] },
    { status: 'interrupted', attempts: [{ runId, suppliedAt: expect.any(Number) }] }
  ])
})

it('links only a committed formal result and rolls back request/result/notice changes together', () => {
  const f = fixture(); f.apply()
  const runId = f.store.createRun('alice', '', Date.now(), f.topic.id)
  f.store.requests.supplied(runId, f.store.requests.context(runId).map(row => row.id))
  const finish = () => f.store.finish(runId, { runId, title: '文章', body: '变化说明', nextStep: '继续', evidence: [], createdAt: Date.now() }, [],
    { status: 'researching', judgement: '已保存', openQuestions: '', nextStep: '继续', reason: '完成本轮' },
    { completionCriteria: '完成', stages: [{ id: 'write', title: '写作', status: 'active' }], summary: '完成本轮', section: { id: 'part', title: '第一节', body: '真实正文和案例' } })
  f.store.db.exec("CREATE TRIGGER request_result_failure BEFORE UPDATE OF result_version ON contact_task_request_runs BEGIN SELECT RAISE(ABORT, 'result link failed'); END")
  expect(finish).toThrow('result link failed')
  expect(f.store.deliveries.get(f.topic.id)).toBeNull()
  expect(f.store.notices.pending('alice')).toEqual([])
  f.store.db.exec('DROP TRIGGER request_result_failure')
  finish(); f.reopen()
  expect(f.store.requests.list('alice', f.topic.id).items[0]).toMatchObject({ status: 'result-saved', attempts: [{ runId, resultVersion: 1 }] })
  expect(f.store.deliveries.get(f.topic.id, 1)?.sections[0].body).toBe('真实正文和案例')
})

it('does not turn model supply or a report without a formal artifact into a delivered result', () => {
  const f = fixture(); f.apply()
  const runId = f.store.createRun('alice', '', Date.now(), f.topic.id)
  f.store.requests.supplied(runId, f.store.requests.context(runId).map(row => row.id)); f.store.setStatus(runId, 'completed')
  expect(f.store.requests.list('alice', f.topic.id).items[0]).toMatchObject({ status: 'no-result', attempts: [{ runId, suppliedAt: expect.any(Number) }] })
  expect(f.store.requests.list('alice', f.topic.id).items[0].attempts[0].resultVersion).toBeUndefined()
})

it('refuses late work after new requirements and includes both requests in the replacement run', () => {
  const f = fixture(); f.apply(f.submission('first'))
  const old = f.store.createRun('alice', '', Date.now(), f.topic.id)
  f.store.requests.supplied(old, [])
  f.apply(f.submission('second', '保留结论'))
  expect(() => f.store.requests.supplied(old, [])).toThrow()
  const next = f.store.createRun('alice', '', Date.now(), f.topic.id)
  expect(f.store.requests.context(next).map(row => row.text)).toEqual(['增加一个案例', '保留结论'])
  expect(f.store.requests.list('alice', f.topic.id).items.find(row => row.source.requestId === 'first')?.attempts.map(row => row.runId)).toEqual([next, old])
})

it('removes original text with a deleted task while keeping a minimal replay tombstone', () => {
  const f = fixture(), submission = f.submission(); f.apply(submission)
  f.store.deleteTopic('alice', f.topic.id, f.store.topics.get('alice', f.topic.id).revision)
  f.reopen()
  expect(f.store.requests.get('alice', submission)?.topicId).toBeNull()
  expect(f.store.db.prepare('SELECT source FROM contact_task_requests').get()).not.toEqual(expect.objectContaining({ source: expect.stringContaining('增加一个案例') }))
  expect(() => f.store.requests.list('alice', f.topic.id)).toThrow()
})
