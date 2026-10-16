import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TaskCenter } from '../task-center/store'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import { reviewTaskCompletion } from './task-completion'
import { AgentSpace } from '../agent-space/service'

const at = (day: number, hour: number) => new Date(2026, 9, day, hour).getTime()
const input = { title: '每日想法', instruction: '每天给一个新的想法', cadence: 'daily', times: ['09:00'], kind: 'contact-summary', enabled: true }
let store: TaskCenter, directory: string
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(at(13, 8))
  directory = mkdtempSync(join(tmpdir(), 'chouyu-calendar-')); store = new TaskCenter(join(directory, 'agents.db'))
  store.save('alice', { ...DEFAULT_AGENT_SETTINGS, goal: '独立研究', enabled: true, dailyCalls: 100 }, Date.now(), false)
})
afterEach(() => { store.close(); rmSync(directory, { force: true, recursive: true }); vi.useRealTimers() })

it('rebases unclaimed local appointments after timezone travel while preserving pinned attempts', () => {
  const original = process.env.TZ
  try {
    process.env.TZ = 'Asia/Shanghai'; vi.setSystemTime(Date.parse('2026-10-13T00:00:00Z'))
    const topic = store.assignCalendarTopic('alice', input, '', '每天九点')
    process.env.TZ = 'America/New_York'; vi.setSystemTime(Date.parse('2026-10-13T01:00:00Z'))
    expect(store.nextScheduledTopic('alice')).toBeUndefined()
    expect(store.overview('alice').taskSchedule?.[topic.id].nextAt).toBe(Date.parse('2026-10-13T13:00:00Z'))
    vi.setSystemTime(Date.parse('2026-10-13T14:00:00Z'))
    const first = store.startScheduledTopic('alice', topic.id, ''), occurrence = JSON.parse(store.getRun(first)!.input).calendar
    store.fail(first, 'offline')
    process.env.TZ = 'Asia/Shanghai'; vi.setSystemTime(Date.parse('2026-10-14T02:00:00Z'))
    const retry = store.startScheduledTopic('alice', topic.id, '')
    expect(JSON.parse(store.getRun(retry)!.input).calendar).toEqual(occurrence)
    store.defer(retry, '已完成')
    expect(store.calendars.get(topic.id)?.next_at).toBe(Date.parse('2026-10-15T01:00:00Z'))
  } finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original }
})

it('saves a real calendar without starting early, catches up the latest occurrence and resumes the anchor', () => {
  const topic = store.assignCalendarTopic('alice', input, '', '用户：每天九点')
  expect(store.overview('alice').runs).toEqual([])
  expect(store.nextScheduledTopic('alice')).toBeUndefined()
  expect(store.topics.get('alice', topic.id).calendar).toMatchObject({ cadence: 'daily', times: ['09:00'] })
  store.close(); store = new TaskCenter(join(directory, 'agents.db'))
  vi.setSystemTime(at(16, 10))
  expect(store.nextScheduledTopic('alice')).toBe(topic.id)
  const runId = store.startScheduledTopic('alice', topic.id, '')
  expect(JSON.parse(store.getRun(runId)!.input).calendar).toMatchObject({ dueAt: at(16, 9) })
  expect(store.nextScheduledTopic('alice')).toBeUndefined()
  store.defer(runId, '没有新增内容')
  expect(store.overview('alice').taskSchedule?.[topic.id].nextAt).toBe(at(17, 9))
  expect(store.nextScheduledTopic('alice', at(17, 8), () => true)).toBeUndefined()
  expect(store.nextScheduledTopic('alice', at(17, 10))).toBe(topic.id)
})
it('does not activate an unrelated idle task when accepting the first calendar arrangement', () => {
  store.createTopic('idle', { title: '仅保存的旧任务', goal: '稍后再做', constraints: '' })
  const topic = store.assignCalendarTopic('idle', input, '', '每天九点')
  expect(store.overview('idle').focusTopicId).toBe(topic.id)
  expect(store.nextScheduledTopic('idle')).toBeUndefined()
})
it('keeps a pre-existing long task title when adding a calendar', () => {
  const title = '原任务标题'.repeat(25)
  const created = store.topics.create('alice', { title, goal: '原目标', constraints: '原约束' })
  store.editCalendarTopic('alice', created.id, created.revision, { ...input, title, instruction: '原目标' }, '添加日历')
  expect(store.topics.get('alice', created.id)).toMatchObject({ title, goal: '原目标', constraints: '原约束' })
})

it('starts due calendars through each contact’s own execution identity and keeps existing call reservations', async () => {
  const started: string[] = []
  const service = new AgentSpace(join(directory, 'service'), () => {}, identity => async (_prompt, signal) => {
    started.push(identity.id)
    return new Promise<string>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }))
  })
  try {
    const config = { provider: 'openai' as const, baseUrl: 'https://example.com', apiKey: 'test', model: 'fixture', thinkingDisabledModels: [] }
    await service.sync(['writer', 'reviewer'].map(id => ({ id, soul: `独立的${id}`, conversation: '', config })))
    for (const id of ['writer', 'reviewer']) await service.request('assignCalendarTopic', id, [input, '每天九点'])
    expect(started).toEqual([])
    vi.setSystemTime(at(13, 10)); service.tick()
    await vi.waitFor(() => expect(new Set(started)).toEqual(new Set(['writer', 'reviewer'])))
    service.tick()
    expect(started).toHaveLength(2)
    for (const id of started) {
      const data = service.store.overview(id)
      expect(data.runs).toHaveLength(1)
      expect(data.runs[0]).toMatchObject({ characterId: id, status: 'running', calendar: { dueAt: at(13, 9) } })
      expect(data.callsToday).toBe(1)
    }
  } finally { await service.close() }
})

it('preserves failed period receipts across restart and does not overlap a waiting question', () => {
  const topic = store.assignCalendarTopic('alice', input, '', '每天九点')
  vi.setSystemTime(at(13, 10))
  const first = store.startScheduledTopic('alice', topic.id, '')
  store.fail(first, 'offline')
  store.close(); store = new TaskCenter(join(directory, 'agents.db'))
  vi.setSystemTime(at(15, 10))
  expect(store.nextScheduledTopic('alice')).toBe(topic.id)
  const retry = store.startScheduledTopic('alice', topic.id, '')
  expect(JSON.parse(store.getRun(retry)!.input).calendar).toEqual(JSON.parse(store.getRun(first)!.input).calendar)
  store.setStatus(retry, 'waiting')
  expect(store.nextScheduledTopic('alice', at(16, 10))).toBeUndefined()
  expect(store.startScheduledTopic('alice', topic.id, '')).toBe(retry)
})

it('settles the pinned period when retrying a failed calendar from work history', async () => {
  const service = new AgentSpace(join(directory, 'manual-retry'), () => {})
  try {
    await service.sync([{ id: 'alice', soul: '', conversation: '', config: { provider: 'openai', baseUrl: 'https://example.com', apiKey: 'test', model: 'fixture', thinkingDisabledModels: [] } }])
    vi.spyOn(service, 'tick').mockImplementation(() => {})
    const topic = service.store.assignCalendarTopic('alice', input, '', '每天九点')
    vi.setSystemTime(at(13, 10))
    const first = service.store.startScheduledTopic('alice', topic.id, '')
    const occurrence = JSON.parse(service.store.getRun(first)!.input).calendar
    service.store.fail(first, 'offline')
    await service.request('run', 'alice', [topic.id])
    const retry = service.store.overview('alice').runs.find(run => run.id !== first)!
    expect(JSON.parse(service.store.getRun(retry.id)!.input).calendar).toEqual(occurrence)
    service.store.defer(retry.id, '本期已检查')
    expect(service.store.calendars.get(topic.id)?.attempt_at).toBeNull()
    expect(service.store.nextScheduledTopic('alice', at(13, 12))).toBeUndefined()
    expect(service.store.calendars.get(topic.id)?.next_at).toBe(at(14, 9))
  } finally { await service.close() }
})

it('keeps calendar execution behind work hours, daily budgets, explicit pause and automatic enablement', () => {
  const topic = store.assignCalendarTopic('alice', input, '', '每天九点')
  vi.setSystemTime(at(14, 10))
  const settings = store.overview('alice').settings
  store.save('alice', { ...settings, workHours: { start: '20:00', end: '23:00' } }, Date.now(), false)
  expect(store.nextScheduledTopic('alice')).toBeUndefined()
  expect(store.nextScheduledTopic('alice', at(14, 21))).toBe(topic.id)
  store.save('alice', { ...settings, dailyCalls: 2 }, Date.now(), false)
  expect(store.nextScheduledTopic('alice')).toBeUndefined() // assignment needs three calls
  store.save('alice', { ...settings, enabled: false }, Date.now(), false)
  expect(store.nextScheduledTopic('alice')).toBeUndefined()
  store.save('alice', settings, Date.now(), false)
  store.changeTopic('alice', topic.id, store.topics.get('alice', topic.id).revision, { status: 'paused', reason: '暂停' })
  expect(store.nextScheduledTopic('alice')).toBeUndefined()
})
it('continues a paused calendar by restoring the calendar, without starting before its scheduled time', () => {
  const topic = store.assignCalendarTopic('alice', { ...input, enabled: false }, '', '每天九点')
  store.continueTopic('alice', topic.id, topic.revision, '恢复安排', '')
  expect(store.overview('alice').runs).toEqual([])
  expect(store.topics.get('alice', topic.id).status).toBe('planned')
  expect(store.nextScheduledTopic('alice')).toBeUndefined()
  expect(store.nextScheduledTopic('alice', at(13, 10))).toBe(topic.id)
})

it('rejects stale edits, cancels in-flight work on reschedule and removes calendar data with its task', () => {
  const topic = store.assignCalendarTopic('alice', input, '', '每天九点')
  vi.setSystemTime(at(13, 10))
  const runId = store.startScheduledTopic('alice', topic.id, '')
  store.editCalendarTopic('alice', topic.id, topic.revision, { ...input, times: ['20:00'] }, '改到晚上八点')
  expect(store.getRun(runId)?.status).toBe('cancelled')
  expect(() => store.defer(runId, '迟到')).toThrow()
  expect(() => store.editCalendarTopic('alice', topic.id, topic.revision, input, '旧要求')).toThrow('变化')
  expect(store.overview('alice').taskSchedule?.[topic.id].nextAt).toBe(at(13, 20))
  const updated = store.topics.get('alice', topic.id)
  expect(updated.requestLog).toContain('改到晚上八点')
  store.deleteTopic('alice', topic.id, updated.revision)
  expect(store.db.prepare('SELECT * FROM contact_calendars').all()).toEqual([])
})

it('does not turn a completed recurring delivery into an ended calendar task', async () => {
  const topic = store.assignCalendarTopic('alice', input, '', '每天九点')
  vi.setSystemTime(at(13, 10))
  const runId = store.startScheduledTopic('alice', topic.id, '')
  const model = vi.fn()
  const draft = { nextStep: '', progress: { status: 'completed' as const, judgement: '一个想法', reason: '已交付', openQuestions: '', nextStep: '' } }
  const checked = await reviewTaskCompletion(store, runId, store.topics.get('alice', topic.id), draft, model, new AbortController().signal, () => {})
  expect(checked.progress.status).toBe('researching')
  expect(checked.nextStep).toContain('下次')
  expect(model).not.toHaveBeenCalled()
})

it('finishes a once calendar after one successful round even after reopening late', () => {
  const topic = store.assignCalendarTopic('alice', { ...input, cadence: 'once', date: '2026-10-14' }, '', '明天九点')
  vi.setSystemTime(at(16, 10))
  const runId = store.startScheduledTopic('alice', topic.id, '')
  store.defer(runId, '已检查，无新增内容')
  expect(store.overview('alice').taskSchedule?.[topic.id].finishedAt).toBe(at(16, 10))
  store.close(); store = new TaskCenter(join(directory, 'agents.db'))
  expect(store.nextScheduledTopic('alice', at(17, 10))).toBeUndefined()
})
