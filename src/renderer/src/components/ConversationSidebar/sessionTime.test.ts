import { expect, it } from 'vitest'
import { formatSessionTime, sessionTimeTitle } from './sessionTime'

it('distinguishes today, yesterday, older dates and previous years by local calendar day', () => {
  const now = new Date(2026, 10, 24, 10).getTime()
  expect(formatSessionTime(new Date(2026, 10, 24, 9, 5).getTime(), now)).toBe('09:05')
  expect(formatSessionTime(new Date(2026, 10, 23, 23, 59).getTime(), now)).toBe('昨天')
  expect(formatSessionTime(new Date(2026, 9, 3, 9).getTime(), now)).toBe('10/03')
  expect(formatSessionTime(new Date(2025, 9, 3, 9).getTime(), now)).toBe('2025/10/03')
})
it('handles midnight and year boundaries without treating the last 24 hours as today', () => {
  const time = new Date(2026, 11, 31, 23, 59).getTime()
  expect(formatSessionTime(time, new Date(2027, 0, 1, 0, 1).getTime())).toBe('昨天')
  expect(formatSessionTime(time, new Date(2027, 0, 2).getTime())).toBe('2026/12/31')
  expect(sessionTimeTitle(time)).toBe('2026/12/31 23:59')
})
