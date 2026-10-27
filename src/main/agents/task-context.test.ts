import { afterEach, expect, it } from 'vitest'
import { ContactTaskStore } from '../task-center/contact-store'
import { TaskContext } from './task-context'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import type { MemoryInput } from '../../shared/contact-memories'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ContactTaskCommands } from '../task-center/commands'

const stores: ContactTaskStore[] = []
afterEach(() => stores.splice(0).forEach(store => store.close()))
const preference = (content: string): MemoryInput => ({ content, kind: 'preference', scope: { kind: 'contact' }, source: { kind: 'user', at: 1 } })
function fixture(path = ':memory:') {
  const store = new ContactTaskStore(path); stores.push(store)
  for (const owner of ['alice', 'bob']) store.save(owner, { ...DEFAULT_AGENT_SETTINGS, goal: '持续写作', enabled: false, dailyCalls: 100 })
  const topic = store.overview('alice').focusTopicId!
  const other = store.topics.create('alice', { title: '另一任务', goal: '持续写作', constraints: '' }, '用户创建')
  let source = ''
  for (let n = 1; n <= 8; n++) {
    source = store.createRun('alice', '', Date.now(), topic)
    store.finish(source, { runId: source, title: `第${n}节`, body: '已保存', nextStep: '继续', evidence: [], createdAt: Date.now() }, [],
      { status: 'researching', judgement: '已保存', openQuestions: '', nextStep: '继续', reason: '持续任务' },
      { completionCriteria: '持续写作', summary: '累积摘要', stages: [{ id: 'write', title: '写作', status: 'active' }], section: { id: `entry${n}`, title: `第${n}节`, body: n === 1 ? 'EARLY_BODY_' + '长'.repeat(7000) : `已保存的正文${n}` } })
  }
  const research = store.memoryLibrary.create('alice', { ...preference('尚待核实的研究想法'), kind: 'research', source: { kind: 'research', runId: source } })
  store.feedbackLedger.submit('alice', { topicId: topic, revision: store.topics.get('alice', topic).revision, version: 8, action: 'accept', reason: '保留这个方向，重点核实成本', requestId: 'feedback:one' })
  const run = store.createRun('alice', '', Date.now(), topic)
  const context = new TaskContext(store.db, run, () => store.assertLive(run))
  return { store, topic, other, research, run, context }
}

it('retrieves old saved prose in bounded pages and pins the actual version', () => {
  const { context, store, topic } = fixture()
  const page = context.search({ kind: 'deliveries', query: 'EARLY_BODY' })
  expect(page.items).toHaveLength(1)
  expect(page.items[0].ref).toEqual({ kind: 'deliveries', id: 'entry1', version: 8 })
  const first = context.read({ ref: page.items[0].ref })
  expect(first.text).toHaveLength(6000)
  const rest = context.read({ ref: first.ref, offset: first.nextOffset })
  expect(first.text + rest.text).toBe(store.deliveries.get(topic, 8)!.sections[0].body)
  expect(() => context.read({ ref: { kind: 'deliveries', id: 'entry1', version: 9 } })).toThrow()
  expect(JSON.stringify(page).length).toBeLessThan(1500)
})

it('paginates without dropping sections or repeating entries', () => {
  const { context } = fixture()
  const first = context.search({ kind: 'deliveries' })
  expect(first.items).toHaveLength(6)
  const second = context.search({ kind: 'deliveries', cursor: first.nextCursor })
  expect(second.items).toHaveLength(2)
  expect(new Set([...first.items, ...second.items].map(item => item.ref.id)).size).toBe(8)
  expect(second.nextCursor).toBeUndefined()
})

it('matches any space-separated keyword and identifies complete versus truncated search text', () => {
  const { context, research } = fixture()
  const deliveries = context.search({ kind: 'deliveries', query: '没有匹配 EARLY_BODY' }).items
  expect(deliveries).toHaveLength(1)
  expect(deliveries[0]).toMatchObject({ truncated: true })
  const memories = context.search({ kind: 'memories', query: '没有匹配 尚待' }).items
  expect(memories[0]).toMatchObject({ ref: { id: research.id }, truncated: false })
  expect(context.search({ kind: 'feedback', query: '没有匹配 成本' }).items[0]).toMatchObject({ truncated: false })
  expect(context.search({ kind: 'deliveries', query: '正文8' }).items[0]).toMatchObject({ truncated: false })
})

it('can search a specific historical version without mixing revisions or future versions', () => {
  const { context } = fixture()
  const older = context.search({ kind: 'deliveries', version: 1, query: 'EARLY_BODY' })
  expect(older.items[0].ref.version).toBe(1)
  expect(context.search({ kind: 'deliveries', version: 1 }).items).toHaveLength(1)
  expect(() => context.search({ kind: 'deliveries', version: 9 })).toThrow()
})

it('schedules durable cleanup for recalled candidates when the user corrects them', () => {
  const { store, context, research, run } = fixture()
  context.search({ kind: 'memories' })
  store.memoryLibrary.update('alice', research.id, 1, { ...preference('用户纠正后的事实'), kind: 'research' })
  expect(() => store.assertLive(run)).toThrow()
  expect(store.invalidateMemory('alice', research.id)).toContain(run)
  expect(store.getRun(run)?.status).toBe('cancelled')
  expect(store.pendingCleanup()).toContainEqual({ characterId: 'alice', requestId: run })
})

it('rejects recalled candidates whose research source has been removed', () => {
  const { store, context, research, run } = fixture()
  context.search({ kind: 'memories' })
  if (research.source.kind !== 'research') throw new Error('invalid fixture')
  store.db.prepare('DELETE FROM runs WHERE id=?').run(research.source.runId)
  expect(() => store.assertLive(run)).toThrow('来源')
})

it.each(['store', 'command'] as const)('cancels and cleans dependent runs when deleting a legacy research memory source task via %s', async via => {
  const { store, topic, other, research } = fixture()
  const dependent = store.createRun('alice', '', Date.now(), other.id)
  if (research.source.kind !== 'research') throw new Error('invalid fixture')
  store.db.prepare('INSERT INTO memories(id,character_id,content,run_id,created_at) VALUES(?,?,?,?,?)').run('legacy-recall', 'alice', '已迁移的历史研究', research.source.runId, 1)
  store.memoryLibrary.migrateLegacy()
  const reader = new TaskContext(store.db, dependent, () => store.assertLive(dependent))
  expect(reader.search({ kind: 'memories', query: '已迁移' }).items[0].status).toBe('active')
  const revision = store.topics.get('alice', topic).revision
  let affected: string[]
  if (via === 'store') affected = store.deleteTopic('alice', topic, revision)
  else {
    affected = []
    const controller = new AbortController()
    const promise = new Promise<void>(resolve => controller.signal.addEventListener('abort', () => resolve(), { once: true }))
    const active = { id: dependent, characterId: 'alice', topicId: other.id, controller, promise }
    const commands = new ContactTaskCommands({ store, identity: id => ({ id, soul: '', conversation: '', config: null }), changed() {}, tick() {}, async remove() {}, abort() {},
      activeFor: (_id, topicId) => topicId === undefined || topicId === other.id ? [active] : [], activeRun: id => id === dependent ? active : undefined,
      async cleanupThread(id) { if (id === dependent) expect(controller.signal.aborted).toBe(true); affected.push(id) } })
    await commands.request('deleteTopic', 'alice', [topic, revision])
    expect(controller.signal.aborted).toBe(true)
  }
  expect(affected).toContain(dependent)
  expect(store.getRun(dependent)?.status).toBe('cancelled')
  expect(store.pendingCleanup()).toContainEqual({ characterId: 'alice', requestId: dependent })
})

it('retains pinned feedback and read references across database reopen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chouyu-recall-reopen-')), path = join(dir, 'agents.db')
  let current: ContactTaskStore | undefined
  try {
    const { store, context, run, topic, research } = fixture(path)
    current = store
    context.search({ kind: 'memories' })
    const before = context.search({ kind: 'feedback' })
    store.feedbackLedger.submit('alice', { topicId: topic, revision: store.topics.get('alice', topic).revision, version: 8, action: 'accept', reason: '下轮的新反馈', requestId: 'after-run' })
    store.setStatus(run, 'interrupted')
    store.close(); stores.splice(stores.indexOf(store), 1)
    current = new ContactTaskStore(path)
    const reopened = current, resumed = new TaskContext(reopened.db, run, () => reopened.assertLive(run))
    expect(resumed.search({ kind: 'feedback' })).toEqual(before)
    expect(resumed.read({ ref: { kind: 'memories', id: research.id, version: 1 } }).text).toBe(research.content)
    reopened.memoryLibrary.forget('alice', research.id, 1)
    expect(() => resumed.search({ kind: 'deliveries' })).toThrow()
  } finally { current?.close(); rmSync(dir, { recursive: true, force: true }) }
})

it('exposes current-task candidates honestly and excludes other tasks, owners and private sessions', () => {
  const { store, context, other, research } = fixture()
  const foreignRun = store.createRun('alice', '', Date.now(), other.id)
  const hidden = [
    store.memoryLibrary.create('alice', { ...preference('另一任务猜想'), kind: 'research', source: { kind: 'research', runId: foreignRun } }),
    store.memoryLibrary.create('alice', { ...preference('另一任务约定'), scope: { kind: 'task', topicId: other.id } }),
    store.memoryLibrary.create('bob', preference('另一联系人秘密'))
  ]
  store.memoryLibrary.registerSessions('alice', ['private'])
  hidden.push(store.memoryLibrary.create('alice', { ...preference('私聊秘密'), scope: { kind: 'session', sessionId: 'private' } }))
  const items = context.search({ kind: 'memories' }).items
  expect(items.map(item => item.ref.id)).toEqual([research.id])
  expect(items[0].status).toBe('candidate')
  expect(items[0].source).toEqual(research.source)
  expect(context.promptContext().memoryCounts).toEqual({ active: 0, candidate: 1 })
  expect(context.promptContext().candidateReferences).toEqual([{ kind: 'memories', id: research.id, version: research.revision, status: 'candidate' }])
  for (const memory of hidden) expect(() => context.read({ ref: { kind: 'memories', id: memory.id, version: 1 } })).toThrow()
  expect(store.memoryLibrary.get('alice', research.id).status).toBe('candidate')
  expect(store.memoryLibrary.select({ characterId: 'alice', query: '' }).items).toEqual([])
})

it('bounds candidate discovery and does not record a directory as supplied memory content', () => {
  const { store, context, research, run } = fixture()
  for (let index = 0; index < 8; index++) store.memoryLibrary.create('alice', { ...preference(`另一条待验证想法${index}`), kind: 'research', source: research.source })
  const overview = context.promptContext()
  expect(overview.memoryCounts.candidate).toBe(9)
  expect(overview.candidateReferences).toHaveLength(6)
  expect(JSON.stringify(overview)).not.toContain(research.content)
  expect(JSON.parse(store.getRun(run)!.input).recallReferences).toBeUndefined()
  const first = context.search({ kind: 'memories' })
  const second = context.search({ kind: 'memories', cursor: first.nextCursor })
  expect([...first.items, ...second.items]).toHaveLength(9)
})

it('returns feedback with its target version and does not incorporate later feedback', () => {
  const { store, context, topic, run } = fixture()
  const first = context.search({ kind: 'feedback' }).items[0]
  expect(context.read({ ref: first.ref })).toMatchObject({ text: '保留这个方向，重点核实成本', action: 'accept', ref: { version: 8 } })
  const later = store.feedbackLedger.submit('alice', { topicId: topic, revision: store.topics.get('alice', topic).revision, version: 8, action: 'accept', reason: '下一轮意见', requestId: 'feedback:two' })
  expect(context.search({ kind: 'feedback' }).items).toHaveLength(1)
  expect(() => context.read({ ref: { kind: 'feedback', id: String(later.feedbackId), version: 8 } })).toThrow()
  store.db.prepare("UPDATE runs SET input=json_remove(input,'$.taskContext.feedbackCount') WHERE id=?").run(run)
  expect(context.promptContext()).toMatchObject({ feedbackCount: 1, olderFeedbackCount: 0 })
})

it('tells the planner when older feedback is omitted from its initial context', () => {
  const { store, run, topic } = fixture()
  store.setStatus(run, 'failed')
  for (let index = 0; index < 3; index++) store.feedbackLedger.submit('alice', { topicId: topic, revision: store.topics.get('alice', topic).revision, version: 8, action: 'accept', reason: `较新的排版反馈${index}`, requestId: `recent:${index}` })
  const next = store.createRun('alice', '', Date.now(), topic)
  const context = new TaskContext(store.db, next, () => store.assertLive(next))
  expect(context.promptContext()).toMatchObject({ feedbackCount: 4, olderFeedbackCount: 1 })
  expect(context.promptContext().recentFeedback).toHaveLength(3)
  expect(context.search({ kind: 'feedback' }).items).toHaveLength(4)
})

it('invalidates even a memory search excerpt after correction or forgetting', () => {
  const { store, context, run, research } = fixture()
  context.search({ kind: 'memories' })
  context.read({ ref: { kind: 'memories', id: research.id, version: 1 } })
  expect(JSON.parse(store.getRun(run)!.input).recallReferences).toHaveLength(1)
  store.memoryLibrary.forget('alice', research.id, 1)
  expect(() => store.assertLive(run)).toThrow()
  expect(() => context.search({ kind: 'deliveries' })).toThrow()
})

it('refuses reads after pause and rejects malformed pagination', () => {
  const { store, context } = fixture()
  for (const offset of [-1, 0.5, Infinity]) expect(() => context.read({ ref: { kind: 'deliveries', id: 'entry1', version: 8 }, offset })).toThrow()
  expect(() => context.search({ kind: 'memories', query: 'x'.repeat(501) })).toThrow()
  expect(() => context.search({ kind: 'memories', query: 'a b c d e f g h i' })).toThrow('8')
  store.pause('alice')
  expect(() => context.read({ ref: { kind: 'deliveries', id: 'entry1', version: 8 } })).toThrow()
})
