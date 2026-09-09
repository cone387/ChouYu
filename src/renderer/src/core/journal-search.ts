export const journalDateKey = (at: number) => {
  const date = new Date(at)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function journalSearchRange(start: string, end: string): { from: number; to: number } {
  const from = new Date(`${start}T00:00:00`).getTime(), last = new Date(`${end}T00:00:00`).getTime()
  if (![start, end].every(value => /^\d{4}-\d{2}-\d{2}$/.test(value)) || !Number.isFinite(from) || !Number.isFinite(last) || journalDateKey(from) !== start || journalDateKey(last) !== end) throw new Error('请选择有效的日志起止日期。')
  if (last < from || (Date.parse(end) - Date.parse(start)) / 86400_000 >= 31) throw new Error('日志日期范围最多 31 天，结束日期不能早于开始日期。')
  const next = new Date(last); next.setDate(next.getDate() + 1)
  return { from, to: next.getTime() }
}

export function journalSearchExcerpt(text: string, query: string): string {
  const value = text.replace(/\s+/g, ' ').trim()
  const position = value.toLocaleLowerCase().indexOf(query.trim().toLocaleLowerCase())
  const start = Math.max(0, position - 35), end = Math.min(value.length, start + 150)
  return `${start ? '…' : ''}${value.slice(start, end)}${end < value.length ? '…' : ''}`
}
