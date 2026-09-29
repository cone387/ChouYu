import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentStore } from './store'
import { AgentRuntime } from './runtime'
import { DEFAULT_AGENT_SETTINGS, type AgentTopicProgress } from '../../shared/agents'

const cleanup: (() => void)[] = []
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close() })
const presentation = { title: '系统阅读', html: '<div id="content"></div>', css: '.body{line-height:2}', script: '' }
const progress: AgentTopicProgress = { judgement: '已交付第二章', nextStep: '继续第三章', openQuestions: '', reason: '正文已保存', status: 'researching' }
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'chouyu-style-')); cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  const store = new AgentStore(join(dir, 'agents.db')); const reader = vi.fn()
  const runtime = new AgentRuntime(store, join(dir, 'checkpoints.db'), reader)
  cleanup.push(() => { runtime.close(); store.close() })
  store.save('writer', { ...DEFAULT_AGENT_SETTINGS, goal: '写十章小说', sources: [], dailyCalls: 20 })
  const topicId = store.overview('writer').focusTopicId!, first = store.createRun('writer', '')
  store.finish(first, { runId: first, title: '第二章', body: '已保存', nextStep: progress.nextStep, evidence: [], createdAt: Date.now() }, [], progress, {
    completionCriteria: '完成十章', stages: [{ id: 'writing', title: '十章初稿', status: 'active' }], summary: '只有两章，不能称十章已交付',
    section: { id: 'ch02', title: '第二章', body: '原稿逐字保留。\n\n残谱发出微光。' }, inputs: [{ id: 'style', label: '风格', required: true, value: '玄幻' }], presentation
  })
  for (const notice of store.notices.pending('writer')) store.notices.ack('writer', notice.id)
  const start = () => { const topic = store.topics.get('writer', topicId); return store.revisePresentation('writer', topicId, topic.revision, '跟随系统亮色主题，保留正文', '', store.deliveries.get(topicId)!.version) }
  return { dir, store, runtime, reader, topicId, start }
}

describe('presentation-only execution', () => {
  it.each(['researching', 'paused', 'completed', 'abandoned'] as const)('preserves %s task state, all prose and plans with one model call and no research', async status => {
    const f = fixture()
    if (status !== 'researching') { const t = f.store.topics.get('writer', f.topicId); f.store.topics.status('writer', t.id, t.revision, status, '用户原有状态') }
    const before = f.store.topics.get('writer', f.topicId), artifact = f.store.deliveries.get(f.topicId)!, run = f.start()
    const model = vi.fn(async (prompt: string) => { expect(prompt).toContain('不续写'); return JSON.stringify({ presentation: { ...presentation, css: '.body{font-size:18px}' } }) })
    await f.runtime.execute(run, '阿笔', model, new AbortController().signal)
    expect(f.store.detail('writer', run).run.status).toBe('completed')
    expect(model).toHaveBeenCalledTimes(1); expect(f.reader).not.toHaveBeenCalled()
    const after = f.store.topics.get('writer', f.topicId), result = f.store.deliveries.get(f.topicId)!
    expect({ ...after, revision: before.revision, updatedAt: before.updatedAt }).toEqual(before)
    expect({ ...result, version: artifact.version, createdAt: artifact.createdAt, runId: artifact.runId, presentation: artifact.presentation }).toEqual(artifact)
    expect(result.version).toBe(2); expect(f.store.deliveries.get(f.topicId, 1)).toEqual(artifact)
    expect(f.store.notices.pending('writer').some(n => n.content.includes('阅读样式已保存为版本 2'))).toBe(true)
  })
  it('rejects prose injected into a style response, repairs once, and never publishes failed code', async () => {
    const f = fixture(), before = f.store.deliveries.get(f.topicId)!, run = f.start()
    const model = vi.fn(async () => JSON.stringify({ presentation, section: { id: 'ch03', title: '伪造第三章', body: '不允许' } }))
    await f.runtime.execute(run, '', model, new AbortController().signal)
    expect(f.store.detail('writer', run).run.status).toBe('failed')
    expect(model).toHaveBeenCalledTimes(2); expect(f.store.deliveries.get(f.topicId)).toEqual(before)
    expect(f.store.overview('writer').reports).toHaveLength(1)
    expect(f.store.notices.pending('writer').some(n => n.content.includes('修改未完成，原成果与正文已保留'))).toBe(true)
    const second = f.start()
    await f.runtime.execute(second, '', async () => JSON.stringify({ presentation: { ...presentation, script: 'function (' } }), new AbortController().signal)
    expect(f.store.detail('writer', second).run.status).toBe('failed'); expect(f.store.deliveries.get(f.topicId)).toEqual(before)
  })
  it('rejects stale versions, foreign tasks and concurrent work before charging the model', () => {
    const f = fixture(), t = f.store.topics.get('writer', f.topicId)
    expect(() => f.store.revisePresentation('writer', t.id, t.revision, '样式', '', 99)).toThrow('版本')
    expect(() => f.store.revisePresentation('another', t.id, t.revision, '样式', '', 1)).toThrow('找不到')
    f.start(); expect(() => f.start()).toThrow('当前工作')
    expect(f.store.callCount('writer')).toBe(0)
  })
  it('does not commit when paused while generation is in flight', async () => {
    const f = fixture(), before = f.store.deliveries.get(f.topicId), run = f.start()
    await f.runtime.execute(run, '', async () => { f.store.pause('writer'); return JSON.stringify({ presentation }) }, new AbortController().signal)
    expect(f.store.detail('writer', run).run.status).toBe('cancelled')
    expect(f.store.deliveries.get(f.topicId)).toEqual(before)
  })
  it('inspects actual saved sections separately from chat claims and from display code', () => {
    const f = fixture(), inspected = f.store.deliveries.inspect(f.topicId)
    expect(inspected.savedSectionCount).toBe(1); expect(inspected.section).toBeUndefined()
    expect(f.store.deliveries.inspect(f.topicId, 1, 'ch02').section?.body).toContain('逐字保留')
    expect(() => f.store.deliveries.inspect(f.topicId, 1, 'ch10')).toThrow('分节')
    expect(f.store.deliveries.summary(f.topicId)?.directory).toEqual([{ id: 'ch02', title: '第二章', characters: 16 }])
  })
  it('delivers requested style completion despite progress cooldown, opt-out and later task revisions', async () => {
    const f = fixture()
    for (const notice of f.store.notices.pending('writer')) f.store.notices.ack('writer', notice.id)
    const profile = f.store.profile('writer')!
    f.store.db.prepare('UPDATE profiles SET settings=? WHERE character_id=?').run(JSON.stringify({ ...JSON.parse(profile.settings), notifyProgress: false }), 'writer')
    const run = f.start()
    await f.runtime.execute(run, '', async () => JSON.stringify({ presentation }), new AbortController().signal)
    const topic = f.store.topics.get('writer', f.topicId)
    f.store.topics.status('writer', topic.id, topic.revision, 'paused', '稍后继续')
    const notice = f.store.notices.pending('writer')[0]
    expect(notice).toMatchObject({ runId: run, purpose: 'presentation' })
    f.store.notices.ack('writer', notice.id)
    expect(f.store.notices.pending('writer')).toEqual([])
  })
})
