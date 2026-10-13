import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentService } from './service'
import { AgentStore } from './store'
import { createContactTools } from './tools'
import { routeContactChange } from './chat-changes'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import { shouldConfirmTool } from '../../shared/tools'
import type { ToolExecutionContext } from '../tools/registry'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'contact-chat-controls-'))
  const service = new AgentService(dir, () => {})
  cleanup.push(async () => { await service.close(); rmSync(dir, { recursive: true, force: true }) })
  await service.sync([{ id: 'alice', name: '作者', soul: '', conversation: '', config: null }, { id: 'bob', name: '评审', soul: '', conversation: '', config: null }])
  let owner = 'alice'
  const context = { sessionId: 'chat' } as ToolExecutionContext
  const tools = createContactTools({ owner: () => owner, request: (method, id, args) => service.request(method, id, args) })
  const prepare = (name: string, args: Record<string, unknown>) => {
    const tool = tools.find(t => t.name === name)
    if (!tool) throw new Error('所需工作工具未接入')
    return tool.prepareAsync!(args, context)
  }
  const route = (message: string, plan: unknown) => routeContactChange([{ role: 'user', content: message }], {
    read: (method, args) => service.request(method, owner, args), model: async () => JSON.stringify(plan),
    execute: async call => (await (await prepare(call.name, JSON.parse(call.arguments))).execute()).content
  })
  return { service, store: service.store, dir, tools, prepare, route, setOwner: (id: string) => { owner = id } }
}
it('saves working hours through chat for a contact without tasks and retains a durable request receipt', async () => {
  const f = await fixture()
  const result = await f.route('以后只在晚上八点到十一点工作', { kind: 'settings', patch: { workStart: '20:00', workEnd: '23:00' } })
  expect(result).toContain('已保存')
  const current = f.store.overview('alice')
  expect(current.settings.workHours).toEqual({ start: '20:00', end: '23:00' })
  expect(current.topics).toEqual([])
  expect(current.settings.enabled).toBe(false)
  expect(f.store.overview('bob').settings.workHours).toBeUndefined()
  const reopened = new AgentStore(join(f.dir, 'agents.db'))
  try {
    expect(reopened.overview('alice').settings.workHours).toEqual({ start: '20:00', end: '23:00' })
    expect(reopened.db.prepare('SELECT reason FROM work_settings_changes WHERE character_id=?').get('alice')).toEqual({ reason: '以后只在晚上八点到十一点工作' })
  } finally { reopened.close() }
})
it('exposes the actual settings revision to model tools before preparing a settings change', async () => {
  const f = await fixture(), before = f.store.overview('alice')
  const result = await f.tools.find(t => t.name === 'get_contact_topics')!.execute({}, { sessionId: 'chat' } as ToolExecutionContext)
  expect(JSON.parse(result.content).revision).toBe(before.revision)
})
it('rolls back settings when recording the original request fails', async () => {
  const f = await fixture(), before = f.store.overview('alice')
  f.store.db.exec("CREATE TRIGGER fail_settings_receipt BEFORE INSERT ON work_settings_changes BEGIN SELECT RAISE(ABORT,'disk write failed'); END")
  await expect(f.route('每日调用改成50次', { kind: 'settings', patch: { dailyCalls: 50 } })).rejects.toThrow('disk write failed')
  expect(f.store.overview('alice').settings).toEqual(before.settings)
  expect(f.store.overview('alice').revision).toBe(before.revision)
})
it('applies only requested settings and rejects stale versions or changed chat ownership', async () => {
  const f = await fixture()
  f.store.save('alice', { ...DEFAULT_AGENT_SETTINGS, goal: '写作', dailyCalls: 100, dailyTokenLimit: 5000 }, Date.now(), false)
  const before = f.store.overview('alice')
  const args = { revision: before.revision, workStart: '22:00', workEnd: '06:00', reason: '改到夜间' }
  const prepared = await f.prepare('edit_contact_work_settings', args)
  expect(f.store.overview('alice').settings.workHours).toBeUndefined()
  f.store.save('alice', { ...before.settings, dailyCalls: 101 }, Date.now(), false, before.revision)
  await expect(prepared.execute()).rejects.toThrow('变化')
  const current = f.store.overview('alice')
  const other = await f.prepare('edit_contact_work_settings', { ...args, revision: current.revision })
  f.setOwner('bob')
  await expect(other.execute()).rejects.toThrow('归属')
  f.setOwner('alice')
  expect(await f.route('每日Token上限取消，其他不变', { kind: 'settings', patch: { clearDailyTokenLimit: true } })).toContain('已保存')
  expect(f.store.overview('alice').settings.dailyTokenLimit).toBeUndefined()
  expect(f.store.overview('alice').settings.dailyCalls).toBe(101)
})
it.each([
  { workStart: '20:00' }, { workStart: '25:00', workEnd: '06:00' }, { dailyCalls: null },
  { toolPermissionMode: 'full' }, { dailyTokenLimit: 100, clearDailyTokenLimit: true }, { maxConcurrentTasks: 0 }
])('rejects an invalid or unauthorized settings patch atomically: %j', async patch => {
  const f = await fixture(), before = f.store.overview('alice')
  await expect(f.route('修改工作设置', { kind: 'settings', patch })).rejects.toThrow()
  expect(f.store.overview('alice').settings).toEqual(before.settings)
  expect(f.store.overview('alice').revision).toBe(before.revision)
})
it('clears only an explicit task Token limit and retains its paused state, call budget, requirements and history', async () => {
  const f = await fixture()
  f.store.save('alice', { ...DEFAULT_AGENT_SETTINGS, goal: '写小说', dailyCalls: 50 })
  let topic = f.store.topics.list('alice')[0]
  f.store.editTaskFromChat('alice', topic.id, topic.revision, { modelCalls: 100, tokens: 5000 }, '设置任务上限')
  topic = f.store.topics.get('alice', topic.id)
  f.store.changeTopic('alice', topic.id, topic.revision, { status: 'paused', reason: '先暂停' })
  expect(await f.route('取消这个任务的Token上限', { kind: 'action', topicId: topic.id, action: 'edit', patch: { clearTokenLimit: true } })).toContain('已保存')
  const saved = f.store.topics.get('alice', topic.id)
  expect(saved.tokenLimit).toBeUndefined()
  expect(saved.status).toBe('paused')
  expect(saved.resourceBudget?.modelCalls).toBe(100)
  expect(saved.goal).toBe('写小说')
  expect(saved.requestLog).toContain('取消这个任务的Token上限')
})
it.each(['end', 'abandon'])('ends only the intended task via %s and prevents its in-flight work from committing', async action => {
  const f = await fixture()
  f.store.save('alice', { ...DEFAULT_AGENT_SETTINGS, goal: '写小说', dailyCalls: 50 })
  const topic = f.store.topics.list('alice')[0], savedRun = f.store.createRun('alice', '')
  f.store.finish(savedRun, { runId: savedRun, title: '第一章', body: '真实已交付正文', nextStep: '续写', evidence: [], createdAt: Date.now() }, [],
    { status: 'researching', judgement: '已交第一章', reason: '保存正文', nextStep: '续写', openQuestions: '' },
    { completionCriteria: '写完小说', summary: '第一章', stages: [{ id: 'novel', title: '写作', status: 'active' }], section: { id: 'ch1', title: '第一章', body: '真实已交付正文' } })
  const run = f.store.createRun('alice', '')
  const reply = await f.route('这项任务到此结束，保留成果', { kind: 'action', topicId: topic.id, action })
  expect(reply).toContain(action === 'end' ? '已结束' : '已放弃')
  expect(f.store.topics.get('alice', topic.id).status).toBe(action === 'end' ? 'completed' : 'abandoned')
  expect(f.store.getRun(run)?.status).toBe('cancelled')
  expect(() => f.store.assertLive(run)).toThrow()
  expect(f.store.topics.detail('alice', topic.id).changes[0].reason).toContain('这项任务到此结束')
  expect(f.store.deliveries.get(topic.id)?.sections[0].body).toBe('真实已交付正文')
  expect(f.store.detail('alice', savedRun).report?.body).toBe('真实已交付正文')
  const edited = await f.route('取消这个任务的Token上限', { kind: 'action', topicId: topic.id, action: 'edit', patch: { clearTokenLimit: true } })
  expect(edited).not.toContain('后续按新要求执行')
  expect(edited).toContain(action === 'end' ? '已结束' : '已放弃')
})
it('deletion requires confirmation, previews the real scope, and returns a saved deletion receipt', async () => {
  const f = await fixture()
  f.store.save('alice', { ...DEFAULT_AGENT_SETTINGS, goal: '写小说', dailyCalls: 50 })
  const topic = f.store.topics.list('alice')[0]
  const tool = f.tools.find(t => t.name === 'update_contact_topic')!
  expect(shouldConfirmTool(tool, 'full')).toBe(true)
  const prepared = await f.prepare(tool.name, { topicId: topic.id, revision: topic.revision, action: 'delete', reason: '删除小说任务' })
  expect(prepared.confirmationRequired).toBe(true)
  expect(prepared.preview).toContain('成果')
  expect(prepared.preview).toContain('历史')
  expect(f.store.topics.get('alice', topic.id)).toBeDefined()
  const receipt = JSON.parse((await prepared.execute()).content)
  expect(receipt.deleted).toBe(true)
  expect(f.store.topics.list('alice')).toEqual([])
  await expect(prepared.execute()).rejects.toThrow('已执行')
})
