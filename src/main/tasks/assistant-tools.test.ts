import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { openTasksStore, type TasksStore } from './store'
import { createTaskAssistantTools } from './assistant-tools'
import { shouldConfirmTool, validateToolArguments } from '../../shared/tools'
import type { ToolExecutionContext } from '../tools/registry'

let store: TasksStore
let tools: ReturnType<typeof createTaskAssistantTools>
const changed = vi.fn()
const context = {} as ToolExecutionContext
const tool = (name: string) => tools.find(item => item.name === name)!
const call = (name: string, args: Record<string, unknown> = {}) => tool(name).execute(validateToolArguments(tool(name).inputSchema, args), context)
const detail = async (id: string) => JSON.parse((await call('get_task', { taskId: id })).content)
const prepare = async (id: string, patch: Record<string, unknown> = {}, complete = false) => tool(complete ? 'complete_task' : 'update_task').prepare!({ taskId: id, expectedVersion: (await detail(id)).version, ...patch }, context)

beforeEach(() => { store = openTasksStore(':memory:'); tools = createTaskAssistantTools(() => store, changed); changed.mockClear() })
afterEach(() => { store.close(); vi.useRealTimers() })

describe('AI task queries', () => {
  test('bounds project and checklist results without losing continuation or version', async () => {
    for (let i = 0; i < 25; i++) store.createProject(`分页清单 ${i}`)
    const first = JSON.parse((await call('list_task_projects', { query: '分页清单' })).content)
    expect(first.projects).toHaveLength(20)
    expect(first.total).toBe(25)
    const last = JSON.parse((await call('list_task_projects', { query: '分页清单', offset: first.nextOffset })).content)
    expect(last.projects).toHaveLength(5)
    expect(last.nextOffset).toBeNull()
    const task = store.createTask({ title: '很多子项', checklist: Array.from({ length: 25 }, (_, i) => ({ id: String(i), title: `子项 ${i}`, done: false })) })
    const head = await detail(task.id)
    const tail = JSON.parse((await call('get_task', { taskId: task.id, checklistOffset: head.nextChecklistOffset })).content)
    expect(head.checklist).toHaveLength(20)
    expect(head.checklistTotal).toBe(25)
    expect(tail.checklist).toHaveLength(5)
    expect(tail.version).toBe(head.version)
    expect(tail.nextChecklistOffset).toBeNull()
  })
  test('filters before pagination, reports exact counts, and links each result', async () => {
    for (let i = 0; i < 24; i++) store.createTask({ title: `跟进 ${i}` })
    store.createTask({ title: '其他事情' })
    const first = await call('search_tasks', { query: '跟进' })
    const page = JSON.parse(first.content)
    expect(page.total).toBe(24)
    expect(page.nextOffset).toBe(20)
    expect(first.taskRefs?.map(ref => ref.id)).toEqual(page.items.map((item: { id: string }) => item.id))
    const last = JSON.parse((await call('search_tasks', { query: '跟进', offset: 20 })).content)
    expect(last.items).toHaveLength(4)
    expect(last.nextOffset).toBeNull()
    expect(new Set([...page.items, ...last.items].map(item => item.id)).size).toBe(24)
  })

  test('uses local execution interval, completion dates and overdue semantics', () => {
    const now = new Date(2026, 8, 22, 12).getTime()
    vi.useFakeTimers(); vi.setSystemTime(now)
    const today = new Date(2026, 8, 22).getTime(), tomorrow = new Date(2026, 8, 23).getTime()
    const spanning = store.createTask({ title: '跨日', startAt: today - 86400000, dueAt: tomorrow })
    const overdue = store.createTask({ title: '过期', dueAt: today - 1 })
    const done = store.createTask({ title: '完成', dueAt: today - 86400000 }); store.completeTask(done.id)
    store.createTask({ title: '未安排' })
    expect(store.searchTasks({ period: 'today' }, now).items.map(t => t.id)).toEqual([spanning.id])
    expect(store.searchTasks({ period: 'overdue' }, now).items.map(t => t.id)).toEqual([overdue.id])
    expect(store.searchTasks({ period: 'today', status: 'done' }, now).items.map(t => t.id)).toEqual([done.id])
    expect(store.searchTasks({ period: 'tomorrow' }, now).items.map(t => t.id)).toEqual([spanning.id])
    expect(store.searchTasks({ period: 'week', status: 'all' }, now).total).toBe(3)
  })

  test('same titles stay separate and archived projects are excluded', async () => {
    const a = store.createProject('甲'), b = store.createProject('乙')
    const first = store.createTask({ title: '周报', projectId: a.id })
    const second = store.createTask({ title: '周报', projectId: b.id })
    expect(JSON.parse((await call('search_tasks', { query: '周报' })).content).total).toBe(2)
    expect(store.searchTasks({ projectId: b.id }).items.map(t => t.id)).toEqual([second.id])
    store.archiveProject(a.id, true)
    expect(store.searchTasks().items.map(t => t.id)).toEqual([second.id])
    expect(JSON.parse((await call('list_task_projects')).content).projects.some((p: { id: string }) => p.id === a.id)).toBe(false)
    expect((await detail(first.id)).archived).toBe(true)
    expect(() => store.searchTasks({ projectId: a.id })).toThrow('归档')
  })

  test('completed search includes old matches beyond the UI default page', () => {
    const old = store.createTask({ title: '旧匹配' }); store.completeTask(old.id)
    for (let i = 0; i < 55; i++) { const t = store.createTask({ title: '其他完成' }); store.completeTask(t.id) }
    expect(store.searchTasks({ status: 'done', query: '旧匹配' }).items.map(t => t.id)).toEqual([old.id])
  })

  test('rejects invalid filters and treats SQL wildcard characters literally', () => {
    store.createTask({ title: '100%_完成' }); store.createTask({ title: '另一个' })
    expect(store.searchTasks({ query: '%_' }).total).toBe(1)
    for (const options of [{ offset: -1 }, { offset: 1.2 }, { period: 'unknown' }, { status: 'bad' }, { projectId: 'bad' }]) expect(() => store.searchTasks(options)).toThrow()
  })
})

describe('confirmed single task changes', () => {
  test('writes require approval even in full mode; read permission follows existing settings', () => {
    for (const name of ['update_task', 'complete_task']) for (const mode of ['confirm', 'auto', 'full'] as const) expect(shouldConfirmTool(tool(name), mode)).toBe(true)
    expect(shouldConfirmTool(tool('search_tasks'), 'auto')).toBe(false)
    expect(shouldConfirmTool(tool('search_tasks'), 'confirm')).toBe(true)
  })

  test('preview is read-only and shows actual reminder shifts before updating one exact task', async () => {
    const dueAt = new Date(2026, 9, 1, 12).getTime()
    const task = store.createTask({ title: '同名', dueAt, reminderTimes: [dueAt - 3600000, dueAt - 1800000] })
    const other = store.createTask({ title: '同名' })
    const prepared = await prepare(task.id, { dueAt: new Date(dueAt + 86400000).toISOString(), priority: 'high' })
    expect(prepared.preview).toContain('截止时间：')
    expect(prepared.preview).toContain('任务提醒：')
    expect(prepared.preview).toContain(task.id)
    expect(store.getTask(task.id)?.dueAt).toBe(dueAt)
    expect(changed).not.toHaveBeenCalled()
    await prepared.execute()
    expect(store.getTask(task.id)?.reminders?.map(r => r.at)).toEqual([dueAt + 86400000 - 3600000, dueAt + 86400000 - 1800000])
    expect(store.getTask(other.id)).toEqual(other)
    expect(changed).toHaveBeenCalledTimes(1)
    expect(() => prepared.execute()).toThrow('已执行')
  })

  test('clearing due date previews cancellation of reminders and recurrence', async () => {
    const dueAt = Date.now() + 86400000
    const task = store.createTask({ title: '重复', dueAt, recurrence: 'daily', remindAt: dueAt - 60000 })
    const prepared = await prepare(task.id, { dueAt: '' })
    expect(prepared.preview).toContain('取消重复')
    expect(prepared.preview).toContain('→ 无')
    await prepared.execute()
    expect(store.getTask(task.id)).toMatchObject({ dueAt: null, recurrence: 'none', remindAt: null })
  })

  test('completion warns about unfinished checklist and recurrence, creates only one next instance', async () => {
    const task = store.createTask({ title: '每天', dueAt: Date.now() + 86400000, recurrence: 'daily', checklist: [{ id: 'item', title: '检查', done: false }] })
    const prepared = await prepare(task.id, {}, true)
    expect(prepared.preview).toContain('未完成子项')
    expect(prepared.preview).toContain('下一期')
    expect(store.getTask(task.id)?.status).toBe('open')
    const result = await prepared.execute()
    expect(result.taskId).toBe(task.id)
    expect(store.getTask(task.id)?.status).toBe('done')
    expect(store.searchTasks().total).toBe(1)
    expect(() => prepared.execute()).toThrow()
  })

  test('stale read and changes during confirmation cannot overwrite newer data', async () => {
    const task = store.createTask({ title: '原始' })
    const version = (await detail(task.id)).version
    const prepared = await prepare(task.id, { title: 'AI修改' })
    store.updateTask(task.id, { title: '手动修改' })
    expect(() => prepared.execute()).toThrow('确认期间任务已变化')
    expect(() => tool('update_task').prepare!({ taskId: task.id, expectedVersion: version, title: '覆盖' }, context)).toThrow('最新版本')
    expect(store.getTask(task.id)?.title).toBe('手动修改')
    expect(changed).not.toHaveBeenCalled()
  })

  test('deletion or project archival while waiting stops the pending change', async () => {
    const project = store.createProject('归档测试')
    const task = store.createTask({ title: '归档', projectId: project.id })
    const prepared = await prepare(task.id, {}, true)
    store.archiveProject(project.id, true)
    expect(() => prepared.execute()).toThrow('确认期间任务已变化')
    const other = store.createTask({ title: '删除' })
    const deleted = await prepare(other.id, {}, true)
    store.deleteTask(other.id)
    expect(() => deleted.execute()).toThrow('不存在')
    expect(changed).not.toHaveBeenCalled()
  })

  test('invalid date, backwards interval, missing version, title-as-ID and no-op fail before approval', async () => {
    const task = store.createTask({ title: '检查', startAt: Date.parse('2026-09-24T10:00:00+08:00') })
    for (const patch of [{ dueAt: '2026-09-24' }, { dueAt: '2026-02-30T12:00:00Z' }, { dueAt: '2026-09-23T10:00:00+08:00' }, { priority: 'invalid' }, {}]) await expect(prepare(task.id, patch)).rejects.toThrow()
    expect(() => tool('complete_task').prepare!({ taskId: task.id }, context)).toThrow('最新版本')
    expect(() => call('get_task', { taskId: '检查' })).toThrow('不存在')
    expect(changed).not.toHaveBeenCalled()
  })
})
