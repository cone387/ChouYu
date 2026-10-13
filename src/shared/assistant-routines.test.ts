import { describe, expect, it, vi } from 'vitest'
import { nextRoutineAt, latestRoutineAt, validateRoutine } from './assistant-routines'

const base = { title: '晨报', instruction: '汇总', times: ['08:30'], cadence: 'daily' as const, kind: 'contact-summary' as const, enabled: true }
const at = (iso: string) => new Date(iso).getTime()

describe('validateRoutine extended schedules', () => {
  it('normalizes a legacy single time into times', () => {
    expect(validateRoutine({ ...base, times: undefined, time: '09:00' })).toMatchObject({ times: ['09:00'] })
  })
  it('dedupes and sorts multiple times, rejecting more than five', () => {
    expect(validateRoutine({ ...base, times: ['20:00', '08:30', '08:30'] })).toMatchObject({ times: ['08:30', '20:00'] })
    expect(() => validateRoutine({ ...base, times: ['01:00', '02:00', '03:00', '04:00', '05:00', '06:00'] })).toThrow('时刻')
  })
  it('requires one time and a future-shaped date for once', () => {
    expect(validateRoutine({ ...base, cadence: 'once', date: '2026-11-01', times: ['08:30'] })).toMatchObject({ cadence: 'once', date: '2026-11-01' })
    expect(() => validateRoutine({ ...base, cadence: 'once', times: ['08:30'] })).toThrow('日期')
    expect(() => validateRoutine({ ...base, cadence: 'once', date: '2026-11-01', times: ['08:30', '20:00'] })).toThrow('一个时刻')
    expect(() => validateRoutine({ ...base, cadence: 'once', date: '2026-13-01', times: ['08:30'] })).toThrow('日期')
    expect(() => validateRoutine({ ...base, cadence: 'once', date: '2026-02-30', times: ['08:30'] })).toThrow('日期')
  })
  it('keeps weekday only for weekly and rejects other cadences', () => {
    expect(validateRoutine({ ...base, cadence: 'weekly', weekday: 3, times: ['08:30'] })).toMatchObject({ weekday: 3 })
    expect(() => validateRoutine({ ...base, cadence: 'yearly' as never })).toThrow('重复规则')
  })
})

describe('monthly and anchored calendar schedules', () => {
  it('uses local calendar days across DST and avoids running the repeated autumn hour twice', () => {
    vi.stubEnv('TZ', 'America/New_York')
    try {
      const interval = validateRoutine({ ...base, cadence: 'interval', intervalDays: 1, anchorDate: '2026-03-07' })
      const first = at('2026-03-07T08:30:00'), second = nextRoutineAt(interval, first)
      expect(second).toBe(at('2026-03-08T08:30:00'))
      expect(second - first).toBe(23 * 3600000)
      const spring = { ...base, times: ['02:30'] }
      expect(nextRoutineAt(spring, at('2026-03-08T00:00:00'))).toBe(at('2026-03-08T03:30:00'))
      const fall = { ...base, times: ['01:30'] }
      expect(nextRoutineAt(fall, at('2026-11-01T01:30:00-04:00'))).toBe(at('2026-11-02T01:30:00-05:00'))
      expect(latestRoutineAt(fall, at('2026-11-01T01:45:00-05:00'))).toBe(at('2026-11-01T01:30:00-04:00'))
    } finally { vi.unstubAllEnvs() }
  })
  it('skips missing month dates and handles explicit month end and leap years', () => {
    const monthly = validateRoutine({ ...base, cadence: 'monthly', monthDay: 31 })
    expect(nextRoutineAt(monthly, at('2026-01-31T08:30:00'))).toBe(at('2026-03-31T08:30:00'))
    const last = validateRoutine({ ...base, cadence: 'monthly', monthDay: 'last' })
    expect(nextRoutineAt(last, at('2028-01-31T09:00:00'))).toBe(at('2028-02-29T08:30:00'))
    expect(nextRoutineAt(last, at('2029-01-31T09:00:00'))).toBe(at('2029-02-28T08:30:00'))
    expect(() => validateRoutine({ ...base, cadence: 'monthly', monthDay: 32 })).toThrow('每月')
  })
  it('persists an interval anchor across years and retains all daily slots', () => {
    const rule = validateRoutine({ ...base, cadence: 'interval', intervalDays: 3, anchorDate: '2026-12-30', times: ['20:00', '08:30'] })
    expect(rule).toMatchObject({ intervalDays: 3, anchorDate: '2026-12-30' })
    expect(nextRoutineAt(rule, at('2026-12-30T09:00:00'))).toBe(at('2026-12-30T20:00:00'))
    expect(nextRoutineAt(rule, at('2026-12-31T21:00:00'))).toBe(at('2027-01-02T08:30:00'))
    expect(nextRoutineAt(rule, at('2026-01-01T00:00:00'))).toBe(at('2026-12-30T08:30:00'))
    expect(() => validateRoutine({ ...base, cadence: 'interval', intervalDays: 3 })).toThrow('起始日期')
    expect(() => validateRoutine({ ...base, cadence: 'interval', intervalDays: 0, anchorDate: '2026-10-13' })).toThrow('间隔')
  })
  it('selects only the most recent missed occurrence without shifting the anchor', () => {
    const rule = validateRoutine({ ...base, cadence: 'interval', intervalDays: 3, anchorDate: '2026-12-30', times: ['08:30', '20:00'] })
    expect(latestRoutineAt(rule, at('2027-01-12T10:00:00'))).toBe(at('2027-01-11T20:00:00'))
    expect(latestRoutineAt(rule, at('2026-12-29T20:00:00'))).toBeUndefined()
    expect(nextRoutineAt(rule, at('2027-01-12T10:00:00'))).toBe(at('2027-01-14T08:30:00'))
  })
})

describe('nextRoutineAt extended schedules', () => {
  it('returns the earliest future time among multiple daily times', () => {
    const input = { ...base, times: ['08:30', '20:00'] }
    expect(nextRoutineAt(input, at('2026-10-12T10:00:00'))).toBe(at('2026-10-12T20:00:00'))
    expect(nextRoutineAt(input, at('2026-10-12T21:00:00'))).toBe(at('2026-10-13T08:30:00'))
  })
  it('returns the single datetime for once and throws once it is past', () => {
    const once = { ...base, cadence: 'once' as const, date: '2026-11-01', times: ['08:30'] }
    expect(nextRoutineAt(once, at('2026-10-12T10:00:00'))).toBe(at('2026-11-01T08:30:00'))
    expect(() => nextRoutineAt(once, at('2026-11-02T10:00:00'))).toThrow('已过')
  })
})
