import { describe, expect, it } from 'vitest'
import { nextRoutineAt, validateRoutine } from './assistant-routines'

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
    expect(() => validateRoutine({ ...base, cadence: 'monthly' as never })).toThrow('重复规则')
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
