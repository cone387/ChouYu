const pad = (value: number) => String(value).padStart(2, '0')
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
export function formatSessionTime(timestamp: number, now = Date.now()): string {
  const date = new Date(timestamp), today = new Date(now)
  if (sameDay(date, today)) return `${pad(date.getHours())}:${pad(date.getMinutes())}`
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  if (sameDay(date, yesterday)) return '昨天'
  const day = `${pad(date.getMonth() + 1)}/${pad(date.getDate())}`
  return date.getFullYear() === today.getFullYear() ? day : `${date.getFullYear()}/${day}`
}
export function sessionTimeTitle(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
