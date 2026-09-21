import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import { openTasksStore, type TasksStore } from './store'
const stores: TasksStore[] = [], directories: string[] = []
const path = () => { const dir = mkdtempSync(join(tmpdir(), 'chouyu-schedule-')); directories.push(dir); return join(dir, 'tasks.db') }
const open = (file = path()) => { const store = openTasksStore(file); stores.push(store); return store }
afterEach(() => { vi.restoreAllMocks(); for (const s of stores.splice(0)) s.close(); for (const d of directories.splice(0)) rmSync(d, { recursive: true, force: true }) })
const settings = { preferences: '{}', layoutOrder: '{}', selection: 'all' }

test('multiple reminders claim once each across restart; title edits preserve fired markers', () => {
  const file = path(), store = open(file)
  const task = store.createTask({ title: '提醒', dueAt: 1000, reminderTimes: [100, 200, 300] })
  expect(store.claimDueReminders(100).map(t => t.id)).toEqual([task.id])
  store.updateTask(task.id, { title: '新标题', reminderTimes: [100, 200, 300] })
  expect(store.claimDueReminders(100)).toEqual([])
  const restarted = open(file)
  expect(restarted.claimDueReminders(200)).toHaveLength(1)
  expect(store.claimDueReminders(200)).toEqual([])
  expect(restarted.claimDueReminders(300)).toHaveLength(1)
  expect(store.claimDueReminders(10000)).toEqual([])
})
test('missed alerts coalesce by task; archived and completed tasks do not alert', () => {
  const store = open(), project = store.createProject('归档')
  const task = store.createTask({ title: '任务', projectId: project.id, reminderTimes: [10, 20, 30] })
  store.archiveProject(project.id, true)
  expect(store.claimDueReminders(25)).toEqual([])
  store.archiveProject(project.id, false)
  expect(store.claimDueReminders(25)).toHaveLength(1)
  expect(store.getTask(task.id)!.reminders!.filter(r => r.firedAt !== null)).toHaveLength(2)
  store.completeTask(task.id)
  expect(store.claimDueReminders(30)).toEqual([])
})
test('rescheduling shifts every reminder; clearing dates clears relative reminders and repeating', () => {
  const store = open()
  const task = store.createTask({ title: '改期', dueAt: 1000, reminderTimes: [500, 750], recurrence: 'daily' })
  store.claimDueReminders(600)
  const changed = store.updateTask(task.id, { dueAt: 2000 })
  expect(changed.reminders).toEqual([{ at: 1500, firedAt: null }, { at: 1750, firedAt: null }])
  const cleared = store.updateTask(task.id, { dueAt: null })
  expect(cleared.reminders).toEqual([]); expect(cleared.recurrence).toBe('none')
})
test('series count survives restart and reopening cannot create a duplicate successor', () => {
  const store = open()
  const due = new Date(2030, 0, 1, 9).getTime()
  vi.spyOn(Date, 'now').mockReturnValue(due)
  const task = store.createTask({ title: '两次', dueAt: due, reminderTimes: [due - 60000, due], recurrence: 'custom', repeatRule: { frequency: 'daily', interval: 3, basis: 'completed', count: 2 }, checklist: [{ id: 'a', title: '子项', done: true }] })
  store.completeTask(task.id)
  const next = store.listTasks().open[0]
  expect(next.dueAt).toBe(due + 3 * 86400000); expect(next.recurrenceIndex).toBe(2)
  expect(next.reminders!.map(r => r.at)).toEqual([next.dueAt! - 60000, next.dueAt!])
  expect(next.checklist![0].done).toBe(false)
  store.reopenTask(task.id); store.completeTask(task.id)
  expect(store.listTasks().open).toHaveLength(1)
  store.completeTask(next.id)
  expect(store.listTasks().open).toHaveLength(0)
})
test('v9 migration retains sent reminders and activates only supported imported rules', () => {
  const file = path(), store = open(file)
  store.createTask({ title: '提醒', remindAt: 100 }); store.claimDueReminders(101)
  const imported = store.createTask({ title: '农历生日', dueAt: Date.now(), note: '原重复规则：LUNAR:FREQ=YEARLY;INTERVAL=1;BYMONTH=7;BYMONTHDAY=26\n此重复规则仅保留记录，ChouYu 暂不支持自动重复。' })
  const disabled = store.createTask({ title: '手动停用的重复', dueAt: Date.now(), note: '原重复规则：RRULE:FREQ=DAILY;INTERVAL=1' })
  const db = new Database(file)
  db.prepare('UPDATE tasks SET id=? WHERE id=?').run('dida:test:birthday', imported.id)
  db.prepare('UPDATE tasks SET id=? WHERE id=?').run('dida:test:disabled', disabled.id)
  db.exec('ALTER TABLE tasks DROP COLUMN reminders; ALTER TABLE tasks DROP COLUMN repeat_rule; ALTER TABLE tasks DROP COLUMN recurrence_index; PRAGMA user_version=9')
  db.close()
  const migrated = open(file)
  expect(migrated.claimDueReminders(Date.now())).toEqual([])
  expect(migrated.getTask('dida:test:birthday')!.repeatRule?.frequency).toBe('lunarYearly')
  expect(migrated.getTask('dida:test:birthday')!.note).toContain('已启用')
  expect(migrated.getTask('dida:test:disabled')!.recurrence).toBe('none')
})
test('new backups, legacy backups and trash preserve scheduling and fired state', () => {
  const store = open()
  const task = store.createTask({ title: '备份', dueAt: 1000, reminderTimes: [10, 20], recurrence: 'custom', repeatRule: { frequency: 'weekly', interval: 2, basis: 'scheduled', weekdays: [1, 5] } })
  store.claimDueReminders(10)
  const backup = store.exportBackup(settings)
  store.validateBackup(backup); store.restoreBackup(backup)
  expect(store.claimDueReminders(10)).toEqual([])
  store.deleteTask(task.id)
  store.validateBackup(store.exportBackup(settings))
  store.restoreTrash(store.listTrash()[0].id)
  expect(store.getTask(task.id)!.repeatRule?.weekdays).toEqual([1, 5])
  const legacy = structuredClone(backup); legacy.schemaVersion = 9
  for (const row of legacy.tables.tasks) { delete row.repeat_rule; delete row.recurrence_index; delete row.reminders; row.recurrence = 'daily'; row.remind_fired_at = 10 }
  store.restoreBackup(legacy)
  expect(store.getTask(task.id)!.reminders).toEqual([{ at: 10, firedAt: 10 }])
})
