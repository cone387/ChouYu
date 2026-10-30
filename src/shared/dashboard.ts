export type DashboardRange = 7 | 30
export function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function dashboardDays(range: DashboardRange, now = Date.now()) {
  if (range !== 7 && range !== 30) throw new Error('看板统计范围须为近 7 天或近 30 天。')
  return Array.from({ length: range }, (_, index) => {
    const start = new Date(now); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - range + index + 1)
    const end = new Date(start); end.setDate(end.getDate() + 1)
    return { date: localDayKey(start), from: start.getTime(), to: end.getTime() }
  })
}
export interface TaskStatistics {
  open: number; done: number; completed: number
  days: { date: string; completed: number }[]
}
