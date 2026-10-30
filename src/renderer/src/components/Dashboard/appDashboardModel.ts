import type { JournalDay } from '../../../../shared/journal'
import { localDayKey, type dashboardDays } from '../../../../shared/dashboard'
import type { AppUsageStatistics } from '../../../../shared/usage'
import type { ChatSessionSummary } from '../../shared/types'

export type ChartValue = { id: string; label: string; value: number | null; note?: string }
export type JournalDayResult = { date: string; data?: JournalDay }
export function usagePoints(data: Pick<AppUsageStatistics, 'days' | 'trackingSince'>): ChartValue[] {
  const start = localDayKey(new Date(data.trackingSince))
  return data.days.map(day => ({ id: day.date, label: day.date.slice(5).replace('-', '/'),
    value: day.date < start && day.calls === 0 ? null : day.tokens,
    note: day.date < start && day.calls === 0 ? '尚未开始统计' : day.calls > day.reported ? `${day.calls - day.reported} 次调用未上报` : undefined }))
}
export function compactTokens(value: number) {
  return value >= 1000000 ? `${(value / 1000000).toLocaleString('zh-CN', { maximumFractionDigits: 1 })}M`
    : value >= 1000 ? `${(value / 1000).toLocaleString('zh-CN', { maximumFractionDigits: 1 })}K` : value.toLocaleString('zh-CN')
}
export async function readJournalDays(days: ReturnType<typeof dashboardDays>, read: (day: { from: number; to: number }) => Promise<JournalDay>, signal: AbortSignal) {
  const results: JournalDayResult[] = days.map(day => ({ date: day.date }))
  let next = 0
  await Promise.all(Array.from({ length: Math.min(4, days.length) }, async () => {
    while (!signal.aborted && next < days.length) {
      const index = next++
      try { results[index].data = await read(days[index]) } catch { /* A failed day remains a gap. */ }
    }
  }))
  return summarizeJournal(results)
}
export function summarizeJournal(days: JournalDayResult[]) {
  const apps = new Map<string, number>()
  for (const day of days) for (const app of day.data?.apps ?? []) apps.set(app.app, (apps.get(app.app) ?? 0) + app.durationMs / 60000)
  const failedDays = days.filter(day => !day.data).length
  return {
    failedDays,
    durationMs: failedDays ? undefined : days.reduce((total, day) => total + day.data!.durationMs, 0),
    points: days.map(day => ({ id: day.date, label: day.date.slice(5).replace('-', '/'), value: day.data ? day.data.durationMs / 60000 : null })),
    apps: [...apps].map(([id, value]) => ({ id, label: id, value })).sort((a, b) => b.value - a.value)
  }
}
export function summarizeSessions(sessions: ChatSessionSummary[]) {
  const byCharacter = new Map<string, number>()
  for (const session of sessions) byCharacter.set(session.characterId, (byCharacter.get(session.characterId) ?? 0) + session.messageCount)
  return { count: sessions.length, messages: sessions.reduce((total, session) => total + session.messageCount, 0),
    unread: sessions.reduce((total, session) => total + (session.unreadCount ?? 0), 0),
    byCharacter: [...byCharacter].map(([id, value]) => ({ id, value })).sort((a, b) => b.value - a.value) }
}
export function formatDuration(minutes: number) {
  return minutes >= 60 ? `${(minutes / 60).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} 小时` : `${minutes.toLocaleString('zh-CN', { maximumFractionDigits: 1 })} 分钟`
}
