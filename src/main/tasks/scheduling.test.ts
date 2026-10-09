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

const day = (date: number, hour = 9) => new Date(2030, 0, date, hour).getTime()

test('daily occurrences appear at local midnight even when all previous tasks remain open', () => {
  const file = path(), store = open(file)
  const first = store.createTask({ title: 'Daily', dueAt: day(1), recurrence: 'daily', checklist: [{ id: 'a', title: 'Step', done: true }] })
  expect(store.generateScheduledOccurrences(day(2, 0) - 1)).toBe(0)
  expect(store.generateScheduledOccurrences(day(2, 0))).toBe(1)
  expect(store.generateScheduledOccurrences(day(4, 0))).toBe(2)
  const tasks = store.listTasks().open.sort((a, b) => a.dueAt! - b.dueAt!)
  expect(tasks.map(t => t.dueAt)).toEqual([day(1), day(2), day(3), day(4)])
  expect(new Set(tasks.map(t => t.id)).size).toBe(4)
  expect(store.getTask(first.id)?.checklist?.[0].done).toBe(true)
  expect(tasks.slice(1).every(t => !t.checklist![0].done)).toBe(true)
  store.completeTask(tasks[1].id)
  expect(store.getTask(first.id)?.status).toBe('open')
  expect(store.getTask(tasks[2].id)?.status).toBe('open')
  store.reopenTask(tasks[1].id)
  expect(open(file).generateScheduledOccurrences(day(4, 23))).toBe(0)
  expect(store.listTasks().open).toHaveLength(4)
})

test('calendar count and until bounds include missed occurrences; completed basis waits for completion', () => {
  const store = open()
  store.createTask({ title: 'Count', dueAt: day(1), recurrence: 'custom', repeatRule: { frequency: 'daily', interval: 1, basis: 'scheduled', count: 3 } })
  store.createTask({ title: 'Until', dueAt: day(1), recurrence: 'custom', repeatRule: { frequency: 'daily', interval: 1, basis: 'scheduled', until: day(2) } })
  store.createTask({ title: 'Completion', dueAt: day(1), recurrence: 'custom', repeatRule: { frequency: 'daily', interval: 1, basis: 'completed' } })
  expect(store.generateScheduledOccurrences(day(10))).toBe(3)
  expect(store.listTasks().open.filter(t => t.title === 'Count').map(t => t.recurrenceIndex).sort()).toEqual([1, 2, 3])
  expect(store.listTasks().open.filter(t => t.title === 'Completion')).toHaveLength(1)
  expect(store.generateScheduledOccurrences(day(20))).toBe(0)
})

test('generation is atomic on write failure and retries without duplicates', () => {
  const file = path(), store = open(file), db = new Database(file)
  try {
    store.createTask({ title: 'Retry', dueAt: day(1), recurrence: 'daily' })
    db.exec("CREATE TRIGGER fail_occurrence BEFORE INSERT ON tasks BEGIN SELECT RAISE(ABORT, 'write failed'); END")
    expect(() => store.generateScheduledOccurrences(day(3))).toThrow('write failed')
    expect(store.listTasks().open).toHaveLength(1)
    db.exec('DROP TRIGGER fail_occurrence')
    expect(open(file).generateScheduledOccurrences(day(3))).toBe(2)
    expect(store.generateScheduledOccurrences(day(3))).toBe(0)
  } finally { db.close() }
})

test('archiving pauses generation; changing or deleting the latest occurrence controls future repeats', () => {
  const store = open(), project = store.createProject('Archive')
  const first = store.createTask({ title: 'Daily', projectId: project.id, dueAt: day(1), recurrence: 'daily' })
  store.archiveProject(project.id, true)
  expect(store.generateScheduledOccurrences(day(2))).toBe(0)
  store.archiveProject(project.id, false)
  expect(store.generateScheduledOccurrences(day(2))).toBe(1)
  const next = store.listTasks().open.find(t => t.id !== first.id)!
  store.updateTask(first.id, { dueAt: day(1), recurrence: 'weekly' })
  store.updateTask(next.id, { recurrence: 'none' })
  expect(store.generateScheduledOccurrences(day(20))).toBe(0)
  store.updateTask(next.id, { recurrence: 'daily' })
  store.deleteTask(next.id)
  expect(store.generateScheduledOccurrences(day(20))).toBe(0)
})

test('early reminders materialize the next occurrence before its due date and fire independently', () => {
  const store = open()
  const first = store.createTask({ title: 'Reminder', dueAt: day(1), recurrence: 'daily', reminderTimes: [day(1) - 3600000] })
  store.claimDueReminders(day(1))
  expect(store.generateScheduledOccurrences(day(2, 0))).toBe(1)
  const next = store.listTasks().open.find(t => t.id !== first.id)!
  expect(next.reminders).toEqual([{ at: day(2) - 3600000, firedAt: null }])
  expect(store.claimDueReminders(day(2, 8)).map(t => t.task.id)).toEqual([next.id])
  expect(store.claimDueReminders(day(2, 8))).toEqual([])
  const early = store.createTask({ title: 'Early', dueAt: day(10), recurrence: 'weekly', reminderTimes: [day(8)] })
  expect(store.generateScheduledOccurrences(day(15))).toBeGreaterThan(0)
  expect(store.listTasks().open.some(t => t.title === early.title && t.dueAt === day(17))).toBe(true)
})

test('long downtime is bounded per tick without losing dates, and backup preserves generation markers', () => {
  const store = open()
  store.createTask({ title: 'Catch up', dueAt: day(1), recurrence: 'daily' })
  expect(store.generateScheduledOccurrences(day(401))).toBe(366)
  const backup = store.exportBackup(settings)
  store.restoreBackup(backup)
  expect(store.generateScheduledOccurrences(day(401))).toBe(34)
  expect(store.generateScheduledOccurrences(day(401))).toBe(0)
  expect(store.listTasks().open).toHaveLength(401)
})

test('multiple reminders claim once each across restart; title edits preserve fired markers', () => {
  const file = path(), store = open(file)
  const task = store.createTask({ title: '提醒', dueAt: 1000, reminderTimes: [100, 200, 300] })
  expect(store.claimDueReminders(100).map(t => t.task.id)).toEqual([task.id])
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
test('子项提醒按子项逐条领取，标题为任务·子项，重启后不重复', () => {
  const file = path(), store = open(file)
  const task = store.createTask({ title: '父任务', dueAt: 2000, checklist: [
    { id: 'a', title: '子项甲', done: false, dueAt: 100, reminders: [{ at: 90, firedAt: null }] },
    { id: 'b', title: '子项乙', done: false, dueAt: 300, reminders: [{ at: 280, firedAt: null }] }
  ] })
  const first = store.claimDueReminders(100)
  expect(first.map(entry => entry.itemTitle)).toEqual(['子项甲'])
  expect(store.getTask(task.id)!.checklist![0].reminders![0].firedAt).toBe(100)
  expect(store.claimDueReminders(200)).toEqual([])
  const restarted = open(file)
  const second = restarted.claimDueReminders(300)
  expect(second.map(entry => entry.itemTitle)).toEqual(['子项乙'])
  expect(second[0].task.title).toBe('父任务')
})
test('同轮任务级与子项级提醒各发一条且原子记录', () => {
  const store = open()
  const task = store.createTask({ title: '混合', dueAt: 1000, reminderTimes: [900], checklist: [
    { id: 'a', title: '步骤', done: false, dueAt: 950, reminders: [{ at: 940, firedAt: null }] }
  ] })
  const claimed = store.claimDueReminders(1000)
  expect(claimed.map(entry => entry.itemTitle ?? null)).toEqual([null, '步骤'])
  expect(claimed[0].task.remindFiredAt).toBe(1000)
  expect(store.claimDueReminders(1000)).toEqual([])
})
test('重复任务下一期重置子项勾选并按周期偏移子项时间与提醒', () => {
  const store = open()
  const due = new Date(2030, 0, 1, 9).getTime()
  vi.spyOn(Date, 'now').mockReturnValue(due)
  const task = store.createTask({ title: '每周复查', dueAt: due, recurrence: 'weekly', checklist: [
    { id: 'a', title: '整理', done: true, dueAt: due + 60_000, reminders: [{ at: due + 30_000, firedAt: 123 }] }
  ] })
  store.completeTask(task.id)
  store.generateScheduledOccurrences(due + 7 * 86_400_000)
  const next = store.listTasks().open[0]
  expect(next.dueAt).toBe(due + 7 * 86_400_000)
  const item = next.checklist![0]
  expect(item.done).toBe(false)
  expect(item.dueAt).toBe(due + 7 * 86_400_000 + 60_000)
  expect(item.reminders).toEqual([{ at: due + 7 * 86_400_000 + 30_000, firedAt: null }])
})
