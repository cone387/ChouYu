import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentService } from './service'
import { AgentStore } from './store'
import { createContactTools } from './tools'
import { routeContactChange } from './chat-changes'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import { shouldConfirmTool, validateToolArguments } from '../../shared/tools'
import type { ToolExecutionContext } from '../tools/registry'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
async function fixture(config: import('./service').AgentIdentity['config'] = null) {
  const dir = mkdtempSync(join(tmpdir(), 'contact-chat-controls-'))
  const service = new AgentService(dir, () => {})
  cleanup.push(async () => { await service.close(); rmSync(dir, { recursive: true, force: true }) })
  await service.sync([{ id: 'alice', name: '作者', soul: '', conversation: '', config }, { id: 'bob', name: '评审', soul: '', conversation: '', config: null }])
  let owner = 'alice'
  const context = { sessionId: 'chat' } as ToolExecutionContext
  const tools = createContactTools({ owner: () => owner, request: (method, id, args) => service.request(method, id, args) })
  const prepare = (name: string, args: Record<string, unknown>) => {
    const tool = tools.find(t => t.name === name)
    if (!tool) throw new Error('所需工作工具未接入')
    return tool.prepareAsync!(validateToolArguments(tool.inputSchema, args), context)
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
it('persists permissions, notifications and sharing through the same chat settings transaction without a task', async () => {
  const f = await fixture(), bob = f.store.overview('bob')
  const patch = { permissionLevel: 'sources', sources: ['https://example.com/'], searchEnabled: false, notifyProgress: false, shareDeliveries: true, readContactDeliveries: true, toolPermissionMode: 'auto', dailySearches: 10 }
  const reply = await f.route('仅访问指定网页，关闭进展通知，共享并读取共享成果，修改操作需要确认', { kind: 'settings', patch })
  expect(reply).toContain('已保存')
  expect(reply).toContain('仅指定网页')
  expect(f.store.overview('alice')).toMatchObject({ settings: patch, topics: [] })
  expect(f.store.overview('bob')).toEqual(bob)
  const reopened = new AgentStore(join(f.dir, 'agents.db'))
  try { expect(reopened.overview('alice').settings).toMatchObject(patch) } finally { reopened.close() }
})
it('does not partially save a combined patch when the required search credential is missing', async () => {
  const f = await fixture(), before = f.store.overview('alice')
  await expect(f.route('打开搜索，同时关闭进展通知', { kind: 'settings', patch: { searchEnabled: true, notifyProgress: false } })).rejects.toThrow('搜索密钥')
  expect(f.store.overview('alice').settings).toEqual(before.settings)
  expect(f.store.overview('alice').revision).toBe(before.revision)
  expect(f.store.db.prepare('SELECT COUNT(*) AS count FROM work_settings_changes').get()).toEqual({ count: 0 })
})
it('keeps an unanswered round when changing confirmation policy, but invalidates old work after source permission changes', async () => {
  const f = await fixture()
  f.store.assignTopic('alice', '研究公开资料', '')
  const run = f.store.overview('alice').runs[0]
  f.store.wait(run.id, '具体研究什么主题？')
  const saved = f.store.overview('alice')
  f.store.save('alice', { ...saved.settings, enabled: false }, Date.now(), false, saved.revision)
  await f.route('已授权工具自动执行', { kind: 'settings', patch: { toolPermissionMode: 'full' } })
  expect(f.store.getRun(run.id)?.status).toBe('waiting')
  expect(f.store.getRun(run.id)?.question).toBe('具体研究什么主题？')
  await f.route('只读这个网页', { kind: 'settings', patch: { permissionLevel: 'sources', sources: ['https://example.com/'], searchEnabled: false } })
  expect(f.store.getRun(run.id)?.status).toBe('cancelled')
  expect(() => f.store.assertLive(run.id)).toThrow()
  expect(f.store.overview('alice').settings.enabled).toBe(false)
})
it('rejects stale or foreign permission operations and rolls back permission updates when receipts cannot persist', async () => {
  const f = await fixture(), before = f.store.overview('alice')
  const args = { revision: before.revision, shareDeliveries: true, reason: '共享我的成果' }
  const foreign = await f.prepare('edit_contact_work_settings', args)
  f.setOwner('bob')
  await expect(foreign.execute()).rejects.toThrow('归属')
  f.setOwner('alice')
  const stale = await f.prepare('edit_contact_work_settings', args)
  f.store.save('alice', { ...before.settings, goal: '原方向', dailyCalls: 20 }, Date.now(), false, before.revision)
  await expect(stale.execute()).rejects.toThrow('变化')
  const saved = f.store.overview('alice')
  f.store.db.exec("CREATE TRIGGER fail_permission_receipt BEFORE INSERT ON work_settings_changes BEGIN SELECT RAISE(ABORT,'disk write failed'); END")
  await expect(f.route('共享我的成果', { kind: 'settings', patch: { shareDeliveries: true } })).rejects.toThrow('disk write failed')
  expect(f.store.overview('alice').settings).toEqual(saved.settings)
  expect(f.store.overview('alice').revision).toBe(saved.revision)
})
it('reschedules an existing paused task through chat without changing its identity or automatically resuming it', async () => {
  const f = await fixture()
  const topic = f.store.topics.create('alice', { title: '文章', goal: '写文章', constraints: '保持原要求' })
  f.store.changeTopic('alice', topic.id, topic.revision, { status: 'paused', reason: '用户暂停' })
  const schedule = { cadence: 'monthly', monthDay: 'last', times: ['09:00'] }
  const reply = await f.route('文章改成每月最后一天九点写，继续保持暂停', { kind: 'action', action: 'schedule', topicId: topic.id, schedule })
  expect(reply).toContain('已保存')
  expect(reply).toContain('暂停')
  expect(f.store.topics.get('alice', topic.id)).toMatchObject({ calendar: schedule, status: 'paused', constraints: '保持原要求' })
  expect(f.store.topics.list('alice')).toHaveLength(1)
  expect(f.store.overview('alice').runs).toEqual([])
  const current = f.store.topics.get('alice', topic.id)
  const prepared = await f.prepare('set_contact_schedule', { topicId: current.id, revision: current.revision, schedule: JSON.stringify(schedule), reason: '再保存' })
  f.store.topics.edit('alice', topic.id, current.revision, current, '新版本')
  await expect(prepared.execute()).rejects.toThrow('变化')
})
it('accepts a new calendar through the chat tool without immediately running the task', async () => {
  const f = await fixture({ provider: 'openai', baseUrl: 'https://example.com', apiKey: 'test', model: 'test', thinkingDisabledModels: [] })
  const schedule = { cadence: 'monthly', monthDay: 'last', times: ['09:00'] }
  const prepared = await f.prepare('assign_contact_task', { description: '每月最后一天九点写一篇文章', schedule: JSON.stringify(schedule) })
  const result = JSON.parse((await prepared.execute()).content)
  expect(result.saved).toBe(true)
  expect(result.message).toContain('每月最后一天')
  expect(f.store.topics.list('alice')[0].calendar).toEqual(schedule)
  expect(f.store.overview('alice').runs).toEqual([])
  await expect(prepared.execute()).rejects.toThrow('已经提交')
})
it('applies the single-description editor atomically, including clear token and ending with the original request', async () => {
  const f = await fixture()
  let topic = f.store.topics.create('alice', { title: '文章', goal: '旧目标', constraints: '' })
  topic = f.store.topics.tokenBudget('alice', topic.id, topic.revision, 5000)
  await expect(f.service.request('editTaskFromDescription', 'alice', [topic.id, topic.revision, { goal: '不应保存', tokens: -1 }, 'completed', '用户：坏参数'])).rejects.toThrow()
  expect(f.store.topics.get('alice', topic.id)).toMatchObject({ goal: '旧目标', tokenLimit: 5000, revision: topic.revision })
  await f.service.request('editTaskFromDescription', 'alice', [topic.id, topic.revision, { goal: '新目标', clearTokenLimit: true }, 'completed', '用户：取消Token上限并结束任务'])
  const saved = f.store.topics.get('alice', topic.id)
  expect(saved).toMatchObject({ goal: '新目标', status: 'completed', requestLog: '用户：取消Token上限并结束任务' })
  expect(saved.tokenLimit).toBeUndefined()
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
  { toolPermissionMode: 'invalid' }, { dailyTokenLimit: 100, clearDailyTokenLimit: true }, { maxConcurrentTasks: 0 }
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
