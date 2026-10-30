import { expect, it } from 'vitest'
import { dashboardDays } from '../../../../shared/dashboard'
import { readJournalDays, summarizeJournal, summarizeSessions, usagePoints } from './appDashboardModel'
import type { JournalDay } from '../../../../shared/journal'

const day: JournalDay = { activityCount: 1, durationMs: 60000, captureCount: 0, ocrReady: 0, ocrFailed: 0, firstAt: null, lastAt: null, apps: [{ app: 'Editor', durationMs: 60000, count: 1 }] }
it('distinguishes untracked history, unreported calls and partially reported token totals', () => {
  const points = usagePoints({ trackingSince: new Date(2026, 9, 29, 10).getTime(), days: [
    { date: '2026-10-28', tokens: 0, calls: 0, reported: 0 },
    { date: '2026-10-29', tokens: null, calls: 2, reported: 0 },
    { date: '2026-10-30', tokens: 100, calls: 2, reported: 1 },
    { date: '2026-10-31', tokens: 0, calls: 0, reported: 0 }
  ] })
  expect(points.map(point => point.value)).toEqual([null, null, 100, 0])
  expect(points.map(point => point.note)).toEqual(['尚未开始统计', '2 次调用未上报', '1 次调用未上报', undefined])
})
it('stops launching queued journal reads when a hidden or superseded range is cancelled', async () => {
  const controller = new AbortController()
  const pending: (() => void)[] = []
  let calls = 0
  const result = readJournalDays(dashboardDays(30), async () => { calls++; await new Promise<void>(resolve => pending.push(resolve)); return day }, controller.signal)
  expect(calls).toBe(4)
  controller.abort(); pending.forEach(resolve => resolve())
  await result
  expect(calls).toBe(4)
})
it('preserves gaps rather than turning a failed journal day into zero time', () => {
  const result = summarizeJournal([{ date: '2026-10-29', data: day }, { date: '2026-10-30' }])
  expect(result.durationMs).toBeUndefined()
  expect(result.points.map(point => point.value)).toEqual([1, null])
  expect(result.failedDays).toBe(1)
  expect(result.apps).toEqual([{ id: 'Editor', label: 'Editor', value: 1 }])
})
it('aggregates app duration independently from activity count', () => {
  const result = summarizeJournal([{ date: '2026-10-29', data: day }, { date: '2026-10-30', data: day }])
  expect(result.durationMs).toBe(120000)
  expect(result.apps[0].value).toBe(2)
})
it('groups retained conversation messages and unread counts without treating last update as a daily history', () => {
  const session = { id: 's', title: '', preview: '', characterId: 'alice', messageCount: 8, unreadCount: 2, createdAt: 1, updatedAt: 2 }
  expect(summarizeSessions([session, { ...session, id: 's2', messageCount: 3, unreadCount: 0 }])).toEqual({ count: 2, messages: 11, unread: 2, byCharacter: [{ id: 'alice', value: 11 }] })
})
it('builds an inclusive sequence of local calendar days across month boundaries', () => {
  const days = dashboardDays(7, new Date(2026, 10, 2, 8).getTime())
  expect(days.map(day => day.date)).toEqual(['2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'])
  expect(days.every((day, index) => !index || day.from === days[index - 1].to)).toBe(true)
})
