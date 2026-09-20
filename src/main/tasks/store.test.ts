import { mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { openTasksStore } from './store'
import { matchesTaskSchedule } from '../../shared/tasks'

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
    expect(reopened.listProjects().map(item => item.name)).toEqual(['默认清单', '项目 A'])
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

  test('归档退出日常视图并暂停提醒，显式查看和恢复保留原任务', () => {
    const store = openTasksStore(tempFile('tasks.db'))
    const project = store.createProject('归档项目')
    const task = store.createTask({ title: '保留任务', projectId: project.id, remindAt: 1 })
    const other = store.createTask({ title: '其他任务' })
    store.archiveProject(project.id, true)
    expect(store.listTasks().open.some(item => item.id === task.id)).toBe(false)
    expect(store.listTasks({ doneSelection: `project:${project.id}` }).open.some(item => item.id === task.id)).toBe(true)
    expect(store.updateTask(task.id, { title: '修改标题', projectId: project.id }).projectId).toBe(project.id)
    expect(store.claimDueReminders(2)).toEqual([])
    expect(() => store.createTask({ title: '新增', projectId: project.id })).toThrow('归档')
    expect(() => store.updateTask(other.id, { projectId: project.id })).toThrow('归档')
    store.archiveProject(project.id, false)
    expect(store.listTasks().open.some(item => item.id === task.id)).toBe(true)
    expect(store.claimDueReminders(2).map(item => item.id)).toEqual([task.id])
    expect(store.updateTask(task.id, { projectId: null }).projectId).toBe(store.listProjects().find(project => project.isDefault)!.id)
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
    expect(upgraded.listProjects().map(item => item.name)).toEqual(['默认清单', '项目 A'])
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


test('分组持久化、项目移动与无效分组保护', () => {
  const file = tempFile('groups.db')
  const store = openTasksStore(file)
  const legacy = store.createProject('原有项目')
  const group = store.createGroup(' 工作 ')
  expect(group.name).toBe('工作')
  expect(() => store.createGroup('工作')).toThrow('同名分组')
  expect(() => store.createGroup(' ')).toThrow()
  expect(() => store.createProject('原有项目', 'missing')).toThrow('分组不存在')
  const project = store.createProject('新项目', group.id)
  const task = store.createTask({ title: '原有项目', projectId: legacy.id })
  store.moveProject(legacy.id, group.id)
  expect(() => store.moveProject(legacy.id, 'missing')).toThrow('分组不存在')
  store.close()
  const reopened = openTasksStore(file)
  expect(reopened.listGroups().filter(item => !item.isDefault)).toEqual([group])
  expect(reopened.listProjects().find(item => item.id === project.id)?.groupId).toBe(group.id)
  expect(reopened.listProjects().find(item => item.id === legacy.id)?.groupId).toBe(group.id)
  expect(reopened.listTasks().open.find(item => item.id === task.id)?.projectId).toBe(legacy.id)
  expect(reopened.moveProject(legacy.id, null).groupId).toBe(reopened.listGroups().find(item => item.isDefault)!.id)
  reopened.close()
})


test('默认清单可改名、不可归档或移动，重开后保持默认归属', () => {
  const file = tempFile('inbox.db')
  const store = openTasksStore(file)
  const inbox = store.listProjects().find(project => project.isDefault)!
  expect(inbox.name).toBe('默认清单')
  expect(store.createTask({ title: '收集任务' }).projectId).toBe(inbox.id)
  store.renameProject(inbox.id, '我的收件箱')
  expect(() => store.archiveProject(inbox.id, true)).toThrow('默认清单')
  expect(() => store.moveProject(inbox.id, store.createGroup('工作').id)).toThrow('默认清单')
  store.close()
  const reopened = openTasksStore(file)
  expect(reopened.listProjects().filter(project => project.isDefault)).toEqual([expect.objectContaining({ id: inbox.id, name: '我的收件箱' })])
  expect(reopened.createTask({ title: '新任务', projectId: null }).projectId).toBe(inbox.id)
  reopened.close()
})

test('开始时间持久化、清空、校验和重复任务顺延', () => {
  const file = tempFile('start.db')
  const store = openTasksStore(file)
  const startAt = Date.now() + 86_400_000
  const dueAt = startAt + 3_600_000
  const task = store.createTask({ title: '规划任务', startAt, dueAt, recurrence: 'daily' })
  expect(store.updateTask(task.id, { note: '保留时间' }).startAt).toBe(startAt)
  expect(() => store.updateTask(task.id, { startAt: dueAt + 1 })).toThrow('开始时间')
  expect(() => store.createTask({ title: '错误', startAt: NaN })).toThrow('开始时间')
  store.completeTask(task.id)
  expect(store.listTasks().open[0].startAt).toBe(startAt + 86_400_000)
  store.close()
  const reopened = openTasksStore(file)
  const next = reopened.listTasks().open[0]
  expect(next.startAt).toBe(startAt + 86_400_000)
  expect(reopened.updateTask(next.id, { startAt: null }).startAt).toBeNull()
  reopened.close()
})

test('v5 升级保留已有同名收集箱并接收未归属任务', async () => {
  const file = tempFile('legacy-inbox.db')
  const store = openTasksStore(file)
  const inbox = store.listProjects().find(project => project.isDefault)!
  const task = store.createTask({ title: '旧任务' })
  store.close()
  const Database = (await import('better-sqlite3')).default
  const raw = new Database(file)
  raw.prepare('UPDATE task_projects SET name = ? WHERE id = ?').run('收集箱', inbox.id)
  raw.exec('UPDATE tasks SET project_id = NULL; ALTER TABLE tasks DROP COLUMN start_at; ALTER TABLE task_projects DROP COLUMN is_default')
  raw.pragma('user_version = 5')
  raw.close()
  const upgraded = openTasksStore(file)
  expect(upgraded.listProjects()).toHaveLength(1)
  expect(upgraded.listProjects()[0]).toMatchObject({ id: inbox.id, isDefault: true })
  expect(upgraded.listTasks().open[0]).toMatchObject({ id: task.id, projectId: inbox.id, startAt: null })
  upgraded.close()
})


test('分组改名持久化，删除分组保留清单和任务', () => {
  const file = tempFile('groups.db')
  const store = openTasksStore(file)
  const group = store.createGroup('工作')
  const other = store.createGroup('生活')
  const project = store.createProject('计划', group.id)
  const archived = store.createProject('历史', group.id)
  store.archiveProject(archived.id, true)
  const task = store.createTask({ title: '保留任务', projectId: project.id })
  expect(() => store.renameGroup(group.id, other.name)).toThrow('同名分组')
  expect(() => store.renameGroup(group.id, ' ')).toThrow('分组名称')
  expect(() => store.deleteGroup('missing')).toThrow('分组不存在')
  expect(store.renameGroup(group.id, ' 工作计划 ')).toEqual({ id: group.id, name: '工作计划' })
  store.close()
  const reopened = openTasksStore(file)
  expect(reopened.listGroups()).toContainEqual({ id: group.id, name: '工作计划' })
  reopened.deleteGroup(group.id)
  expect(reopened.listGroups().filter(item => !item.isDefault)).toEqual([other])
  expect(reopened.listProjects().find(item => item.id === project.id)?.groupId).toBe(reopened.listGroups().find(item => item.isDefault)!.id)
  expect(reopened.listProjects().find(item => item.id === archived.id)).toMatchObject({ groupId: reopened.listGroups().find(item => item.isDefault)!.id, archivedAt: expect.any(Number) })
  expect(reopened.listTasks().open).toContainEqual(expect.objectContaining({ id: task.id, projectId: project.id }))
  reopened.close()
})


test('每个用户数据文件都有独立的默认分组和默认项目，改名后仍受保护', () => {
  const file = tempFile('user-one.db')
  const first = openTasksStore(file)
  const second = openTasksStore(tempFile('user-two.db'))
  const inbox = first.listGroups().find(group => group.isDefault)!
  const project = first.listProjects().find(item => item.isDefault)!
  expect(inbox.name).toBe('收集箱')
  expect(project).toMatchObject({ name: '默认清单', groupId: inbox.id })
  expect(second.listGroups().find(group => group.isDefault)!.id).not.toBe(inbox.id)
  expect(first.createProject('普通清单').groupId).toBe(inbox.id)
  expect(first.createTask({ title: '默认任务' }).projectId).toBe(project.id)
  first.renameGroup(inbox.id, '我的收集箱')
  first.renameProject(project.id, '随手记')
  expect(() => first.deleteGroup(inbox.id)).toThrow('默认分组')
  expect(() => first.archiveProject(project.id, true)).toThrow('默认清单')
  first.close(); second.close()
  const reopened = openTasksStore(file)
  expect(reopened.listGroups()).toContainEqual({ id: inbox.id, name: '我的收集箱', isDefault: true })
  expect(reopened.listProjects().find(item => item.isDefault)).toMatchObject({ id: project.id, name: '随手记', groupId: inbox.id })
  expect(reopened.createTask({ title: '再次收集', projectId: null }).projectId).toBe(project.id)
  reopened.close()
})

test('v6 升级保留改名后的默认项目、已有分组与任务关联', async () => {
  const file = tempFile('v6.db')
  const store = openTasksStore(file)
  const defaultGroup = store.listGroups().find(item => item.isDefault)!
  const project = store.listProjects().find(item => item.isDefault)!
  store.renameProject(project.id, '已有默认清单')
  const group = store.createGroup('工作')
  const grouped = store.createProject('工作项目', group.id)
  const ungrouped = store.createProject('未分组项目')
  const task = store.createTask({ title: '已有任务' })
  store.close()
  const Database = (await import('better-sqlite3')).default
  const raw = new Database(file)
  raw.prepare('UPDATE task_projects SET group_id = NULL WHERE group_id = ?').run(defaultGroup.id)
  raw.prepare('DELETE FROM task_groups WHERE id = ?').run(defaultGroup.id)
  raw.exec('ALTER TABLE task_groups DROP COLUMN is_default')
  raw.pragma('user_version = 6')
  raw.close()
  const upgraded = openTasksStore(file)
  const inbox = upgraded.listGroups().find(item => item.isDefault)!
  expect(inbox.name).toBe('收集箱')
  expect(upgraded.listProjects().find(item => item.id === project.id)).toMatchObject({ name: '已有默认清单', groupId: inbox.id, isDefault: true })
  expect(upgraded.listProjects().find(item => item.id === ungrouped.id)?.groupId).toBe(inbox.id)
  expect(upgraded.listProjects().find(item => item.id === grouped.id)?.groupId).toBe(group.id)
  expect(upgraded.listTasks().open[0]).toMatchObject({ id: task.id, projectId: project.id })
  upgraded.close()
})

test('日期预设按完成时间筛选后分页，与前端规则一致，跨天不延续', () => {
  const store = openTasksStore(tempFile('done-schedule.db'))
  const at = (day: number, hour = 0) => new Date(2026, 8, day, hour).getTime()
  const clock = vi.spyOn(Date, 'now')
  try {
    const project = store.createProject('完成日期测试')
    for (const day of [13, 14, 15, 16, 16, 17, 20, 21]) {
      clock.mockReturnValue(at(day))
      const task = store.createTask({ title: `完成 ${day}`, projectId: project.id, startAt: at(1) })
      store.completeTask(task.id)
    }
    clock.mockReturnValue(at(16, 12))
    const allDone = store.listTasks().done
    for (const period of ['today', 'tomorrow', 'week'] as const) {
      const expected = allDone.filter(task => matchesTaskSchedule(task, period, Date.now()))
      const result = store.listTasks({ doneSelection: period, doneLimit: 1, doneProjectIds: [project.id] })
      expect(result.matchedDone).toBe(expected.length)
      expect(result.done.map(task => task.id)).toEqual(expected.slice(0, 1).map(task => task.id))
    }
    expect(store.listTasks({ doneSelection: 'today' }).matchedDone).toBe(2)
    expect(store.listTasks({ doneSelection: 'week' }).matchedDone).toBe(6)
    expect(store.listTasks({ doneSelection: 'today', doneDueRange: 'today' }).matchedDone).toBe(0)
    clock.mockReturnValue(at(18))
    expect(store.listTasks({ doneSelection: 'today' }).matchedDone).toBe(0)
  } finally { clock.mockRestore(); store.close() }
})

test('完整历史分组计数不受分页限制，与前端分组一致', () => {
  const store = openTasksStore(tempFile('group-counts.db'))
  const at = (day: number) => new Date(2026, 8, day, 12).getTime()
  const clock = vi.spyOn(Date, 'now')
  try {
    const project = store.createProject('历史清单')
    const field = store.createField({ name: '阶段', options: ['待办', '处理'] })
    for (let index = 0; index < 70; index++) {
      clock.mockReturnValue(at(16 - index % 10))
      const task = store.createTask({ title: `历史 ${index}`, projectId: project.id, priority: index % 2 ? 'high' : 'low', dueAt: index % 2 ? null : at(16 + index % 3), customFields: { [field.id]: field.options[index % 2].id } })
      store.completeTask(task.id)
    }
    clock.mockReturnValue(at(16))
    const all = store.listTasks({ doneSelection: 'done', doneLimit: 100 }).done
    const groups = [{ id: 'manual', name: '手动', taskIds: all.slice(5, 40).map(task => task.id) }]
    const expectedCounts: Record<string, Record<string, number>> = {
      status: { done: 70 }, completed: { today: 7, yesterday: 7, recent: 35, earlier: 21 },
      week: { '2026-9-14': 7, '2026-9-15': 7, '2026-9-16': 7, other: 49 },
      due: { none: 35, today: 12, tomorrow: 11, later: 12 },
      priority: { high: 35, low: 35 }, project: { [project.id]: 70 },
      field: { [field.options[0].id]: 35, [field.options[1].id]: 35 }, custom: { manual: 35, '': 35 }, overdue: { other: 70 }
    }
    for (const mode of ['status', 'completed', 'week', 'due', 'priority', 'project', 'field', 'custom', 'overdue'] as const) {
      const result = store.listTasks({ doneSelection: 'done', doneLimit: 2, doneGrouping: { mode, fieldId: field.id, groups } })
      expect(result.done).toHaveLength(2)
      expect(result.doneGroupCounts).toEqual(expectedCounts[mode])
      expect(result.matchedDone).toBe(70)
    }
    const filtered = store.listTasks({ doneSelection: 'done', doneLimit: 1, donePriorities: ['high'], doneGrouping: { mode: 'priority' } })
    expect(filtered.doneGroupCounts).toEqual({ high: 35 })
  } finally { clock.mockRestore(); store.close() }
})

test('回收任务恢复原归属、字段和完成状态，过期提醒不重发', () => {
  const store = openTasksStore(tempFile('trash-task.db'))
  try {
    const group = store.createGroup('工作')
    const project = store.createProject('项目', group.id)
    const field = store.createField({ name: '阶段', options: ['完成'] })
    const task = store.createTask({ title: '回收任务', projectId: project.id, remindAt: 1, customFields: { [field.id]: field.options[0].id } })
    store.completeTask(task.id); store.deleteTask(task.id)
    const entry = store.listTrash()[0]
    expect(entry).toMatchObject({ kind: 'task', name: task.title, taskCount: 1 })
    store.deleteProject(project.id)
    store.restoreTrash(entry.id)
    expect(store.listTasks({ doneSelection: 'done' }).done.find(item => item.id === task.id)).toMatchObject({ projectId: project.id, status: 'done', customFields: task.customFields })
    expect(store.listProjects().find(item => item.id === project.id)?.groupId).toBe(group.id)
    store.reopenTask(task.id)
    expect(store.claimDueReminders(Date.now())).toEqual([])
  } finally { store.close() }
})

test('整组回收仅生成一条记录，跨重启恢复全部清单和任务，同名不覆盖新数据', () => {
  const file = tempFile('trash-group.db')
  let store = openTasksStore(file)
  try {
    const group = store.createGroup('原分组')
    const project = store.createProject('原清单', group.id)
    const task = store.createTask({ title: '原任务', projectId: project.id })
    store.archiveProject(project.id, true)
    store.deleteGroup(group.id, true)
    expect(store.listTrash()).toHaveLength(1)
    const trashId = store.listTrash()[0].id
    const replacement = store.createGroup('原分组')
    const newProject = store.createProject('原清单', replacement.id)
    store.close(); store = openTasksStore(file)
    store.restoreTrash(trashId)
    expect(store.listGroups().find(item => item.id === group.id)?.name).toBe('原分组（恢复 1）')
    expect(store.listProjects().find(item => item.id === project.id)).toMatchObject({ name: '原清单（恢复 1）', groupId: group.id, archivedAt: expect.any(Number) })
    expect(store.listProjects().find(item => item.id === newProject.id)?.name).toBe('原清单')
    expect(store.listTasks({ doneSelection: `project:${project.id}` }).open.some(item => item.id === task.id)).toBe(true)
    expect(store.listTrash()).toHaveLength(0)
    expect(() => store.restoreTrash(trashId)).toThrow('不存在')
  } finally { store.close() }
})

test('保留内容的分组删除可恢复归属，但不覆盖后来手动移动的清单；永久删除不可恢复', () => {
  const store = openTasksStore(tempFile('trash-keep.db'))
  try {
    const group = store.createGroup('原分组'), other = store.createGroup('新的安排')
    const first = store.createProject('保持', group.id), second = store.createProject('手动移动', group.id)
    store.deleteGroup(group.id, false)
    store.moveProject(second.id, other.id)
    store.restoreTrash(store.listTrash()[0].id)
    expect(store.listProjects().find(item => item.id === first.id)?.groupId).toBe(group.id)
    expect(store.listProjects().find(item => item.id === second.id)?.groupId).toBe(other.id)
    const task = store.createTask({ title: '永久删除' }); store.deleteTask(task.id)
    const id = store.listTrash()[0].id; store.purgeTrash(id)
    expect(() => store.restoreTrash(id)).toThrow('不存在')
  } finally { store.close() }
})

test('完整备份恢复任务、归属、字段、视图、回收站和 UI 配置', () => {
  const store = openTasksStore(tempFile('backup-roundtrip.db'))
  try {
    const group = store.createGroup('备份分组'), project = store.createProject('备份清单', group.id)
    const field = store.createField({ name: '备份字段', options: ['选项'] })
    const view = store.createView({ name: '备份视图', projectIds: [project.id], dueRange: 'today' })
    const task = store.createTask({ title: '保留', projectId: project.id, customFields: { [field.id]: field.options[0].id } })
    const removed = store.createTask({ title: '回收', projectId: project.id }); store.deleteTask(removed.id)
    const settings = { preferences: JSON.stringify({ today: { groupMode: 'custom', customGroups: [{ id: 'x', name: '安排', taskIds: [task.id] }] } }), layoutOrder: JSON.stringify({ 'sidebar:groups': [group.id] }), selection: 'today' }
    const backup = store.exportBackup(settings)
    store.deleteGroup(group.id, true); store.deleteField(field.id); store.deleteView(view.id)
    store.createTask({ title: '备份后的新任务' })
    expect(store.restoreBackup(JSON.parse(JSON.stringify(backup)))).toEqual(settings)
    expect(store.listTasks().open.map(item => item.id)).toEqual([task.id])
    expect(store.listFields().find(item => item.id === field.id)).toEqual(field)
    expect(store.listViews().find(item => item.id === view.id)).toEqual(view)
    expect(store.listProjects().find(item => item.id === project.id)?.groupId).toBe(group.id)
    expect(store.listTrash()).toHaveLength(1)
    store.restoreTrash(store.listTrash()[0].id)
    expect(store.listTasks().open.some(item => item.id === removed.id)).toBe(true)
  } finally { store.close() }
})

test('备份恢复在删除阶段或写入阶段失败时保留整个原工作区', async () => {
  const file = tempFile('backup-rollback.db')
  const store = openTasksStore(file)
  const task = store.createTask({ title: '备份中的任务' })
  const backup = store.exportBackup({ preferences: '{}', layoutOrder: '{}', selection: 'all' })
  const newer = store.createTask({ title: '恢复前的新任务' })
  const Database = (await import('better-sqlite3')).default
  const db = new Database(file)
  for (const operation of ['DELETE', 'INSERT']) {
    db.exec(`CREATE TRIGGER fail_restore BEFORE ${operation} ON tasks BEGIN SELECT RAISE(ABORT, '模拟磁盘写入失败'); END`)
    expect(() => store.restoreBackup(backup)).toThrow('模拟磁盘写入失败')
    expect(store.listTasks().open.map(item => item.id)).toEqual([task.id, newer.id])
    db.exec('DROP TRIGGER fail_restore')
  }
  db.close(); store.close()
})

test('损坏备份、无效引用和未来版本均在修改现有数据之前拒绝', () => {
  const store = openTasksStore(tempFile('backup-invalid.db'))
  try {
    const task = store.createTask({ title: '不能丢失' })
    const original = store.exportBackup({ preferences: '{}', layoutOrder: '{}', selection: 'today' })
    for (const corrupt of [
      (backup: typeof original) => { backup.schemaVersion += 1 },
      (backup: typeof original) => { backup.tables.tasks[0].project_id = 'missing' },
      (backup: typeof original) => { backup.tables.tasks[0].status = 'invalid' },
      (backup: typeof original) => { backup.tables.tasks[0].due_at = 'not-a-date' },
      (backup: typeof original) => { backup.tables.task_groups = [] },
      (backup: typeof original) => { backup.settings.preferences = '{broken' }
    ]) {
      const backup = JSON.parse(JSON.stringify(original)) as typeof original; corrupt(backup)
      expect(() => store.restoreBackup(backup)).toThrow()
      expect(store.listTasks().open.map(item => item.id)).toEqual([task.id])
    }
  } finally { store.close() }
})

test('完成任务按清单、视图和日期筛选后再分页，匹配总数准确', () => {
  const store = openTasksStore(tempFile('done-scopes.db'))
  try {
    const project = store.createProject('目标清单')
    const other = store.createProject('其他清单')
    const today = new Date(); today.setHours(12, 0, 0, 0)
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1)
    for (let index = 0; index < 6; index++) {
      const task = store.createTask({ title: '目标 ' + index, projectId: project.id, priority: 'high', dueAt: today.getTime() })
      store.completeTask(task.id)
    }
    const old = store.createTask({ title: '昨日', projectId: project.id, dueAt: yesterday.getTime() }); store.completeTask(old.id)
    const planned = store.createTask({ title: '仅开始', projectId: project.id, startAt: today.getTime() }); store.completeTask(planned.id)
    const unplanned = store.createTask({ title: '待规划', projectId: project.id }); store.completeTask(unplanned.id)
    for (let index = 0; index < 55; index++) {
      const task = store.createTask({ title: '其他 ' + index, projectId: other.id }); store.completeTask(task.id)
    }
    const result = store.listTasks({ doneLimit: 2, doneSelection: `project:${project.id}`, doneDueRange: 'today', donePriorities: ['high'] })
    expect(result.done).toHaveLength(2)
    expect(result.matchedDone).toBe(6)
    expect(result.totalDone).toBe(64)
    expect(result.done.every(task => task.projectId === project.id)).toBe(true)
    expect(store.listTasks({ doneSelection: 'today', doneProjectIds: [project.id] }).matchedDone).toBe(9)
    expect(store.listTasks({ doneDueRange: 'today', doneProjectIds: [project.id] }).matchedDone).toBe(6)
    expect(store.listTasks({ doneSelection: 'overdue', doneProjectIds: [project.id] }).done.map(task => task.id)).toEqual([old.id])
    expect(store.listTasks({ doneSelection: 'unplanned', doneProjectIds: [project.id] }).done.map(task => task.id)).toEqual([unplanned.id])
    const view = store.createView({ name: '高优', projectIds: [project.id], priorities: ['high'], dueRange: 'today' })
    expect(store.listTasks({ doneSelection: `view:${view.id}`, doneLimit: 3 }).matchedDone).toBe(6)
    expect(store.listTasks({ doneSelection: 'view:missing' }).matchedDone).toBe(0)
    expect(() => store.listTasks({ doneDueRange: 'invalid' as never })).toThrow('截止范围')
  } finally { store.close() }
})


test('删除清单同时移除未完成、已完成任务及提醒，保留其他清单并持久化', () => {
  const file = tempFile('delete-project.db')
  const store = openTasksStore(file)
  const project = store.createProject('待删清单')
  const open = store.createTask({ title: '待删提醒', projectId: project.id, remindAt: Date.now() + 60000 })
  const done = store.createTask({ title: '待删完成', projectId: project.id })
  store.completeTask(done.id)
  const kept = store.createTask({ title: '保留任务' })
  store.archiveProject(project.id, true)
  store.deleteProject(project.id)
  expect(() => store.deleteProject(store.listProjects().find(item => item.isDefault)!.id)).toThrow('默认清单')
  expect(() => store.deleteProject('missing')).toThrow('不存在')
  expect(store.claimDueReminders(Date.now() + 120000)).toEqual([])
  store.close()
  const reopened = openTasksStore(file)
  expect(reopened.listProjects().some(item => item.id === project.id)).toBe(false)
  const list = reopened.listTasks()
  expect([...list.open, ...list.done].some(task => [open.id, done.id].includes(task.id))).toBe(false)
  expect(list.open.some(task => task.id === kept.id)).toBe(true)
  reopened.close()
})

test('删除分组勾选级联删除时包含归档清单和已完成任务，且仅删除该分组', () => {
  const file = tempFile('delete-group.db')
  const store = openTasksStore(file)
  const group = store.createGroup('待删分组')
  const project = store.createProject('待删普通清单', group.id)
  const archived = store.createProject('待删归档清单', group.id)
  store.createTask({ title: '普通任务', projectId: project.id })
  const done = store.createTask({ title: '归档清单已完成', projectId: archived.id })
  store.completeTask(done.id)
  store.archiveProject(archived.id, true)
  const kept = store.createTask({ title: '保留任务' })
  store.deleteGroup(group.id, true)
  expect(() => store.deleteGroup(store.listGroups().find(item => item.isDefault)!.id, true)).toThrow('默认分组')
  store.close()
  const reopened = openTasksStore(file)
  expect(reopened.listGroups().some(item => item.id === group.id)).toBe(false)
  expect(reopened.listProjects().some(item => [project.id, archived.id].includes(item.id))).toBe(false)
  expect(reopened.listTasks().open.map(task => task.id)).toEqual([kept.id])
  expect(reopened.listTasks().done).toEqual([])
  reopened.close()
})

test('子项、来源持久化并可回收恢复，子项与父状态独立，重复下一期重置勾选', () => {
  const file = tempFile('checklist-source.db')
  let store = openTasksStore(file)
  const source = { kind: 'journal' as const, id: 'activity:7', label: '原日志', date: '2026-09-20' }
  const task = store.createTask({ title: '父任务', source, dueAt: Date.now() + 86400000, recurrence: 'daily', checklist: [{ id: 'step', title: '第一步', done: false }] })
  store.updateTask(task.id, { checklist: [{ id: 'step', title: '已勾选', done: true }] })
  expect(store.getTask(task.id)?.status).toBe('open')
  expect(() => store.updateTask(task.id, { checklist: [{ id: 'same', title: '', done: false }] })).toThrow()
  store.completeTask(task.id)
  const next = store.listTasks().open[0]
  expect(next.checklist).toEqual([{ id: 'step', title: '已勾选', done: false }])
  expect(next.source).toEqual(source)
  store.close(); store = openTasksStore(file)
  expect(store.getTask(task.id)?.checklist?.[0].done).toBe(true)
  store.deleteTask(task.id)
  store.restoreTrash(store.listTrash()[0].id)
  expect(store.getTask(task.id)?.source).toEqual(source)
  expect(store.getTask(task.id)?.checklist?.[0].done).toBe(true)
  const backup = store.exportBackup({ preferences: '{}', layoutOrder: '{}', selection: 'all' })
  store.restoreBackup(backup)
  expect(store.getTask(task.id)?.source).toEqual(source)
  expect(store.getTask(task.id)?.status).toBe('done')
  store.close()
})

test('级联删除失败会整体回滚分组、清单和任务', async () => {
  const file = tempFile('delete-rollback.db')
  const store = openTasksStore(file)
  const group = store.createGroup('回滚分组')
  const project = store.createProject('回滚清单', group.id)
  const task = store.createTask({ title: '回滚任务', projectId: project.id })
  const Database = (await import('better-sqlite3')).default
  const db = new Database(file)
  db.exec("CREATE TRIGGER fail_delete_group BEFORE DELETE ON task_groups BEGIN SELECT RAISE(ABORT, '模拟删除失败'); END")
  expect(() => store.deleteGroup(group.id, true)).toThrow('模拟删除失败')
  expect(store.listGroups().some(item => item.id === group.id)).toBe(true)
  expect(store.listProjects().some(item => item.id === project.id)).toBe(true)
  expect(store.listTasks().open.some(item => item.id === task.id)).toBe(true)
  db.close(); store.close()
})
