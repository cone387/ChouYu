import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentStore } from './store'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import { calculateEvaluations, evaluationMarkdown } from '../../shared/agent-evaluation'
const cleanup: (() => void)[] = []
afterEach(() => { while (cleanup.length) cleanup.pop()!() })
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'chat-edit-')), path = join(dir, 'agents.db')
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  const store = new AgentStore(path); cleanup.push(() => store.close())
  store.save('alice', { ...DEFAULT_AGENT_SETTINGS, goal: '评价 idea，一次可研究1–3个', enabled: true, dailyCalls: 100 })
  const id = store.overview('alice').focusTopicId!
  return { store, path, id, topic: () => store.topics.get('alice', id) }
}
it('persists future reporting requirements, stops the old run, rejects late work and survives restart', () => {
  const { store, path, id, topic } = fixture(), run = store.createRun('alice', '')
  const old = topic()
  store.editTaskFromChat('alice', id, old.revision, { constraints: '每条交付只含一个idea，不限制研究批次。' }, '一次汇报一个就行了，可以吗')
  expect(store.getRun(run)?.status).toBe('cancelled')
  expect(() => store.assertLive(run)).toThrow()
  expect(topic().goal).toBe(old.goal); expect(topic().requestLog).toContain('一次汇报一个')
  const reopened = new AgentStore(path); cleanup.push(() => reopened.close())
  expect(reopened.topics.get('alice', id).constraints).toContain('每条交付')
  const next = reopened.createRun('alice', 'x'.repeat(5000) + '最新要求')
  const input = JSON.parse(reopened.getRun(next)!.input)
  expect(input.topic.constraints).toContain('只含一个'); expect(input.conversation.endsWith('最新要求')).toBe(true)
})
it('rolls back goal, request history and cancellation if either budget is invalid', () => {
  for (const patch of [{ modelCalls: 0 }, { tokens: 0 }, { modelCalls: 300, tokens: -1 }, { modelCalls: '300' }]) {
    const { store, id, topic } = fixture(), run = store.createRun('alice', ''), before = topic()
    expect(() => store.editTaskFromChat('alice', id, before.revision, { goal: '新目标', ...patch } as any, '改目标和额度')).toThrow()
    expect(topic()).toEqual(before); expect(store.getRun(run)?.status).toBe('queued')
  }
})
it('applies explicit task budgets together and leaves contact settings alone', () => {
  const { store, id, topic } = fixture(), settings = store.overview('alice').settings
  store.editTaskFromChat('alice', id, topic().revision, { modelCalls: 500, tokens: 300000 }, '任务改为500次、30万Token')
  expect(topic().resourceBudget?.modelCalls).toBe(500); expect(topic().tokenLimit).toBe(300000)
  expect(store.overview('alice').settings).toEqual(settings)
})
it('a later direction answer preserves previously saved constraints and records the reply once', () => {
  const { store, id, topic } = fixture()
  store.editTaskFromChat('alice', id, topic().revision, { constraints: '不能修改原作者的成果' }, '保留作者原稿')
  const run = store.createRun('alice', '')
  store.saveBriefAnswer(run, '面向个人用户'); store.saveBriefAnswer(run, '面向个人用户')
  expect(topic().constraints).toBe('不能修改原作者的成果\n面向个人用户')
  expect(topic().requestLog).toContain('保留作者原稿')
  expect(topic().requestLog?.match(/面向个人用户/g)).toHaveLength(1)
})
it.each(['paused', 'completed', 'abandoned'] as const)('editing a %s task does not resume it', status => {
  const { store, id, topic } = fixture()
  store.changeTopic('alice', id, topic().revision, { status, reason: '用户设置状态' })
  store.editTaskFromChat('alice', id, topic().revision, { constraints: '使用中文' }, '以后使用中文')
  expect(topic().status).toBe(status); expect(store.nextScheduledTopic('alice')).toBeUndefined()
})
it('rejects stale versions, foreign owners, unknown fields and attempts to reduce below usage', () => {
  const { store, id, topic } = fixture(), before = topic()
  expect(() => store.editTaskFromChat('bob', id, before.revision, { title: '标题' }, '改名')).toThrow()
  expect(() => store.editTaskFromChat('alice', id, 99, { title: '标题' }, '改名')).toThrow()
  expect(() => store.editTaskFromChat('alice', id, before.revision, { dailyCalls: 999 } as any, '修改')).toThrow()
  const run = store.createRun('alice', ''); store.charge(run); store.charge(run)
  expect(() => store.editTaskFromChat('alice', id, before.revision, { modelCalls: 1 }, '改为一次')).toThrow('已使用')
  expect(topic()).toEqual(before); expect(store.getRun(run)?.status).toBe('queued')
})
function finishEvaluations(store: AgentStore, run: string) {
  const evaluations = calculateEvaluations(['甲', '乙', '丙'].map(subject => ({ subject, sourceNumbers: [], dimensions: [{ name: '可行性', score: 4, maxScore: 5, weight: 100, reason: '验收用判断' }], summary: `${subject}的结论`, risks: '未经市场验证', nextStep: '核实需求' })))
  store.finish(run, { runId: run, title: '三个评价', body: '评价已保存', nextStep: '继续评审', evaluations, evidence: [], createdAt: Date.now() }, [],
    { judgement: '评价三个对象', reason: '完成评审', nextStep: '继续评审', openQuestions: '', status: 'researching' },
    { summary: '三个对象已评价', completionCriteria: '持续评价', stages: [{ id: 'review', title: '评价', status: 'active' }], section: { id: 'batch', title: '三个评价', body: evaluationMarkdown(evaluations) } })
  return evaluations
}
it('delivers one saved evaluation per message without dropping other researched items, with restart deduplication', () => {
  const { store, path, id, topic } = fixture()
  store.editTaskFromChat('alice', id, topic().revision, { separateEvaluations: true, constraints: '一条只汇报一个idea' }, '一次汇报一个')
  const run = store.createRun('alice', ''), evaluations = finishEvaluations(store, run)
  const messages = store.notices.pending('alice').filter(n => n.runId === run)
  expect(messages).toHaveLength(3)
  messages.forEach((message, i) => {
    expect(message.content).toBe(`${evaluations[i].subject}\n\n${evaluationMarkdown([evaluations[i]])}`)
    expect(message.content.match(/综合评分/g)).toHaveLength(1)
  })
  expect(store.deliveries.get(id)?.sections[0].body).toBe(evaluationMarkdown(evaluations))
  store.notices.ack('alice', messages[0].id)
  const reopened = new AgentStore(path); cleanup.push(() => reopened.close())
  expect(reopened.notices.pending('alice').map(n => n.id)).toEqual(messages.slice(1).map(n => n.id))
  expect(() => reopened.notices.enqueue({ ...messages[1], id: 'forged', content: messages[0].content })).toThrow('不一致')
})
it('can restore combined reporting and does not rewrite previous saved messages', () => {
  const { store, id, topic } = fixture()
  store.editTaskFromChat('alice', id, topic().revision, { separateEvaluations: false }, '恢复合并汇报')
  const run = store.createRun('alice', ''); finishEvaluations(store, run)
  const before = store.notices.pending('alice')[0]
  expect(before.content.match(/综合评分/g)).toHaveLength(3)
  store.editTaskFromChat('alice', id, topic().revision, { separateEvaluations: true }, '以后一次汇报一个')
  expect(store.notices.pending('alice').find(n => n.id === before.id)?.content).toBe(before.content)
})
it('rolls back report, deliverable and all message parts if any outbox write fails', () => {
  const { store, id, topic } = fixture()
  store.editTaskFromChat('alice', id, topic().revision, { separateEvaluations: true }, '逐个交付')
  const run = store.createRun('alice', '')
  store.db.exec("CREATE TRIGGER reject_part BEFORE INSERT ON notices WHEN NEW.id LIKE '%:evaluation:1' BEGIN SELECT RAISE(ABORT,'disk failure'); END")
  expect(() => finishEvaluations(store, run)).toThrow('disk failure')
  expect(store.overview('alice').reports).toHaveLength(0)
  expect(store.deliveries.get(id)).toBeNull()
  expect(store.notices.pending('alice')).toHaveLength(0)
})
