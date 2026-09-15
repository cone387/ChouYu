import { describe, expect, test } from 'vitest'
import {
  compareTasks, isDueThisWeek, isDueToday, isOverdue, nextRecurrenceDueAt, remindAtFromChoice, TASK_PRIORITY_ORDER
} from './tasks'
import type { RemindChoiceId, TaskRecord } from './tasks'

const base = (patch: Partial<TaskRecord> = {}): TaskRecord => ({
  id: 't', title: '任务', note: '', projectId: null, priority: 'medium', status: 'open',
  dueAt: null, remindAt: null, remindFiredAt: null, recurrence: 'none', recurrenceAnchorAt: null,
  createdAt: 1_000, updatedAt: 1_000, completedAt: null, ...patch
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
