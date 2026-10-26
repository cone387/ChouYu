import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ContactTaskStore } from '../task-center/contact-store'
import { DEFAULT_AGENT_SETTINGS, type AgentTopicProgress } from '../../shared/agents'
import { endingState, type TaskEndingRequest } from '../../shared/task-ending'
import { taskState } from '../../shared/task-state'
let store: ContactTaskStore
const start = Date.parse('2026-10-26T00:00:00Z')
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(start); store = new ContactTaskStore(':memory:'); store.save('a', { ...DEFAULT_AGENT_SETTINGS, enabled: true, goal: 'write', dailyCalls: 100 }, start, false) })
afterEach(() => { store.close(); vi.useRealTimers() })
const request = (patch: unknown, text: string): TaskEndingRequest => ({ patch, text, acceptedAt: start, timeZone: 'Asia/Shanghai' })
const progress: AgentTopicProgress = { status: 'researching', judgement: '已保存', reason: '本期完成', nextStep: '下一期', openQuestions: '' }
it('marks restored occurrence totals incomplete once and preserves a newly authorized anchor', () => {
  const topic = store.assignCalendarTopic('a', { title: '每期文章', instruction: '正文', kind: 'contact-summary', enabled: true, cadence: 'daily', times: ['09:00'],
    endingRequest: request({ count: { mode: 'delivered', amount: 3, source: '发送3次' } }, '发送3次') }, '')
  const identity = { restoreId: 'restore', scopeReviewed: true, allowedTopics: [topic.id] }
  store.recovery.sync('a', identity)
  let current = store.topics.get('a', topic.id)
  expect(endingState(current.ending).reason).toBe('history-unknown')
  store.topics.ending('a', topic.id, current.revision, request({ count: { mode: 'delivered', amount: 2, fromNow: true, source: '再发送2次' } }, '再发送2次'))
  store.recovery.sync('a', identity)
  current = store.topics.get('a', topic.id)
  expect(endingState(current.ending).stopped).toBe(false)
  expect(current.ending?.count?.target).toBe(2)
})
it('guards requests and resume after a deadline but permits an in-flight valid result to commit', () => {
  const topic = store.assignTopic('a', '写文章', '', undefined, undefined, request({ deadline: { kind: 'duration', value: 60000, source: '只工作一分钟后结束' } }, '只工作一分钟后结束'))
  const run = store.overview('a').runs[0].id
  store.charge(run)
  vi.setSystemTime(start + 60000)
  expect(() => store.charge(run)).toThrow('截止')
  expect(() => store.endings.assertRun(run)).toThrow('截止')
  expect(() => store.createRun('a', '', Date.now(), topic.id)).toThrow('截止')
  store.finish(run, { runId: run, title: '结果', body: '已保存', nextStep: '保留', createdAt: Date.now(), evidence: [] }, [], progress,
    { completionCriteria: '正文', summary: '正文', stages: [{ id: 'one', title: '正文', status: 'active' }], section: { id: 'one', title: '正文', body: '在途请求安全返回的有效正文。' } })
  expect(store.deliveries.get(topic.id)?.sections[0].body).toContain('安全返回')
  expect(store.nextScheduledTopic('a')).toBeUndefined()
  expect(taskState(store.overview('a'), store.topics.get('a', topic.id)).code).toBe('ending-deadline')
  expect(store.topics.get('a', topic.id).status).toBe('researching')
})
it('commits count, result and outbox together; pending final delivery blocks another period and acks are idempotent', () => {
  const now = new Date(start), time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes() + 1).padStart(2, '0')}`
  const topic = store.assignCalendarTopic('a', { title: '每期文章', instruction: '写正文', kind: 'contact-summary', enabled: true, cadence: 'daily', times: [time],
    endingRequest: request({ count: { mode: 'delivered', amount: 1, source: '发送1次' } }, '发送1次') }, '')
  vi.setSystemTime(start + 60000)
  const run = store.startScheduledTopic('a', topic.id, '')
  const report = { runId: run, title: '第一期', body: '已保存', nextStep: '下一期', createdAt: Date.now(), evidence: [] }
  const delivery = { completionCriteria: '正文', summary: '正文', stages: [{ id: 'one', title: '正文', status: 'active' as const }], section: { id: 'one', title: '正文', body: '第一期正文。' } }
  store.db.exec("CREATE TRIGGER fail_count BEFORE UPDATE ON topics WHEN json_extract(new.value,'$.ending.occurrences')<>json_extract(old.value,'$.ending.occurrences') BEGIN SELECT RAISE(ABORT,'count commit failure'); END")
  expect(() => store.finish(run, report, [], progress, delivery)).toThrow('count commit failure')
  expect(store.deliveries.get(topic.id)).toBeNull()
  expect(store.notices.pending('a')).toEqual([])
  store.db.exec('DROP TRIGGER fail_count')
  store.finish(run, report, [], progress, delivery); store.finish(run, report, [], progress, delivery)
  expect(endingState(store.topics.get('a', topic.id).ending)).toMatchObject({ reason: 'delivery-pending', produced: 1, delivered: 0 })
  vi.setSystemTime(start + 86400000 + 60000)
  expect(store.nextScheduledTopic('a')).toBeUndefined()
  expect(() => store.startScheduledTopic('a', topic.id, '')).toThrow('送达')
  const notice = store.notices.pending('a')[0]
  store.notices.ack('a', notice.id); store.notices.ack('a', notice.id)
  expect(endingState(store.topics.get('a', topic.id).ending)).toMatchObject({ reason: 'count', produced: 1, delivered: 1 })
})
