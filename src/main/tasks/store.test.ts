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
afterEach(() => { for (const directory of directories) rmSync(directory, { recursive: true, force: true }) })

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

  test('损坏文件被隔离并重建空库', () => {
    const file = tempFile('tasks.db')
    writeFileSync(file, 'this is definitely not a sqlite database')
    const store = openTasksStore(file)
    const result = store.listTasks()
    expect(result.open).toHaveLength(0)
    expect(result.quarantinedAt).toBeGreaterThan(0)
    const siblings = readdirSync(join(file, '..')).filter(name => name.includes('corrupt'))
    expect(siblings.length).toBeGreaterThan(0)
    store.close()
  })
})
