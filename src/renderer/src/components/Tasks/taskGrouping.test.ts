import { describe, expect, it } from 'vitest'
import type { TaskRecord, TaskSelectField } from '../../../../shared/tasks'
import { groupTasks } from './taskGrouping'

const task = (id: string, patch: Partial<TaskRecord> = {}): TaskRecord => ({
  id, title: id, note: '', projectId: null, priority: 'medium', status: 'open', startAt: null,
  dueAt: null, remindAt: null, remindFiredAt: null, recurrence: 'none', recurrenceAnchorAt: null,
  customFields: {}, createdAt: 1, updatedAt: 1, completedAt: null, ...patch
})

describe('task display grouping', () => {
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
