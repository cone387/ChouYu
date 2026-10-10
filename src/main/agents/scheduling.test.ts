import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentStore } from './store'
import { AgentService } from './service'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'

const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn() })
function directory() {
  const dir = mkdtempSync(join(tmpdir(), 'chouyu-schedule-'))
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}
function fixture() {
  const path = join(directory(), 'agents.db'), store = new AgentStore(path)
  cleanup.push(() => store.close())
  return { store, path }
}

describe('persistent contact task scheduling', () => {
  it('keeps FIFO assignments across restart and starts the next task after completion', () => {
    const { store, path } = fixture()
    const first = store.assignTopic('alice', 'First task', '')
    const second = store.assignTopic('alice', 'Second task', 'original context')
    const third = store.assignTopic('alice', 'Third task', '')
    expect(store.nextScheduledTopic('alice')).toBeUndefined()
    const firstRun = store.overview('alice').runs[0]
    store.setStatus(firstRun.id, 'completed')
    store.changeTopic('alice', first.id, first.revision, { status: 'completed', reason: 'Finished' })
    const reopened = new AgentStore(path); cleanup.push(() => reopened.close())
    expect(reopened.overview('alice').queuedTopicIds).toEqual([second.id, third.id])
    expect(reopened.nextScheduledTopic('alice')).toBe(second.id)
    const run = reopened.startScheduledTopic('alice', second.id, 'later chat')
    expect(JSON.parse(reopened.getRun(run)!.input)).toMatchObject({ assignment: true, conversation: 'original context' })
    expect(reopened.overview('alice').queuedTopicIds).toEqual([third.id])
    expect(reopened.callCount('alice')).toBe(0)
    expect(reopened.nextScheduledTopic('alice')).toBeUndefined()
  })

  it('does not start old unscheduled tasks and preserves paused queued assignments', () => {
    const { store } = fixture()
    const old = store.createTopic('alice', { title: 'Old', goal: 'Not scheduled', constraints: '' }).topics[0]
    const first = store.assignTopic('alice', 'First task', '')
    expect(store.overview('alice').runs[0].topicId).toBe(first.id)
    expect(store.scheduled('alice').some(task => task.topic_id === old.id)).toBe(false)
    const second = store.assignTopic('alice', 'Second task', '')
    store.changeTopic('alice', second.id, second.revision, { status: 'paused', reason: 'Later' })
    store.changeTopic('alice', first.id, first.revision, { status: 'completed', reason: 'Finished' })
    expect(store.nextScheduledTopic('alice')).toBeUndefined()
    expect(store.overview('alice').queuedTopicIds).toEqual([])
    const run = store.continueTopic('alice', second.id, store.topics.get('alice', second.id).revision, 'Resume', '')
    expect(JSON.parse(store.getRun(run)!.input).assignment).toBe(true)
    store.pause('alice')
    expect(store.nextScheduledTopic('alice')).toBeUndefined()
    expect(store.overview('alice').runs.every(run => run.status === 'cancelled')).toBe(true)
  })

  it('queues without spending on exhausted days and keeps the queue when limits change', () => {
    const { store, path } = fixture()
    store.save('alice', { ...DEFAULT_AGENT_SETTINGS, goal: 'Work', dailyCalls: 3 }, Date.now(), false)
    const first = store.assignTopic('alice', 'First task', '')
    const run = store.overview('alice').runs[0].id
    for (let n = 0; n < 3; n++) store.charge(run)
    store.changeTopic('alice', first.id, first.revision, { status: 'completed', reason: 'Finished' })
    const second = store.assignTopic('alice', 'Second task', '')
    expect(store.nextScheduledTopic('alice')).toBeUndefined()
    expect(store.nextScheduledTopic('alice', Date.now() + 86400000)).toBe(second.id)
    const reopened = new AgentStore(path); cleanup.push(() => reopened.close())
    reopened.save('alice', { ...reopened.overview('alice').settings, dailyCalls: 6 }, Date.now(), false)
    expect(reopened.nextScheduledTopic('alice')).toBe(second.id)
    expect(reopened.callCount('alice')).toBe(3)
    reopened.deleteTopic('alice', second.id, second.revision)
    expect(reopened.scheduled('alice').some(task => task.topic_id === second.id)).toBe(false)
  })

  it('keeps older waiting questions visible after more than thirty other rounds', () => {
    const { store } = fixture()
    const first = store.assignTopic('alice', 'First task', '')
    const waitingRun = store.overview('alice').runs[0].id
    store.wait(waitingRun, 'Need your input')
    const second = store.assignTopic('alice', 'Second task', '')
    store.setStatus(store.overview('alice').runs.find(run => run.topicId === second.id)!.id, 'completed')
    for (let n = 0; n < 35; n++) {
      const run = store.createRun('alice', '', Date.now() + n + 1, second.id)
      store.setStatus(run, 'completed')
    }
    expect(store.overview('alice').runs.some(run => run.id === waitingRun && run.status === 'waiting')).toBe(true)
    store.answer('alice', waitingRun, 'Keep this answer on the first task')
    expect(store.dashboard(['alice']).contacts.alice.run?.topicId).toBe(first.id)
    expect(store.getRun(waitingRun)?.answer).toContain('first task')
    expect(store.overview('alice').runs.filter(run => run.topicId === second.id).every(run => !run.answer)).toBe(true)
  })

  it('lets another task run during a question and resumes a reply only after the running round', async () => {
    const dir = directory()
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let secondStarted = false, concurrent = 0, peak = 0
    const stages = [{ id: 'draft', title: 'Draft', status: 'pending' }]
    const service = new AgentService(dir, () => {}, () => async prompt => {
      concurrent++; peak = Math.max(peak, concurrent)
      try {
        if (prompt.startsWith('任务结束核对')) return JSON.stringify({ mode: 'finite', satisfied: true, endsAt: null, reason: '要求的初稿已保存', nextStep: '', completionCriteria: 'A draft' })
        if (prompt.startsWith('你是联系人，刚收到')) {
          const first = prompt.includes('First task')
          if (!first) { secondStarted = true; await gate }
          return JSON.stringify({ title: first ? 'First' : 'Second', nextStep: 'Write', question: first ? 'Who is the reader?' : '', plan: { completionCriteria: 'A draft', stages } })
        }
        if (prompt.startsWith('为联系人')) return JSON.stringify({ action: 'write', reason: 'Draft', query: '', urls: [], checkAfterMinutes: 180 })
        return JSON.stringify({ title: 'Done', body: 'Saved', nextStep: '', memories: [], question: '', progress: { judgement: 'Done', openQuestions: '', nextStep: '', reason: 'Draft saved', status: 'completed' }, delivery: { completionCriteria: 'A draft', stages: [{ ...stages[0], status: 'done' }], summary: 'Finished', section: { id: 'text', title: 'Draft', body: 'A complete draft.' } } })
      } finally { concurrent-- }
    })
    cleanup.push(async () => { release(); await service.close() })
    await service.sync([{ id: 'alice', soul: '', conversation: '', config: { provider: 'openai', baseUrl: 'https://example.com', apiKey: 'test', model: 'test', thinkingDisabledModels: [] } }])
    await service.request('savePreferences', 'alice', [{ ...DEFAULT_AGENT_SETTINGS, goal: 'Work', enabled: true, dailyCalls: 5 }])
    await service.request('assignTopic', 'alice', ['First task'])
    await vi.waitFor(() => expect(service.store.overview('alice').runs[0].status).toBe('waiting'))
    const first = service.store.overview('alice').runs[0]
    await service.request('assignTopic', 'alice', ['Second task'])
    await vi.waitFor(() => expect(secondStarted).toBe(true))
    expect(service.store.getRun(first.id)!.status).toBe('waiting')
    await service.request('answer', 'alice', [first.id, 'Adults'])
    expect(service.store.getRun(first.id)!.status).toBe('queued')
    expect(peak).toBe(1)
    release()
    await vi.waitFor(() => expect(service.store.overview('alice').topics.some(topic => topic.status === 'completed')).toBe(true))
    // The other task spent today's capacity after the answer was accepted.
    // Keep the answer queued, without starting a doomed planning request.
    expect(service.store.getRun(first.id)!.status).toBe('queued')
    expect(service.store.callCount('alice')).toBe(5)
    service.store.db.prepare('UPDATE calls SET at=?').run(Date.now() - 86400000)
    service.tick()
    await vi.waitFor(() => expect(service.store.overview('alice').topics.every(topic => topic.status === 'completed')).toBe(true))
    expect(service.store.overview('alice').reports).toHaveLength(2)
    expect(service.store.getRun(first.id)!.answer).toBe('Adults')
    expect(peak).toBe(1)
    expect(service.store.overview('alice').queuedTopicIds).toEqual([])
  })
})

it.each([false, true])('schedules the actually committed compatibility body with interval mode=%s', paceWriting => {
  const { store, path } = fixture()
  store.save('alice', { ...DEFAULT_AGENT_SETTINGS, goal: '持续写小说', enabled: true, paceWriting, dailyCalls: 100 })
  const finish = (body: string) => {
    const run = store.createRun('alice', '')
    store.saveResearch(run, { plan: { action: 'write', reason: '创作正文', query: '', urls: [], checkAfterMinutes: 180 }, searches: [], reads: [] })
    store.finish(run, { runId: run, title: '章节', body, nextStep: '继续下一节', evidence: [], createdAt: Date.now() }, [],
      { judgement: '已交付本节', reason: '保存正文', nextStep: '继续下一节', openQuestions: '', status: 'researching' })
    return run
  }
  const first = finish('陆沉拨动琴弦，灯火随之摇曳。')
  const topicId = store.getRun(first)!.topic_id!
  expect(store.deliveries.get(topicId)?.sections[0].body).toContain('灯火')
  const reopened = new AgentStore(path); cleanup.push(() => reopened.close())
  expect(reopened.nextScheduledTopic('alice', Date.now() + 100)).toBe(paceWriting ? undefined : topicId)
  const second = finish('陆沉拨动琴弦，灯火随之摇曳。')
  expect(store.detail('alice', second).events.some(e => e.kind === 'continuing')).toBe(false)
  expect(store.nextScheduledTopic('alice', Date.now() + 100)).toBeUndefined()
  const third = finish('沈砚推门进来，递上新的案卷。')
  expect(store.detail('alice', third).events.some(e => e.kind === 'continuing')).toBe(!paceWriting)
})
