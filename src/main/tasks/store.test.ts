import { mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { openTasksStore } from './store'

const directories: string[] = []
const tempFile = (name: string) => {
  const directory = mkdtempSync(join(tmpdir(), 'chouyu-tasks-'))
  directories.push(directory)
  return join(directory, name)
}
// 断言失败时 store 未 close,Windows 句柄延迟释放会让 rmSync 抛 EPERM;逐目录容错避免级联拖垮后续测试
afterEach(() => {
  while (directories.length > 0) {
    const directory = directories.pop()!
    try { rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }) } catch { /* 留给系统临时目录清理 */ }
  }
})

describe('TasksStore', () => {
  test('打开即建表,重复打开保留数据', () => {
    const file = tempFile('tasks.db')
    const store = openTasksStore(file)
    const project = store.createProject('项目 A')
    const task = store.createTask({ title: '  写周报  ', priority: 'high', projectId: project.id })
    expect(task.title).toBe('写周报')
    expect(task.priority).toBe('high')
    expect(task.status).toBe('open')
    expect(task.recurrence).toBe('none')
    store.close()
    const reopened = openTasksStore(file)
    expect(reopened.listTasks().open.map(item => item.title)).toEqual(['写周报'])
    expect(reopened.listProjects().map(item => item.name)).toEqual(['项目 A'])
    reopened.close()
  })

  test('重复任务完成后生成下一实例', () => {
    const store = openTasksStore(tempFile('tasks.db'))
    const dueAt = Date.now() + 24 * 60 * 60_000
    const task = store.createTask({ title: '每日站会', dueAt, recurrence: 'daily' })
    const done = store.completeTask(task.id)
    expect(done.status).toBe('done')
    const open = store.listTasks().open
    expect(open).toHaveLength(1)
    expect(open[0].title).toBe('每日站会')
    expect(open[0].dueAt).toBe(dueAt + 24 * 60 * 60_000)
    expect(open[0].recurrence).toBe('daily')
    store.close()
  })

  test('迟到完成的重复任务跳过已过期周期', () => {
    const store = openTasksStore(tempFile('tasks.db'))
    const stale = new Date(2026, 0, 15, 9, 0).getTime()
    const task = store.createTask({ title: '周报', dueAt: stale, remindAt: stale - 60 * 60_000, recurrence: 'weekly' })
    const done = store.completeTask(task.id)
    const next = store.listTasks().open[0]
    expect(next.dueAt).not.toBeNull()
    expect(next.dueAt!).toBeGreaterThan(done.completedAt ?? 0)
    expect(next.remindAt).toBe(next.dueAt! - 60 * 60_000)
    store.close()
  })

  test('项目名唯一,重命名与归档', () => {
    const store = openTasksStore(tempFile('tasks.db'))
    const project = store.createProject('项目 A')
    expect(() => store.createProject('项目 A')).toThrow('同名项目已存在')
    expect(store.renameProject(project.id, ' 项目 B ').name).toBe('项目 B')
    expect(() => store.renameProject('missing', 'x')).toThrow()
    expect(store.archiveProject(project.id, true).archivedAt).toBeGreaterThan(0)
    expect(store.archiveProject(project.id, false).archivedAt).toBeUndefined()
    store.close()
  })

  test('任务输入校验:空标题、非法优先级、未知项目', () => {
    const store = openTasksStore(tempFile('tasks.db'))
    expect(() => store.createTask({ title: '   ' })).toThrow('标题')
    expect(() => store.createTask({ title: 'x', priority: 'urgent' as never })).toThrow('优先级')
    expect(() => store.createTask({ title: 'x', projectId: 'missing' })).toThrow('项目')
    store.close()
  })

  test('更新、完成、删除', () => {
    const store = openTasksStore(tempFile('tasks.db'))
    const task = store.createTask({ title: '任务' })
    expect(store.updateTask(task.id, { title: '改名', note: '备注', priority: 'low' }).title).toBe('改名')
    expect(() => store.updateTask('missing', { title: 'x' })).toThrow()
    const done = store.completeTask(task.id)
    expect(done.status).toBe('done')
    expect(done.completedAt).toBeGreaterThan(0)
    const second = store.createTask({ title: '待删' })
    store.deleteTask(second.id)
    expect(store.listTasks().open).toHaveLength(0)
    expect(store.listTasks().done).toHaveLength(1)
    store.close()
  })

  test('完成列表最多返回 50 条并带总数', () => {
    const store = openTasksStore(tempFile('tasks.db'))
    for (let index = 0; index < 55; index += 1) {
      const task = store.createTask({ title: `任务 ${index}` })
      store.completeTask(task.id)
    }
    const result = store.listTasks()
    expect(result.done).toHaveLength(50)
    expect(result.totalDone).toBe(55)
    expect(result.done[0].title).toBe('任务 54')
    store.close()
  })

  test('完成历史加载更多，并在全部历史中按关键词和优先级搜索', () => {
    const store = openTasksStore(tempFile('tasks.db'))
    for (let index = 0; index < 65; index++) {
      const task = store.createTask({ title: `历史 ${index}`, note: index === 0 ? '唯一早期记录 100%_ABC' : '', priority: index === 0 ? 'high' : 'low' })
      store.completeTask(task.id)
    }
    expect(store.listTasks({ doneLimit: 100 }).done).toHaveLength(65)
    const found = store.listTasks({ doneQuery: '100%_abc', donePriorities: ['high'] })
    expect(found.done.map(task => task.title)).toEqual(['历史 0'])
    expect(found.matchedDone).toBe(1)
    expect(found.totalDone).toBe(65)
    expect(store.listTasks({ doneQuery: '唯一', donePriorities: ['low'] }).matchedDone).toBe(0)
    expect(() => store.listTasks({ doneLimit: -1 })).toThrow('加载数量')
    store.close()
  })

  test('归档保留任务和提醒，允许编辑原归属但不允许新增或移入', () => {
    const store = openTasksStore(tempFile('tasks.db'))
    const project = store.createProject('归档项目')
    const task = store.createTask({ title: '保留任务', projectId: project.id, remindAt: 1 })
    const other = store.createTask({ title: '其他任务' })
    store.archiveProject(project.id, true)
    expect(store.listTasks().open.some(item => item.id === task.id)).toBe(true)
    expect(store.updateTask(task.id, { title: '修改标题', projectId: project.id }).projectId).toBe(project.id)
    expect(store.claimDueReminders(2).map(item => item.id)).toEqual([task.id])
    expect(() => store.createTask({ title: '新增', projectId: project.id })).toThrow('归档')
    expect(() => store.updateTask(other.id, { projectId: project.id })).toThrow('归档')
    expect(store.updateTask(task.id, { projectId: null }).projectId).toBeNull()
    store.close()
  })

  test('重复任务恢复后再次完成不生成第二份下一期，删除下一期后仍不重建', () => {
    const file = tempFile('tasks.db')
    const store = openTasksStore(file)
    const task = store.createTask({ title: '重复', dueAt: Date.now() + 86_400_000, recurrence: 'daily' })
    store.completeTask(task.id)
    const next = store.listTasks().open[0]
    store.reopenTask(task.id)
    store.completeTask(task.id)
    expect(store.listTasks().open.map(item => item.id)).toEqual([next.id])
    store.close()
    const reopened = openTasksStore(file)
    reopened.deleteTask(next.id)
    reopened.reopenTask(task.id)
    reopened.completeTask(task.id)
    expect(reopened.listTasks().open).toHaveLength(0)
    reopened.close()
  })

  test('v3 升级保留重复任务且不为旧已完成实例重复生成下一期', async () => {
    const file = tempFile('tasks.db')
    const store = openTasksStore(file)
    const task = store.createTask({ title: '旧重复', dueAt: Date.now() + 86_400_000, recurrence: 'daily' })
    store.completeTask(task.id)
    const next = store.listTasks().open[0]
    store.close()
    const Database = (await import('better-sqlite3')).default
    const raw = new Database(file)
    raw.exec('ALTER TABLE tasks DROP COLUMN recurrence_generated')
    raw.pragma('user_version = 3')
    raw.close()
    const upgraded = openTasksStore(file)
    upgraded.reopenTask(task.id)
    upgraded.completeTask(task.id)
    expect(upgraded.listTasks().open.map(item => item.id)).toEqual([next.id])
    upgraded.completeTask(next.id)
    expect(upgraded.listTasks().open).toHaveLength(1)
    upgraded.close()
  })

  test('选项按 id 改名和重排保留任务关联，删除只清除被删值', () => {
    const store = openTasksStore(tempFile('tasks.db'))
    const field = store.createField({ name: '阶段', options: ['待办', '进行中'] })
    const task = store.createTask({ title: '字段任务', customFields: { [field.id]: field.options[1].id } })
    store.completeTask(task.id)
    const renamed = store.updateField(field.id, { options: [{ ...field.options[1], name: '处理中' }, field.options[0], { name: '阻塞' }] })
    expect(renamed.options[0].id).toBe(field.options[1].id)
    expect(store.listTasks().done[0].customFields[field.id]).toBe(field.options[1].id)
    expect(() => store.updateField(field.id, { options: [{ id: 'unknown', name: '错误' }] })).toThrow('选项不存在')
    expect(store.listFields()[0].options).toEqual(renamed.options)
    store.updateField(field.id, { options: [renamed.options[1]] })
    expect(store.listTasks().done[0].customFields[field.id]).toBeUndefined()
    store.close()
  })

  test('claimDueReminders 只领取一次且排除已完成/无提醒', () => {
    const store = openTasksStore(tempFile('tasks.db'))
    const now = 10_000
    const due = store.createTask({ title: '到期', remindAt: now - 1 })
    const later = store.createTask({ title: '未到', remindAt: now + 5_000 })
    const noRemind = store.createTask({ title: '无提醒' })
    const doneTask = store.createTask({ title: '已完成', remindAt: now - 1 })
    store.completeTask(doneTask.id)
    const first = store.claimDueReminders(now)
    expect(first.map(item => item.id)).toEqual([due.id])
    expect(first[0].remindFiredAt).toBe(now)
    expect(store.claimDueReminders(now + 6_000).map(item => item.id)).toEqual([later.id])
    expect(noRemind.remindAt).toBeNull()
    store.close()
  })

  test('修改提醒时间会重置已触发标记', () => {
    const store = openTasksStore(tempFile('tasks.db'))
    const task = store.createTask({ title: '改期', remindAt: 1_000 })
    expect(store.claimDueReminders(2_000).map(item => item.id)).toEqual([task.id])
    const updated = store.updateTask(task.id, { remindAt: 10_000 })
    expect(updated.remindFiredAt).toBeNull()
    expect(store.claimDueReminders(11_000).map(item => item.id)).toEqual([task.id])
    store.close()
  })

  test('自定义视图 CRUD 且重开持久化', () => {
    const file = tempFile('tasks.db')
    const store = openTasksStore(file)
    const project = store.createProject('项目 A')
    const view = store.createView({ name: ' 高优跟进 ', projectIds: [project.id], priorities: ['high'], dueRange: 'today' })
    expect(view.name).toBe('高优跟进')
    expect(view.projectIds).toEqual([project.id])
    expect(view.dueRange).toBe('today')
    const updated = store.updateView(view.id, { name: '高优+中优', priorities: ['high', 'medium'] })
    expect(updated.name).toBe('高优+中优')
    expect(updated.projectIds).toEqual([project.id])
    expect(updated.priorities).toEqual(['high', 'medium'])
    expect(updated.dueRange).toBe('today')
    expect(() => store.updateView('missing', { name: 'x' })).toThrow('视图不存在')
    store.close()
    const reopened = openTasksStore(file)
    expect(reopened.listViews().map(item => item.name)).toEqual(['高优+中优'])
    reopened.deleteView(reopened.listViews()[0].id)
    expect(reopened.listViews()).toHaveLength(0)
    reopened.close()
  })

  test('视图输入校验:空名、非法优先级/截止范围/项目选择', () => {
    const store = openTasksStore(tempFile('tasks.db'))
    expect(() => store.createView({ name: '  ' })).toThrow('视图名称')
    expect(() => store.createView({ name: 'x', priorities: ['urgent' as never] })).toThrow('优先级')
    expect(() => store.createView({ name: 'x', dueRange: 'soon' as never })).toThrow('截止范围')
    expect(() => store.createView({ name: 'x', projectIds: [1 as never] })).toThrow('项目')
    store.close()
  })

  test('v1 库升级到 v2 保留任务与项目并新增视图表', async () => {
    const file = tempFile('tasks.db')
    const store = openTasksStore(file)
    const project = store.createProject('项目 A')
    const task = store.createTask({ title: '存量任务', projectId: project.id, priority: 'high' })
    store.close()
    const Database = (await import('better-sqlite3')).default
    const raw = new Database(file)
    raw.pragma('user_version = 1')
    raw.exec('DROP TABLE task_views')
    raw.close()
    const upgraded = openTasksStore(file)
    expect(upgraded.listTasks().open.map(item => item.id)).toEqual([task.id])
    expect(upgraded.listProjects().map(item => item.name)).toEqual(['项目 A'])
    const view = upgraded.createView({ name: '升级后新建', projectIds: [project.id] })
    expect(upgraded.listViews().map(item => item.id)).toEqual([view.id])
    upgraded.close()
  })

  test('任务 customFields 持久化、合并更新与无效引用过滤', () => {
    const store = openTasksStore(tempFile('tasks.db'))
    const field = store.createField({ name: '阶段', options: ['待办', '进行中'] })
    const doing = field.options[1]
    const task = store.createTask({ title: '带字段', customFields: { [field.id]: doing.id, missing: 'x' } })
    expect(task.customFields).toEqual({ [field.id]: doing.id })
    const updated = store.updateTask(task.id, { customFields: { [field.id]: field.options[0].id } })
    expect(updated.customFields).toEqual({ [field.id]: field.options[0].id })
    const cleared = store.updateTask(task.id, { customFields: { [field.id]: null } })
    expect(cleared.customFields).toEqual({})
    expect(() => store.updateTask(task.id, { customFields: 'bad' as never })).toThrow('自定义字段')
    store.close()
  })

  test('自定义字段 CRUD:改名、选项按名保 id、删选项清理任务值', () => {
    const store = openTasksStore(tempFile('tasks.db'))
    const field = store.createField({ name: '阶段', options: ['待办', '进行中'] })
    const todo = field.options[0]
    const doing = field.options[1]
    const task = store.createTask({ title: '任务', customFields: { [field.id]: doing.id } })

    const renamed = store.updateField(field.id, { name: '流程' })
    expect(renamed.name).toBe('流程')
    expect(renamed.options.map(option => option.id)).toEqual([todo.id, doing.id])

    const withNew = store.updateField(field.id, { options: ['待办', '阻塞'] })
    expect(withNew.options.map(option => option.name)).toEqual(['待办', '阻塞'])
    expect(withNew.options[0].id).toBe(todo.id)
    expect(store.listTasks().open[0].customFields[field.id]).toBeUndefined()

    expect(() => store.updateField('missing', { name: 'x' })).toThrow('字段不存在')
    store.deleteField(field.id)
    expect(store.listFields()).toHaveLength(0)
    expect(store.listTasks().open[0].customFields).toEqual({})
    store.close()
  })

  test('字段输入校验:空名、非法选项、重复选项去重', () => {
    const store = openTasksStore(tempFile('tasks.db'))
    expect(() => store.createField({ name: ' ' })).toThrow('字段名称')
    expect(() => store.createField({ name: 'x', options: [1 as never] })).toThrow('选项')
    expect(store.createField({ name: 'x', options: ['a', ' a ', 'b'] }).options.map(option => option.name)).toEqual(['a', 'b'])
    store.close()
  })

  test('v2 库升级到 v3 补 custom_fields 列并保留数据', async () => {
    const file = tempFile('tasks.db')
    const store = openTasksStore(file)
    const task = store.createTask({ title: '存量任务' })
    store.close()
    const Database = (await import('better-sqlite3')).default
    const raw = new Database(file)
    raw.pragma('user_version = 2')
    raw.exec("ALTER TABLE tasks DROP COLUMN custom_fields")
    raw.exec('DROP TABLE task_fields')
    raw.close()
    const upgraded = openTasksStore(file)
    expect(upgraded.listTasks().open.map(item => item.id)).toEqual([task.id])
    expect(upgraded.listTasks().open[0].customFields).toEqual({})
    const field = upgraded.createField({ name: '阶段', options: ['待办'] })
    expect(upgraded.updateTask(task.id, { customFields: { [field.id]: field.options[0].id } }).customFields)
      .toEqual({ [field.id]: field.options[0].id })
    upgraded.close()
  })

  test('拒绝高于当前支持的数据库版本', async () => {
    const file = tempFile('tasks.db')
    const store = openTasksStore(file)
    store.close()
    const Database = (await import('better-sqlite3')).default
    const raw = new Database(file)
    raw.pragma('user_version = 99')
    raw.close()
    expect(() => openTasksStore(file)).toThrow('版本')
  })

  test('损坏文件被隔离并重建空库,WAL 侧文件不残留', () => {
    const file = tempFile('tasks.db')
    writeFileSync(file, 'this is definitely not a sqlite database')
    writeFileSync(`${file}-wal`, 'stale wal')
    writeFileSync(`${file}-shm`, 'stale shm')
    const store = openTasksStore(file)
    const result = store.listTasks()
    expect(result.open).toHaveLength(0)
    expect(result.quarantinedAt).toBeGreaterThan(0)
    store.close()
    const siblings = readdirSync(join(file, '..'))
    expect(siblings.filter(name => name.includes('corrupt')).length).toBeGreaterThan(0)
    expect(siblings.includes('tasks.db-wal')).toBe(false)
    expect(siblings.includes('tasks.db-shm')).toBe(false)
  })

  test('非损坏的打开失败原样抛出,不隔离不重建', () => {
    const directory = mkdtempSync(join(tmpdir(), 'chouyu-tasks-block-'))
    directories.push(directory)
    expect(() => openTasksStore(directory)).toThrow()
  })
})
