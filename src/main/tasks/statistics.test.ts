import { afterEach, expect, it, vi } from 'vitest'
import { openTasksStore } from './store'

afterEach(() => vi.useRealTimers())
it('counts all retained completions beyond list pagination and excludes archived and reopened tasks', () => {
  vi.useFakeTimers()
  const now = new Date(2026, 9, 30, 12).getTime()
  vi.setSystemTime(now)
  const store = openTasksStore(':memory:')
  try {
    for (let n = 0; n < 65; n++) store.completeTask(store.createTask({ title: `Done ${n}` }).id)
    const reopened = store.createTask({ title: 'Reopen' }); store.completeTask(reopened.id); store.reopenTask(reopened.id)
    const project = store.createProject('Archive')
    store.completeTask(store.createTask({ title: 'Archived', projectId: project.id }).id); store.archiveProject(project.id, true)
    expect(store.statistics(7, now)).toMatchObject({ open: 1, done: 65, completed: 65 })
    expect(store.statistics(7, now).days.at(-1)).toMatchObject({ date: '2026-10-30', completed: 65 })
    expect(store.listTasks().done).toHaveLength(50)
    expect(() => store.statistics(100 as never, now)).toThrow()
  } finally { store.close() }
})
it('uses local date boundaries and excludes events outside the requested range', () => {
  vi.useFakeTimers()
  const store = openTasksStore(':memory:')
  try {
    for (const day of [23, 24, 29, 30]) {
      vi.setSystemTime(new Date(2026, 9, day, 0))
      store.completeTask(store.createTask({ title: `Day ${day}` }).id)
    }
    const result = store.statistics(7, new Date(2026, 9, 30, 12).getTime())
    expect(result.days.map(day => day.completed)).toEqual([1, 0, 0, 0, 0, 1, 1])
    expect(result).toMatchObject({ done: 4, completed: 3 })
    expect(store.statistics(30).days).toHaveLength(30)
  } finally { store.close() }
})
