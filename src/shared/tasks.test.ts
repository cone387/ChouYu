import { describe, expect, test } from 'vitest'
import {
  compareTasks, isUnplanned, isDueThisWeek, isDueToday, isOverdue, matchesTaskView, nextRecurrenceDueAt, remindAtFromChoice, sortTasks, TASK_PRIORITY_ORDER
} from './tasks'
import type { RemindChoiceId, TaskRecord, TaskView } from './tasks'
import { matchesTaskSchedule, taskScheduleBounds } from './tasks'

const base = (patch: Partial<TaskRecord> = {}): TaskRecord => ({
  id: 't', title: '任务', note: '', projectId: null, priority: 'medium', status: 'open',
  dueAt: null, remindAt: null, remindFiredAt: null, recurrence: 'none', recurrenceAnchorAt: null,
  customFields: {}, createdAt: 1_000, updatedAt: 1_000, completedAt: null, ...patch
})

describe('remindAtFromChoice', () => {
  test('按截止时刻与提前量计算,none 或无截止返回 null', () => {
    expect(remindAtFromChoice('due', 5_000)).toBe(5_000)
    expect(remindAtFromChoice('m30', 5_000)).toBe(5_000 - 30 * 60_000)
    expect(remindAtFromChoice('none', 5_000)).toBeNull()
    expect(remindAtFromChoice('due', null)).toBeNull()
    expect(remindAtFromChoice('bogus' as RemindChoiceId, 5_000)).toBeNull()
  })
})

describe('smart view helpers', () => {
  test('过期=截止在今天零点前,今天=本日之内,互不重叠', () => {
    const now = new Date('2026-09-14T15:00:00').getTime()
    const startToday = new Date('2026-09-14T00:00:00').getTime()
    const yesterday = base({ dueAt: startToday - 1 })
    const thisMorning = base({ dueAt: startToday + 1 })
    const tonight = base({ dueAt: startToday + 23 * 3600_000 })
    const tomorrow = base({ dueAt: startToday + 25 * 3600_000 })
    expect(isOverdue(yesterday, now)).toBe(true)
    expect(isOverdue(thisMorning, now)).toBe(false)
    expect(isDueToday(thisMorning, now)).toBe(true)
    expect(isDueToday(tonight, now)).toBe(true)
    expect(isDueToday(tomorrow, now)).toBe(false)
    expect(isOverdue(base({ status: 'done', dueAt: 1 }), now)).toBe(false)
  })
  test('本周=本周一零点到周日末,以本地时区', () => {
    const now = new Date('2026-09-16T10:00:00').getTime() // 周三
    const monday = new Date('2026-09-14T00:00:00').getTime()
    const sundayNight = new Date('2026-09-20T23:00:00').getTime()
    const nextMonday = new Date('2026-09-21T00:00:00').getTime()
    expect(isDueThisWeek(base({ dueAt: monday }), now)).toBe(true)
    expect(isDueThisWeek(base({ dueAt: sundayNight }), now)).toBe(true)
    expect(isDueThisWeek(base({ dueAt: nextMonday }), now)).toBe(false)
  })
})

describe('compareTasks', () => {
  const now = new Date('2026-09-14T15:00:00').getTime()
  const startToday = new Date('2026-09-14T00:00:00').getTime()
  test('过期 > 今日 > 其他;同级按优先级、截止时刻、创建时间倒序', () => {
    const overdue = base({ id: 'a', dueAt: startToday - 1 })
    const today = base({ id: 'b', dueAt: startToday + 3600_000 })
    const future = base({ id: 'c', dueAt: startToday + 3 * 86400_000 })
    expect(compareTasks(overdue, today, now)).toBeLessThan(0)
    expect(compareTasks(today, future, now)).toBeLessThan(0)
    const high = base({ id: 'd', priority: 'high' })
    const low = base({ id: 'e', priority: 'low' })
    expect(compareTasks(high, low, now)).toBeLessThan(0)
    expect(TASK_PRIORITY_ORDER.high).toBeLessThan(TASK_PRIORITY_ORDER.medium)
    const earlier = base({ id: 'f', dueAt: 20_000 })
    const later = base({ id: 'g', dueAt: 21_000 })
    expect(compareTasks(earlier, later, now)).toBeLessThan(0)
    const noDue = base({ id: 'h', dueAt: null })
    expect(compareTasks(noDue, earlier, now)).toBeGreaterThan(0)
    const newer = base({ id: 'i', createdAt: 2_000 })
    expect(compareTasks(newer, base({ id: 'j', createdAt: 1_500 }), now)).toBeLessThan(0)
  })
})

describe('sortTasks', () => {
  const now = new Date('2026-09-15T12:00:00').getTime()
  const ids = (tasks: TaskRecord[]) => tasks.map(task => task.id)

  test('按截止时间升序,无截止排最后,同截止回退智能排序', () => {
    const noDue = base({ id: 'none' })
    const far = base({ id: 'far', dueAt: 30_000 })
    const near = base({ id: 'near', dueAt: 20_000 })
    expect(ids(sortTasks([noDue, far, near], 'due', now))).toEqual(['near', 'far', 'none'])
    const a = base({ id: 'a', dueAt: 20_000, priority: 'low' })
    const b = base({ id: 'b', dueAt: 20_000, priority: 'high' })
    expect(ids(sortTasks([a, b], 'due', now))).toEqual(['b', 'a'])
  })

  test('按优先级高到低,同级回退智能排序', () => {
    const high = base({ id: 'high', priority: 'high' })
    const low = base({ id: 'low', priority: 'low' })
    const medium = base({ id: 'medium', priority: 'medium' })
    expect(ids(sortTasks([low, high, medium], 'priority', now))).toEqual(['high', 'medium', 'low'])
  })

  test('按创建时间倒序,按标题本地化比较,smart 走 compareTasks', () => {
    const older = base({ id: 'older', createdAt: 1_000 })
    const newer = base({ id: 'newer', createdAt: 2_000 })
    expect(ids(sortTasks([older, newer], 'created', now))).toEqual(['newer', 'older'])
    const bTask = base({ id: 'b', title: '备份' })
    const aTask = base({ id: 'a', title: '安装' })
    expect(ids(sortTasks([bTask, aTask], 'title', now))).toEqual(['a', 'b'])
    const input = [base({ id: 'x' }), base({ id: 'y' })]
    expect(sortTasks(input, 'smart', now)).not.toBe(input)
  })
})

describe('nextRecurrenceDueAt', () => {
  test('handles daily, weekly and month end without overflowing the month', () => {
    const jan31 = new Date(2026, 0, 31, 9, 0).getTime()
    expect(nextRecurrenceDueAt(jan31, 'daily')).toBe(new Date(2026, 1, 1, 9, 0).getTime())
    expect(nextRecurrenceDueAt(jan31, 'weekly')).toBe(new Date(2026, 1, 7, 9, 0).getTime())
    expect(nextRecurrenceDueAt(jan31, 'monthly')).toBe(new Date(2026, 1, 28, 9, 0).getTime())
    expect(nextRecurrenceDueAt(new Date(2026, 1, 28, 9, 0).getTime(), 'monthly', jan31)).toBe(new Date(2026, 2, 31, 9, 0).getTime())
    expect(nextRecurrenceDueAt(jan31, 'none')).toBeNull()
  })

  test('notBefore 跳过已错过的周期并保持月度锚点日', () => {
    const jan31 = new Date(2026, 0, 31, 9, 0).getTime()
    const notBefore = new Date(2026, 1, 28, 9, 0).getTime()
    expect(nextRecurrenceDueAt(new Date(2026, 0, 1, 9, 0).getTime(), 'daily', undefined, notBefore)).toBe(new Date(2026, 2, 1, 9, 0).getTime())
    expect(nextRecurrenceDueAt(jan31, 'monthly', jan31, notBefore)).toBe(new Date(2026, 2, 31, 9, 0).getTime())
    expect(nextRecurrenceDueAt(jan31, 'monthly', jan31, -Infinity)).toBe(new Date(2026, 1, 28, 9, 0).getTime())
  })
})

describe('matchesTaskView', () => {
  const now = new Date('2026-09-15T12:00:00').getTime()
  const startToday = new Date('2026-09-15T00:00:00').getTime()
  const view = (patch: Partial<TaskView> = {}): TaskView => ({
    id: 'v', name: '视图', projectIds: [], priorities: [], dueRange: 'any',
    createdAt: 1, updatedAt: 1, ...patch
  })

  test('空 projectIds/priorities 表示不过滤,any 不限截止', () => {
    const task = base({ projectId: 'p1', priority: 'low', dueAt: null })
    expect(matchesTaskView(task, view(), now)).toBe(true)
  })

  test('项目与优先级为 AND 组合,多值为包含匹配', () => {
    const task = base({ projectId: 'p1', priority: 'high' })
    expect(matchesTaskView(task, view({ projectIds: ['p1'], priorities: ['high', 'low'] }), now)).toBe(true)
    expect(matchesTaskView(task, view({ projectIds: ['p2'] }), now)).toBe(false)
    expect(matchesTaskView(task, view({ priorities: ['medium'] }), now)).toBe(false)
    expect(matchesTaskView(base({ projectId: null }), view({ projectIds: ['p1'] }), now)).toBe(false)
  })

  test('截止范围:今天与侧栏口径一致，不包含更早过期任务', () => {
    const overdue = base({ dueAt: startToday - 1 })
    const today = base({ dueAt: startToday + 1 })
    const noDue = base({ dueAt: null })
    expect(matchesTaskView(overdue, view({ dueRange: 'today' }), now)).toBe(false)
    expect(matchesTaskView(today, view({ dueRange: 'today' }), now)).toBe(true)
    expect(matchesTaskView(today, view({ dueRange: 'overdue' }), now)).toBe(false)
    expect(matchesTaskView(overdue, view({ dueRange: 'overdue' }), now)).toBe(true)
    expect(matchesTaskView(noDue, view({ dueRange: 'none' }), now)).toBe(true)
    expect(matchesTaskView(today, view({ dueRange: 'none' }), now)).toBe(false)
  })
})


test('待规划仅包含开始和截止都未设置的未完成任务', () => {
  expect(isUnplanned(base())).toBe(true)
  expect(isUnplanned(base({ startAt: null, dueAt: null }))).toBe(true)
  expect(isUnplanned(base({ startAt: 0 }))).toBe(false)
  expect(isUnplanned(base({ dueAt: 0 }))).toBe(false)
  expect(isUnplanned(base({ startAt: 100, dueAt: 200 }))).toBe(false)
  expect(isUnplanned(base({ status: 'done' }))).toBe(false)
})

describe('execution schedule presets', () => {
  const at = (day: number, hour = 0) => new Date(2026, 8, day, hour).getTime()
  const now = at(16, 12)

  test.each([
    [undefined, null, false], [null, null, false],
    [at(15), null, true], [at(16, 23), null, true], [at(17), null, false],
    [at(15), at(17), true], [at(16, 23), at(16, 23), true],
    [at(14), at(15, 23), false], [at(17), at(18), false],
    [null, at(16), true], [undefined, at(16, 23), true],
    [null, at(15, 23), false], [null, at(17), false],
    [at(15), at(16), true]
  ])('start %s / due %s belongs to today: %s', (startAt, dueAt, expected) => {
    const task = base({ startAt, dueAt })
    expect(matchesTaskSchedule(task, 'today', now)).toBe(expected)
    if (expected) {
      expect(isOverdue(task, now)).toBe(false)
      expect(isUnplanned(task)).toBe(false)
    }
  })

  test('tomorrow uses the same four cases without changing the stored dates', () => {
    const task = base({ startAt: null, dueAt: at(17, 9) })
    expect(matchesTaskSchedule(task, 'today', now)).toBe(false)
    expect(matchesTaskSchedule(task, 'tomorrow', now)).toBe(true)
    expect(task.startAt).toBeNull()
    expect(matchesTaskSchedule(base({ startAt: at(15) }), 'tomorrow', now)).toBe(true)
    expect(matchesTaskSchedule(base({ startAt: at(15), dueAt: at(16, 23) }), 'tomorrow', now)).toBe(false)
    expect(matchesTaskSchedule(base(), 'tomorrow', now)).toBe(false)
  })

  test('week includes intersecting intervals and both endpoint days, excluding next Monday', () => {
    expect(taskScheduleBounds('week', now)).toEqual([at(14), at(21)])
    expect(taskScheduleBounds('week', at(20, 23))).toEqual([at(14), at(21)])
    for (const task of [base({ startAt: at(1) }), base({ startAt: at(1), dueAt: at(30) }), base({ dueAt: at(14) }), base({ startAt: at(20, 23) })]) {
      expect(matchesTaskSchedule(task, 'week', now)).toBe(true)
    }
    for (const task of [base(), base({ dueAt: at(13, 23) }), base({ startAt: at(21) }), base({ dueAt: at(21) })]) {
      expect(matchesTaskSchedule(task, 'week', now)).toBe(false)
    }
  })

  test('completed tasks use completion date, including late and unplanned work, and stop rolling forward', () => {
    for (const dates of [{ startAt: at(1) }, { dueAt: at(15) }, { dueAt: at(20) }, {}]) {
      const task = base({ ...dates, status: 'done', completedAt: at(16, 9) })
      expect(matchesTaskSchedule(task, 'today', now)).toBe(true)
      expect(matchesTaskSchedule(task, 'tomorrow', now)).toBe(false)
      expect(matchesTaskSchedule(task, 'today', at(17))).toBe(false)
      expect(matchesTaskSchedule(task, 'week', now)).toBe(true)
      expect(matchesTaskSchedule(task, 'week', at(21))).toBe(false)
    }
    expect(matchesTaskSchedule(base({ status: 'done', dueAt: now, completedAt: at(15, 23) }), 'today', now)).toBe(false)
    expect(matchesTaskSchedule(base({ status: 'done', completedAt: null }), 'today', now)).toBe(false)
    expect(matchesTaskSchedule(base({ status: 'done', completedAt: at(16) }), 'today', now)).toBe(true)
    expect(matchesTaskSchedule(base({ status: 'done', completedAt: at(17) }), 'today', now)).toBe(false)
  })
})

test('待规划与今天、本周互斥，今天属于本周；创建日期不决定视图', () => {
  const now = new Date(2026, 8, 16, 12).getTime()
  const noSchedule = base({ createdAt: now, startAt: null, dueAt: null })
  const dueToday = base({ dueAt: now })
  const startOnly = base({ startAt: now, dueAt: null })
  expect(isUnplanned(noSchedule)).toBe(true)
  expect(isDueToday(noSchedule, now)).toBe(false)
  expect(isDueThisWeek(noSchedule, now)).toBe(false)
  expect(isUnplanned(dueToday)).toBe(false)
  expect(isDueToday(dueToday, now)).toBe(true)
  expect(isDueThisWeek(dueToday, now)).toBe(true)
  expect(isUnplanned(startOnly)).toBe(false)
  expect(isDueToday(startOnly, now)).toBe(false)
  for (const offset of [-8, -1, 0, 1, 8]) {
    const task = base({ dueAt: now + offset * 86400_000 })
    expect(isUnplanned(task) && isDueToday(task, now)).toBe(false)
  }
})
