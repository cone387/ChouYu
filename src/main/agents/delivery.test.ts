import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentStore } from './store'
import { AgentRuntime } from './runtime'
import { AgentService } from './service'
import { evidenceFromText } from './sources'
import { DEFAULT_AGENT_SETTINGS, type AgentTopicProgress } from '../../shared/agents'
import { deliveryMarkdown, validateDeliveryUpdate, type DeliveryUpdate } from '../../shared/agent-delivery'
import { contactCommunicationRules } from '../../shared/contact-communication'

const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'chouyu-delivery-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  let store = new AgentStore(join(dir, 'agents.db'))
  const reader = vi.fn(async () => evidenceFromText('https://example.com/', '真实资料仅说明个人免费，团队需求尚未验证。'.repeat(10)))
  let runtime = new AgentRuntime(store, join(dir, 'checkpoints.db'), reader)
  cleanups.push(() => { runtime.close(); store.close() })
  store.save('alice', { ...DEFAULT_AGENT_SETTINGS, goal: '完成五章小说初稿', sources: [], dailyCalls: 48 })
  return { get store() { return store }, get runtime() { return runtime }, reader, dir,
    reopen() { runtime.close(); store.close(); store = new AgentStore(join(dir, 'agents.db')); runtime = new AgentRuntime(store, join(dir, 'checkpoints.db'), reader); store.recover() } }
}
const progress: AgentTopicProgress = { judgement: '正在推进', openQuestions: '', nextStep: '继续下一章', reason: '已交付正文', status: 'researching' }
const plan = { action: 'write', reason: '继续创作', urls: [], query: '', checkAfterMinutes: 180 }
function delivery(n = 1, body = `第${n}章正文`): DeliveryUpdate {
  return { completionCriteria: '完成五章且人物设定一致', summary: '主角林音，使用琴音修炼。保留第一章的断弦伏笔。',
    stages: Array.from({ length: 5 }, (_, i) => ({ id: `chapter${i + 1}`, title: `第${i + 1}章`, status: i < n ? 'done' : 'pending' })),
    section: { id: `chapter${n}`, title: `第${n}章`, body } }
}
const draft = (update: DeliveryUpdate, question = '', p = progress) => JSON.stringify({ title: update.section?.title ?? '排版调整', body: '已更新本轮成果', nextStep: p.nextStep, memories: [], question, progress: p, delivery: update })
async function write(f: ReturnType<typeof fixture>, n: number) {
  const run = f.store.createRun('alice', '')
  await f.runtime.execute(run, '', async prompt => JSON.stringify(prompt.startsWith('为联系人') ? plan : JSON.parse(draft(delivery(n)))), new AbortController().signal)
  expect(f.store.detail('alice', run).run.status).toBe('completed')
  return run
}

describe('durable deliverables', () => {
  it('applies the common policy and verified artifact contract to a new non-preset persona', async () => {
    const f = fixture(), owner = 'custom-map-author'
    f.store.save(owner, { ...DEFAULT_AGENT_SETTINGS, goal: '写一份地图导览', dailyCalls: 20 })
    const run = f.store.createRun(owner, '')
    await f.runtime.execute(run, '你是绘图师小岚，习惯简洁说明。', async prompt => {
      if (prompt.startsWith('为联系人')) return JSON.stringify(plan)
      expect(prompt).toContain(contactCommunicationRules)
      expect(prompt).toContain('绘图师小岚')
      return draft(delivery(1, '沿河向北，第二座桥旁就是入口。'))
    }, new AbortController().signal)
    expect(f.store.detail(owner, run).run.status).toBe('completed')
    const notice = f.store.notices.pending(owner)[0]
    expect(notice.communication).toEqual({ version: 1, characterId: owner, intent: 'delivery', source: {
      kind: 'task', topicId: f.store.overview(owner).focusTopicId, runId: run, artifact: { version: 1, sectionId: 'chapter1' }
    } })
    expect(f.store.notices.pending('alice')).toEqual([])
    expect(() => f.store.notices.enqueue({ ...notice, id: 'forged-body', content: '没有保存的另一份稿件' })).toThrow('已保存成果不一致')
    expect(() => f.store.notices.enqueue({ ...notice, id: 'wrong-owner', characterId: 'alice' })).toThrow('不匹配')
    expect(() => f.store.notices.enqueue({ ...notice, id: 'wrong-version', communication: { ...notice.communication!, source: {
      kind: 'task', topicId: notice.topicId, runId: run, artifact: { version: 99, sectionId: 'chapter1' }
    } } })).toThrow('已保存成果不一致')
    expect(f.store.notices.pending(owner)).toHaveLength(1)
  })
  it('delivers saved prose rather than internal status, preserving each unsent revision after restart', async () => {
    const f = fixture()
    const firstBody = '陆沉推开律堂的门。\n\n弦音在石阶上回荡。'
    const internal = { ...progress, judgement: 'arc2ch04a转done，arc2ch04b为active', nextStep: '更新arc2ch05a' }
    const run = f.store.createRun('alice', '')
    await f.runtime.execute(run, '', async prompt => prompt.startsWith('为联系人') ? JSON.stringify(plan) : draft(delivery(1, firstBody), '', internal), new AbortController().signal)
    expect(f.store.detail('alice', run).run.status).toBe('completed')
    const next = f.store.createRun('alice', '')
    const revised = delivery(1, '陆沉停在门前。\n\n他先听见了弦音。')
    f.store.finish(next, { runId: next, title: '修改说明', body: '本轮改写第一章', nextStep: internal.nextStep, evidence: [], createdAt: Date.now() }, [], internal, revised)
    f.reopen()
    const notices = f.store.notices.pending('alice')
    expect(notices.map(n => n.content)).toEqual([`第1章\n\n${firstBody}`, `第1章\n\n${revised.section!.body}`])
    for (const notice of notices) {
      expect(notice.update).toBeUndefined()
      expect(notice.content).not.toMatch(/arc2ch|本轮|active|done|接下来/)
      const saved = f.store.db.prepare('SELECT value FROM delivery_versions WHERE run_id=?').get(notice.runId) as { value: string }
      expect(notice.content).toContain(JSON.parse(saved.value).sections[0].body)
      f.store.notices.ack('alice', notice.id)
    }
    f.reopen()
    expect(f.store.notices.pending('alice')).toEqual([])
  })
  it('does not resend identical prose for internal state changes and never announces a rejected delivery', async () => {
    const f = fixture()
    await write(f, 1)
    const notice = f.store.notices.pending('alice')[0]
    f.store.notices.ack('alice', notice.id)
    const run = f.store.createRun('alice', '')
    const report = { runId: run, title: '新判断', body: '只是改了日志', nextStep: progress.nextStep, evidence: [], createdAt: Date.now() }
    f.store.finish(run, report, [], { ...progress, judgement: '再次确认完成' }, delivery(1))
    expect(f.store.notices.pending('alice')).toEqual([])
    const rejected = f.store.createRun('alice', '')
    expect(() => f.store.finish(rejected, { ...report, runId: rejected }, [], progress, delivery(2, 'x'.repeat(10001)))).toThrow('成果分节无效')
    expect(f.store.notices.pending('alice')).toEqual([])
    expect(f.store.detail('alice', rejected).report).toBeFalsy()
  })
  it('delivers idea and review bodies intact, including task-relevant code and tables', () => {
    const f = fixture()
    for (const body of ['## 想法\n\n帮助开发者理解 active/done 状态。\n\n```ts\nconst active = true\n```', '我的建议是先验证付费意愿。\n\n| 维度 | 分数 |\n| --- | --- |\n| 需求 | 3 |\n\n这是主观判断，尚无访谈证据。']) {
      const run = f.store.createRun('alice', '')
      f.store.finish(run, { runId: run, title: '内部摘要', body: '不应发给用户', nextStep: '下轮内部计划', evidence: [], createdAt: Date.now() }, [], progress, delivery(1, body))
      const notice = f.store.notices.pending('alice')[0]
      expect(notice.content).toBe(`第1章\n\n${body}`)
      f.store.notices.ack('alice', notice.id)
    }
  })
  it('versions presentation separately, inherits it for new chapters and never rewrites prose for style changes', async () => {
    const f = fixture(), topicId = f.store.overview('alice').focusTopicId!
    const first = { ...delivery(), presentation: { title: '书页', html: '<div id="content"></div>', css: '.body{line-height:2}', script: '' }, inputs: [{ id: 'genre', label: '题材', value: '奇幻', required: true }] }
    const run = f.store.createRun('alice', '')
    await f.runtime.execute(run, '', async prompt => prompt.startsWith('为联系人') ? JSON.stringify(plan) : draft(first), new AbortController().signal)
    const original = f.store.deliveries.get(topicId)!
    f.reopen()
    const topic = f.store.topics.get('alice', topicId)
    const revision = f.store.reviseTopic('alice', topicId, topic.revision, '只调整排版，保留正文', '')
    const update = { completionCriteria: first.completionCriteria, stages: first.stages, summary: first.summary, presentation: { ...first.presentation, css: '.body{line-height:2.2}' } }
    await f.runtime.execute(revision, '', async prompt => {
      if (prompt.startsWith('为联系人')) return JSON.stringify(plan)
      expect(prompt).toContain(first.presentation.css)
      return draft(update)
    }, new AbortController().signal)
    expect(f.store.detail('alice', revision).run.status).toBe('completed')
    expect(f.store.deliveries.get(topicId)!.sections).toEqual(original.sections)
    expect(f.store.deliveries.get(topicId)!.inputs).toEqual(first.inputs)
    expect(f.store.deliveries.get(topicId, 1)!.presentation).toEqual(first.presentation)
    await write(f, 2)
    expect(f.store.deliveries.get(topicId)!.presentation).toEqual(update.presentation)
    expect(f.store.deliveries.get(topicId)!.sections).toHaveLength(2)
  })
  it('does not create a first delivery or finish stages from presentation alone', () => {
    const f = fixture(), run = f.store.createRun('alice', '')
    const update = delivery(); delete update.section
    update.presentation = { title: '未交付', html: '', css: '', script: '' }
    expect(() => f.store.finish(run, { runId: run, title: '样式', body: '样式', nextStep: '继续', evidence: [], createdAt: Date.now() }, [], progress, update)).toThrow('首次交付')
    expect(f.store.overview('alice').reports).toHaveLength(0)
  })
  it('accumulates five chapters across restart and revises an early chapter using its original text', async () => {
    const f = fixture(), topicId = f.store.overview('alice').focusTopicId!
    for (let n = 1; n <= 5; n++) { await write(f, n); if (n === 2) f.reopen() }
    expect(f.store.deliveries.get(topicId)?.sections.map(s => s.id)).toEqual(['chapter1', 'chapter2', 'chapter3', 'chapter4', 'chapter5'])
    const topic = f.store.topics.get('alice', topicId)
    const run = f.store.reviseTopic('alice', topicId, topic.revision, '第一章改用女主视角，保留断弦伏笔', '')
    const input = JSON.parse(f.store.getRun(run)!.input)
    expect(input.delivery.directory).toHaveLength(5)
    expect(input.delivery.sections.some((s: { id: string }) => s.id === 'chapter1')).toBe(false)
    await f.runtime.execute(run, '', async prompt => {
      if (prompt.startsWith('为联系人')) return JSON.stringify({ ...plan, sectionId: 'chapter1' })
      expect(prompt).toContain('第1章正文'); expect(prompt).toContain('女主视角')
      return draft({ ...delivery(5), section: { id: 'chapter1', title: '第一章：断弦', body: '林音拾起断弦，听见远处的回声。' } })
    }, new AbortController().signal)
    expect(f.store.detail('alice', run).run.status).toBe('completed')
    const latest = f.store.deliveries.get(topicId)!
    expect(latest.version).toBe(6); expect(latest.sections).toHaveLength(5)
    expect(latest.sections[0].body).toContain('林音拾起断弦')
    expect(f.store.deliveries.get(topicId, 5)!.sections[0].body).toBe('第1章正文')
    expect(latest.sections[4].body).toBe('第5章正文')
    const exported = deliveryMarkdown(topic.title, latest)
    expect(exported).toContain('版本 6'); expect(exported).toContain('第5章正文')
    expect(f.store.overview('alice').settings.enabled).toBe(false)
    expect(f.reader).not.toHaveBeenCalled()
  })
  it('revises a durable answer once, keeps evidence, and does not publish the pre-answer draft', async () => {
    const f = fixture()
    f.store.save('alice', { ...DEFAULT_AGENT_SETTINGS, goal: '研究团队需求', sources: ['https://example.com/'], dailyCalls: 8 })
    const topicId = f.store.overview('alice').focusTopicId!, run = f.store.createRun('alice', '')
    await f.runtime.execute(run, '', async () => draft(delivery(), '只看团队吗？'), new AbortController().signal)
    expect(f.store.deliveries.get(topicId)).toBeNull()
    f.reopen(); f.store.answer('alice', run, '是，只看团队')
    const model = vi.fn(async (prompt: string) => {
      expect(prompt).toContain('是，只看团队'); expect(prompt).toContain('真实资料')
      return draft({ ...delivery(), section: { id: 'research', title: '团队需求', body: '仅面向团队；资料 [1] 尚不能证明团队付费意愿。' } }, '', { ...progress, status: 'needs_evidence', reason: '按回复排除个人市场，需补团队证据' })
    })
    await f.runtime.execute(run, '', model, new AbortController().signal)
    const result = f.store.deliveries.get(topicId)!
    expect(result.sections[0].body).toContain('仅面向团队')
    expect(result.sections[0].sources?.[0].url).toBe('https://example.com/')
    expect(deliveryMarkdown('研究', result)).toContain('[1] example.com: https://example.com/')
    expect(model).toHaveBeenCalledTimes(1); expect(f.reader).toHaveBeenCalledTimes(1)
    expect(f.store.callCount('alice')).toBe(2)
    f.store.finish(run, f.store.detail('alice', run).report!, [], progress, delivery())
    expect(f.store.deliveries.get(topicId)!.version).toBe(1)
  })
  it('rolls back report, progress, memory and artifact together on disk failure', () => {
    const f = fixture(), run = f.store.createRun('alice', ''), topicId = f.store.overview('alice').focusTopicId!
    const before = f.store.topics.detail('alice', topicId)
    f.store.db.exec("CREATE TRIGGER fail_delivery BEFORE INSERT ON delivery_versions BEGIN SELECT RAISE(ABORT, 'disk failure'); END;")
    expect(() => f.store.finish(run, { runId: run, title: '正文', body: '内容', nextStep: '继续', evidence: [], createdAt: Date.now() }, ['新记忆'], progress, delivery())).toThrow('disk failure')
    expect(f.store.topics.detail('alice', topicId)).toEqual(before)
    expect(f.store.overview('alice').reports).toHaveLength(0)
    expect(f.store.overview('alice').memories).toHaveLength(0)
    expect(f.store.deliveries.get(topicId)).toBeNull()
    expect(f.store.notices.pending('alice')).toHaveLength(0)
  })
  it('rejects premature completion, stale feedback, unavailable budget and late output', async () => {
    const f = fixture(), topic = f.store.overview('alice').topics[0]
    let run = f.store.createRun('alice', '')
    expect(() => f.store.finish(run, { runId: run, title: '正文', body: '内容', nextStep: '', evidence: [], createdAt: Date.now() }, [], { ...progress, status: 'completed' }, delivery(1))).toThrow('阶段尚未完成')
    f.store.pause('alice')
    expect(() => f.store.reviseTopic('alice', topic.id, 999, '修改', '')).toThrow('变化')
    f.store.save('alice', { ...DEFAULT_AGENT_SETTINGS, goal: '写作', sources: [], dailyCalls: 2 })
    run = f.store.createRun('alice', ''); f.store.charge(run); f.store.charge(run); f.store.wait(run, '需要答复')
    expect(() => f.store.answer('alice', run, '答复')).toThrow('额度')
    expect(f.store.detail('alice', run).run.status).toBe('waiting')
    f.store.pause('alice')
    const revision = f.store.topics.get('alice', topic.id).revision
    expect(() => f.store.reviseTopic('alice', topic.id, revision, '修改', '')).toThrow('上限')
    expect(f.store.topics.get('alice', topic.id).revision).toBe(revision)
    f.store.save('alice', { ...DEFAULT_AGENT_SETTINGS, goal: '写作', sources: [], dailyCalls: 48 })
    run = f.store.createRun('alice', '')
    await f.runtime.execute(run, '', async prompt => { if (prompt.startsWith('为联系人')) return JSON.stringify(plan); f.store.pause('alice'); return draft(delivery()) }, new AbortController().signal)
    expect(f.store.deliveries.get(topic.id)).toBeNull()
    expect(f.store.detail('alice', run).run.status).toBe('cancelled')
  })
  it('resumes interruption in feedback processing without rereading or duplicating versions', async () => {
    const f = fixture(), run = f.store.createRun('alice', '')
    await f.runtime.execute(run, '', async prompt => prompt.startsWith('为联系人') ? JSON.stringify(plan) : draft(delivery(), '主角性别？'), new AbortController().signal)
    f.store.answer('alice', run, '女性')
    const controller = new AbortController()
    await expect(f.runtime.execute(run, '', async () => { controller.abort(); throw new Error('interrupted') }, controller.signal)).rejects.toThrow()
    f.reopen()
    const model = vi.fn(async prompt => { expect(prompt).toContain('女性'); return draft(delivery(1, '她听见琴音。')) })
    await f.runtime.execute(run, '', model, new AbortController().signal)
    expect(model).toHaveBeenCalledTimes(1)
    expect(f.store.deliveries.get(f.store.overview('alice').focusTopicId!)?.version).toBe(1)
    expect(f.store.callCount('alice')).toBe(4)
  })
  it('enforces ownership at the service boundary and cascades deletion', async () => {
    const f = fixture(); await write(f, 1)
    const service = new AgentService(f.dir, () => {})
    cleanups.push(() => service.close())
    await service.sync(['alice', 'bob'].map(id => ({ id, soul: '', conversation: '', config: null })))
    const topicId = f.store.overview('alice').focusTopicId!
    await expect(service.request('delivery', 'bob', [topicId])).rejects.toThrow('找不到')
    await expect(service.request('delivery', 'alice', [topicId, 999])).rejects.toThrow('版本')
    expect(await service.request('delivery', 'alice', [topicId, 1])).toHaveProperty('version', 1)
    await service.remove('alice')
    expect(f.store.deliveries.get(topicId)).toBeNull()
  })
  it('migrates v5 without inventing artifacts and isolates topic-specific memory', async () => {
    const f = fixture(); await write(f, 1)
    f.store.db.exec('DROP TABLE delivery_versions; PRAGMA user_version=5;')
    f.reopen()
    const topicId = f.store.overview('alice').focusTopicId!
    expect(f.store.deliveries.get(topicId)).toBeNull()
    expect(f.store.overview('alice').reports).toHaveLength(1)
    const other = f.store.topics.create('alice', { title: '无关项目', goal: '研究市场', constraints: '' })
    const otherRun = f.store.createRun('alice', '', Date.now(), other.id)
    f.store.remember('alice', '另一个项目的敏感背景', otherRun); f.store.pause('alice')
    f.store.remember('alice', '通用偏好')
    const run = f.store.createRun('alice', '', Date.now(), topicId)
    const input = JSON.parse(f.store.getRun(run)!.input)
    expect(JSON.stringify(input.memories)).not.toContain('敏感背景')
    expect(JSON.stringify(input.memories)).toContain('通用偏好')
  })
  it('rejects malformed stages and nonexistent section references before changing artifacts', async () => {
    expect(() => validateDeliveryUpdate({ ...delivery(), stages: [{ id: 'x', title: 'a', status: 'done' }, { id: 'x', title: 'b', status: 'done' }] })).toThrow('阶段')
    const f = fixture(), run = f.store.createRun('alice', '')
    await f.runtime.execute(run, '', async () => JSON.stringify({ ...plan, sectionId: 'invented' }), new AbortController().signal)
    expect(f.store.detail('alice', run).run.status).toBe('failed')
    expect(f.store.deliveries.get(f.store.overview('alice').focusTopicId!)).toBeNull()
  })
  it.each(['chapter2', '第二章', { id: 'chapter2' }, ['chapter2']])('corrects a new chapter reference %j and keeps the old chapter intact', async sectionId => {
    const f = fixture(); await write(f, 1)
    const topicId = f.store.overview('alice').focusTopicId!
    const before = f.store.deliveries.get(topicId)!
    const run = f.store.createRun('alice', '')
    const model = vi.fn(async (prompt: string) => {
      if (prompt.startsWith('为联系人修正')) {
        expect(prompt).toContain('chapter1')
        expect(prompt).toContain('新增章节')
        return JSON.stringify(plan)
      }
      if (prompt.startsWith('为联系人')) return JSON.stringify({ ...plan, sectionId })
      return draft(delivery(2))
    })
    await f.runtime.execute(run, '', model, new AbortController().signal)
    expect(f.store.detail('alice', run).run.status).toBe('completed')
    expect(model).toHaveBeenCalledTimes(3)
    expect(f.store.callCount('alice')).toBe(5)
    expect(f.store.deliveries.get(topicId)?.sections[0]).toEqual(before.sections[0])
    expect(f.store.deliveries.get(topicId)?.sections[1].id).toBe('chapter2')
    expect(f.store.detail('alice', run).events.some(e => e.kind === 'plan-repair')).toBe(true)
  })
  it('stops after one unsuccessful malformed-reference repair without changing existing text', async () => {
    const f = fixture(); await write(f, 1)
    const topicId = f.store.overview('alice').focusTopicId!, before = f.store.deliveries.get(topicId)
    const run = f.store.createRun('alice', '')
    const model = vi.fn(async () => JSON.stringify({ ...plan, sectionId: '第二章' }))
    await f.runtime.execute(run, '', model, new AbortController().signal)
    expect(model).toHaveBeenCalledTimes(2)
    expect(f.store.detail('alice', run).run.error).toContain('规划修正后分节 ID 格式仍无效')
    expect(f.store.detail('alice', run).run.error).not.toContain('检查模型配置')
    expect(f.store.deliveries.get(topicId)).toEqual(before)
  })
  it('does not spend a repair call when the task cannot afford both repair and execution', async () => {
    const f = fixture(), topic = f.store.overview('alice').topics[0]
    f.store.setTaskBudget('alice', topic.id, topic.revision, { modelCalls: 2 })
    const run = f.store.createRun('alice', '')
    const model = vi.fn(async () => JSON.stringify({ ...plan, sectionId: 'chapter1' }))
    await f.runtime.execute(run, '', model, new AbortController().signal)
    expect(model).toHaveBeenCalledTimes(1)
    expect(f.store.taskCallCount('alice', topic.id)).toBe(1)
    expect(f.store.topics.get('alice', topic.id).status).toBe('paused')
    expect(f.store.deliveries.get(topic.id)).toBeNull()
  })
  it('preserves an unanswered revision failure as feedback for a new run', async () => {
    const f = fixture(); await write(f, 1)
    const run = f.store.createRun('alice', '')
    await f.runtime.execute(run, '', async prompt => prompt.startsWith('为联系人') ? JSON.stringify(plan) : draft(delivery(2), '第二章用谁的视角？'), new AbortController().signal)
    f.store.answer('alice', run, '林音的第一人称')
    await f.runtime.execute(run, '', async () => { throw new Error('provider unavailable') }, new AbortController().signal)
    expect(f.store.detail('alice', run).run.status).toBe('failed')
    f.reopen()
    const retry = f.store.createRun('alice', ''), input = JSON.parse(f.store.getRun(retry)!.input)
    expect(input.feedback).toContain('林音的第一人称'); expect(input.baseline).toBeUndefined()
    await f.runtime.execute(retry, '', async prompt => {
      expect(prompt).toContain('林音的第一人称')
      return prompt.startsWith('为联系人') ? JSON.stringify(plan) : draft(delivery(2, '我抚过琴弦，走进山门。'))
    }, new AbortController().signal)
    expect(f.store.deliveries.get(f.store.overview('alice').focusTopicId!)?.sections).toHaveLength(2)
  })
  it('does not replace an older section that the model has not read', async () => {
    const f = fixture(); for (let n = 1; n <= 5; n++) await write(f, n)
    const topic = f.store.overview('alice').topics[0]
    const run = f.store.reviseTopic('alice', topic.id, topic.revision, '修订第一章', '')
    await f.runtime.execute(run, '', async prompt => prompt.startsWith('为联系人') ? JSON.stringify(plan) : draft(delivery(1, '未读正文的猜测')), new AbortController().signal)
    expect(f.store.detail('alice', run).run.status).toBe('failed')
    expect(f.store.deliveries.get(topic.id)?.version).toBe(5)
    expect(f.store.deliveries.get(topic.id)?.sections[0].body).toBe('第1章正文')
    const answerRun = f.store.createRun('alice', '')
    await f.runtime.execute(answerRun, '', async prompt => prompt.startsWith('为联系人') ? JSON.stringify(plan) : draft(delivery(5), '如何修改？'), new AbortController().signal)
    f.store.answer('alice', answerRun, '修改第一章')
    await f.runtime.execute(answerRun, '', async () => draft(delivery(1, '回答后仍未读取旧稿的猜测')), new AbortController().signal)
    expect(f.store.detail('alice', answerRun).run.status).toBe('failed')
    expect(f.store.deliveries.get(topic.id)?.version).toBe(5)
  })
  it('loads an explicitly selected old section even with source-only permission', async () => {
    const f = fixture(); for (let n = 1; n <= 5; n++) await write(f, n)
    f.store.save('alice', { ...DEFAULT_AGENT_SETTINGS, goal: '继续修订', permissionLevel: 'sources', sources: ['https://example.com/'], dailyCalls: 48 })
    const topic = f.store.overview('alice').topics[0]
    const run = f.store.reviseTopic('alice', topic.id, topic.revision, '调整第一章', '', 'chapter1')
    const model = vi.fn(async (prompt: string) => { expect(prompt).toContain('第1章正文'); return draft(delivery(1, '读取原稿后修订的第一章')) })
    await f.runtime.execute(run, '', model, new AbortController().signal)
    expect(model).toHaveBeenCalledTimes(1)
    expect(f.store.deliveries.get(topic.id)?.sections[0].body).toBe('读取原稿后修订的第一章')
    expect(f.store.deliveries.get(topic.id)?.sections).toHaveLength(5)
    expect(() => f.store.reviseTopic('alice', topic.id, f.store.topics.get('alice', topic.id).revision, '修改', '', 'foreign')).toThrow('找不到')
    const wrong = f.store.reviseTopic('alice', topic.id, f.store.topics.get('alice', topic.id).revision, '只修改第一章', '', 'chapter1')
    expect(() => f.store.finish(wrong, { runId: wrong, title: '错误分节', body: '不应提交', nextStep: '继续', evidence: [], createdAt: Date.now() }, [], progress, delivery(2))).toThrow('指定分节')
    expect(f.store.deliveries.get(topic.id)?.version).toBe(6)
  })
})
