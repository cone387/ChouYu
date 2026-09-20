import { describe, expect, it } from 'vitest'
import type { TaskRecord, TaskSelectField } from '../../../../shared/tasks'
import { groupTasks, taskGroupMove } from './taskGrouping'

const task = (id: string, patch: Partial<TaskRecord> = {}): TaskRecord => ({
  id, title: id, note: '', projectId: null, priority: 'medium', status: 'open', startAt: null,
  dueAt: null, remindAt: null, remindFiredAt: null, recurrence: 'none', recurrenceAnchorAt: null,
  customFields: {}, createdAt: 1, updatedAt: 1, completedAt: null, ...patch
})

describe('task display grouping', () => {
  const at = (day: number, hour = 0) => new Date(2026, 8, day, hour).getTime()
  it('keeps two status columns and requests real completion transitions', () => {
    const open = task('open'), done = task('done', { status: 'done', completedAt: at(16) })
    const columns = groupTasks([open, done], [], [], 'status', null)
    expect(columns.map(column => column.tasks.map(task => task.id))).toEqual([['open'], ['done']])
    expect(taskGroupMove(open, 'status', columns[1], false)).toEqual({ patch: {}, status: 'done' })
    expect(taskGroupMove(done, 'status', columns[0], false)).toEqual({ patch: {}, status: 'open' })
    expect(columns[1].canCreate).toBe(false)
    expect(groupTasks([], [], [], 'status', null)).toHaveLength(2)
  })
  it('shows seven dates with spanning work once, and completion on its actual day', () => {
    const tasks = [task('single', { dueAt: at(16, 18) }), task('spanning', { startAt: at(1), dueAt: at(30) }),
      task('ongoing', { startAt: at(15) }), task('done', { startAt: at(1), status: 'done', completedAt: at(16) })]
    const columns = groupTasks(tasks, [], [], 'week', null, at(16))
    expect(columns.filter(column => column.date != null)).toHaveLength(7)
    expect(columns.find(column => column.date === at(16))?.tasks.map(task => task.id)).toEqual(['single', 'done'])
    expect(columns.find(column => column.key === 'spanning')?.tasks.map(task => task.id)).toEqual(['spanning', 'ongoing'])
    expect(columns.flatMap(column => column.tasks)).toHaveLength(4)
    expect(columns.find(column => column.date === at(16))?.label).toContain('今天')
  })
  it('reschedules single-day work with times and reminder offset intact, refusing historical and spanning moves', () => {
    const columns = groupTasks([], [], [], 'week', null, at(16))
    const thursday = columns.find(column => column.date === at(17))!
    const original = task('a', { startAt: at(16, 9), dueAt: at(16, 18), remindAt: at(16, 17) })
    expect(taskGroupMove(original, 'week', thursday, false)?.patch).toEqual({ startAt: at(17, 9), dueAt: at(17, 18), remindAt: at(17, 17) })
    expect(taskGroupMove(task('due', { dueAt: at(16, 18) }), 'week', thursday, false)?.patch).toEqual({ dueAt: at(17, 18) })
    expect(taskGroupMove(task('ongoing', { startAt: at(16) }), 'week', thursday, false)).toBeNull()
    expect(taskGroupMove(task('span', { startAt: at(15), dueAt: at(18) }), 'week', thursday, false)).toBeNull()
    expect(taskGroupMove(task('done', { status: 'done', completedAt: at(16) }), 'week', thursday, false)).toBeNull()
    expect(original.dueAt).toBe(at(16, 18))
  })
  it('uses disjoint overdue and completion buckets with immutable cross-group dates', () => {
    const overdue = groupTasks([1, 3, 4, 7, 8].map(days => task(String(days), { dueAt: at(16 - days) })), [], [], 'overdue', null, at(16))
    expect(overdue.map(column => column.tasks.map(task => task.id))).toEqual([['8'], ['4', '7'], ['1', '3']])
    const completed = groupTasks([0, 1, 2, 6, 7].map(days => task(String(days), { status: 'done', dueAt: at(1), completedAt: at(16 - days) })), [], [], 'completed', null, at(16))
    expect(completed.map(column => column.tasks.map(task => task.id))).toEqual([['0'], ['1'], ['2', '6'], ['7']])
    for (const [mode, columns] of [['overdue', overdue], ['completed', completed]] as const) {
      expect(taskGroupMove(columns[0].tasks[0], mode, columns[1], false)).toBeNull()
      expect(taskGroupMove(columns[0].tasks[0], mode, columns[0], true)).toEqual({ patch: {} })
      expect(columns.every(column => column.canCreate === false)).toBe(true)
    }
  })
  it('keeps manual groups independent of automatic grouping and preserves tasks when a group is deleted', () => {
    const tasks = [task('a'), task('b'), task('c')]
    const groups = [{ id: 'requirements', name: '需求', taskIds: ['a', 'hidden'] }, { id: 'work', name: '执行', taskIds: ['b'] }]
    const collect = (items: typeof groups) => groupTasks(tasks, [], [], 'custom', null, 0, items).map(group => [group.label, group.tasks.map(task => task.id)])
    expect(collect(groups)).toEqual([['需求', ['a']], ['执行', ['b']], ['未分组', ['c']]])
    expect(groupTasks(tasks, [], [], 'priority', null, 0, groups)[1].tasks).toHaveLength(3)
    expect(collect(groups.slice(1))).toEqual([['执行', ['b']], ['未分组', ['a', 'c']]])
    expect(tasks).toHaveLength(3)
  })
  it('groups every task once by local due date, including midnight and year boundaries', () => {
    const now = new Date(2026, 11, 31, 12).getTime()
    const today = new Date(2026, 11, 31).getTime()
    const tomorrow = new Date(2027, 0, 1).getTime()
    const later = new Date(2027, 0, 2).getTime()
    const tasks = [task('past', { dueAt: today - 1 }), task('today', { dueAt: today }),
      task('tonight', { dueAt: tomorrow - 1 }), task('tomorrow', { dueAt: tomorrow }),
      task('later', { dueAt: later }), task('none', { startAt: now }),
      task('completed', { dueAt: today - 1, status: 'done', completedAt: now })]
    const snapshot = JSON.stringify(tasks)
    const groups = groupTasks(tasks, [], [], 'due', null, now)
    expect(groups.map(group => [group.key, group.tasks.map(task => task.id)])).toEqual([
      ['past', ['past', 'completed']], ['today', ['today', 'tonight']],
      ['tomorrow', ['tomorrow']], ['later', ['later']], ['none', ['none']]
    ])
    expect(JSON.stringify(tasks)).toBe(snapshot)
    expect(groups.every(group => Object.keys(group.patch).length === 0)).toBe(true)
  })

  it('updates the display group when a task deadline changes', () => {
    const now = new Date(2026, 8, 20, 12).getTime()
    const original = task('a')
    expect(groupTasks([original], [], [], 'due', null, now).find(group => group.key === 'none')?.tasks).toHaveLength(1)
    const groups = groupTasks([{ ...original, dueAt: now }], [], [], 'due', null, now)
    expect(groups.find(group => group.key === 'today')?.tasks).toHaveLength(1)
    expect(groups.find(group => group.key === 'none')?.tasks).toHaveLength(0)
  })

  it('supports priority and custom field display groups without changing task data', () => {
    const field = { id: 'stage', name: '阶段', options: [{ id: 'doing', name: '进行中' }] } as TaskSelectField
    const tasks = [task('high', { priority: 'high', customFields: { stage: 'doing' } }), task('unset')]
    expect(groupTasks(tasks, [], [], 'priority', null)[0].tasks.map(task => task.id)).toEqual(['high'])
    expect(groupTasks(tasks, [], [field], 'field', 'stage').map(group => [group.label, group.tasks.map(task => task.id)])).toEqual([
      ['进行中', ['high']], ['未设置', ['unset']]
    ])
  })
})
