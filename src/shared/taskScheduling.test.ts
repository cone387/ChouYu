import { describe, expect, test } from 'vitest'
import { nextTaskOccurrence, parseImportedRepeatRule, validateRepeatRule, validateReminderTimes } from './taskScheduling'

const at = (year: number, month: number, day: number, hour = 9) => new Date(year, month - 1, day, hour).getTime()
describe('repeat scheduling', () => {
  test('preserves January 31 anchor across short months and leap years', () => {
    const anchor = at(2028, 1, 31)
    expect(nextTaskOccurrence(anchor, 'monthly')).toBe(at(2028, 2, 29))
    expect(nextTaskOccurrence(at(2028, 2, 29), 'monthly', null, anchor)).toBe(at(2028, 3, 31))
    expect(nextTaskOccurrence(at(2024, 2, 29), 'yearly', null, at(2024, 2, 29), at(2027, 3, 1))).toBe(at(2028, 2, 29))
  })
  test('workdays and alternate weeks skip weekends without losing interval alignment', () => {
    expect(nextTaskOccurrence(at(2026, 9, 18), 'weekdays')).toBe(at(2026, 9, 21))
    const rule = { frequency: 'weekly', interval: 2, basis: 'scheduled', weekdays: [1, 3] } as const
    expect(nextTaskOccurrence(at(2026, 9, 21), 'custom', { ...rule, weekdays: [...rule.weekdays] })).toBe(at(2026, 9, 23))
    expect(nextTaskOccurrence(at(2026, 9, 23), 'custom', { ...rule, weekdays: [...rule.weekdays] }, at(2026, 9, 21))).toBe(at(2026, 10, 5))
  })
  test('multiple month dates and month-end deduplicate clamped dates', () => {
    const rule = { frequency: 'monthly', interval: 1, basis: 'scheduled', monthDays: [10, 11, -1] } as const
    expect(nextTaskOccurrence(at(2026, 9, 10), 'custom', { ...rule, monthDays: [...rule.monthDays] })).toBe(at(2026, 9, 11))
    expect(nextTaskOccurrence(at(2026, 9, 11), 'custom', { ...rule, monthDays: [...rule.monthDays] })).toBe(at(2026, 9, 30))
    expect(nextTaskOccurrence(at(2026, 2, 28), 'custom', { ...rule, monthDays: [30, 31] }, at(2026, 1, 30))).toBe(at(2026, 3, 30))
  })
  test('completion-based intervals start from actual completion time', () => {
    const due = at(2026, 9, 21), completed = at(2026, 9, 23, 14)
    expect(nextTaskOccurrence(due, 'custom', { frequency: 'daily', interval: 3, basis: 'completed' }, due, completed)).toBe(at(2026, 9, 26, 14))
    expect(nextTaskOccurrence(due, 'custom', { frequency: 'monthly', interval: 1, basis: 'completed' }, due, completed)).toBe(at(2026, 10, 23, 14))
  })
  test('end count includes current occurrence; end date is inclusive', () => {
    const due = at(2026, 9, 21)
    expect(nextTaskOccurrence(due, 'custom', { frequency: 'daily', interval: 1, basis: 'scheduled', count: 2 }, due, due, 2)).toBeNull()
    expect(nextTaskOccurrence(due, 'custom', { frequency: 'daily', interval: 1, basis: 'scheduled', until: at(2026, 9, 22) })).toBe(at(2026, 9, 22))
    expect(nextTaskOccurrence(due, 'custom', { frequency: 'daily', interval: 1, basis: 'scheduled', until: at(2026, 9, 22) - 1 })).toBeNull()
  })
  test('lunar new year and leap-month fallback are independent of Gregorian dates', () => {
    expect(nextTaskOccurrence(at(2026, 2, 17), 'lunarYearly')).toBe(at(2027, 2, 6))
    expect(nextTaskOccurrence(at(2023, 3, 22), 'lunarYearly')).toBe(at(2024, 3, 10))
  })
  test('rejects invalid rules and only imports supported Dida syntax', () => {
    expect(() => validateRepeatRule({ frequency: 'daily', interval: 0, basis: 'scheduled' })).toThrow()
    expect(() => validateRepeatRule({ frequency: 'weekly', interval: 1, basis: 'scheduled', weekdays: [] })).toThrow()
    expect(() => validateReminderTimes([Infinity])).toThrow()
    expect(() => validateReminderTimes([1, 2, 3, 4, 5, 6])).toThrow()
    expect(validateReminderTimes([3, 1, 3])).toEqual([1, 3])
    expect(parseImportedRepeatRule('RRULE:FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=11,10')?.monthDays).toEqual([10, 11])
    expect(parseImportedRepeatRule('LUNAR:FREQ=YEARLY;INTERVAL=1;BYMONTH=7;BYMONTHDAY=26')?.lunarDay).toBe(26)
    expect(parseImportedRepeatRule('RRULE:FREQ=MONTHLY;BYSETPOS=-1')).toBeNull()
  })
})
