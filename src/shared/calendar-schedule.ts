/** Device-local calendar rules shared by assistant routines and contact work. */
export interface CalendarSchedule {
  times: string[]
  cadence: 'daily' | 'weekdays' | 'weekly' | 'once' | 'monthly' | 'interval'
  date?: string
  weekday?: number
  monthDay?: number | 'last'
  intervalDays?: number
  anchorDate?: string
}
export interface CalendarOccurrence { revision: number; dueAt: number; rule: CalendarSchedule }

export const calendarTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone
/** Preserve the scheduled wall date/time when a floating appointment moves zones. */
export function rebaseCalendarAt(instant: number, previousZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: previousZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant)
  const value = (name: string) => Number(parts.find(part => part.type === name)!.value)
  return new Date(value('year'), value('month') - 1, value('day'), value('hour'), value('minute')).getTime()
}

function parseDate(value: unknown, label: string): Date {
  const parts = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split('-').map(Number) : []
  const [year, month, day] = parts
  const date = new Date(year, month - 1, day)
  if (parts.length !== 3 || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) throw new Error(`${label}请填写合法日期（YYYY-MM-DD）。`)
  return date
}
export function validateCalendarSchedule(raw: unknown): CalendarSchedule {
  if (!raw || typeof raw !== 'object') throw new Error('重复规则无效。')
  const value = raw as CalendarSchedule & { time?: string }
  const rawTimes = Array.isArray(value.times) ? value.times : typeof value.time === 'string' ? [value.time] : undefined
  if (!rawTimes || !rawTimes.every(t => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t))) throw new Error('请使用 HH:mm 格式填写时间。')
  const times = [...new Set(rawTimes)].sort()
  if (!times.length || times.length > 5) throw new Error('最多安排 5 个时刻。')
  const rule: CalendarSchedule = { cadence: value.cadence, times }
  switch (value.cadence) {
    case 'daily': case 'weekdays': break
    case 'weekly':
      if (!Number.isInteger(value.weekday) || value.weekday! < 0 || value.weekday! > 6) throw new Error('请选择星期。')
      rule.weekday = value.weekday; break
    case 'once':
      parseDate(value.date, '一次性安排')
      if (times.length !== 1) throw new Error('一次性安排只能有一个时刻。')
      rule.date = value.date; break
    case 'monthly':
      if (value.monthDay !== 'last' && (!Number.isInteger(value.monthDay) || value.monthDay! < 1 || value.monthDay! > 31)) throw new Error('每月请指定 1–31 日或最后一天。')
      rule.monthDay = value.monthDay; break
    case 'interval':
      if (!Number.isInteger(value.intervalDays) || value.intervalDays! < 1 || value.intervalDays! > 36500) throw new Error('间隔应为 1–36500 个日历日。')
      parseDate(value.anchorDate, '起始日期')
      rule.anchorDate = value.anchorDate; rule.intervalDays = value.intervalDays; break
    default: throw new Error('重复规则无效。')
  }
  return rule
}
const ordinal = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000
function eligibleDay(rule: CalendarSchedule, day: Date): boolean {
  if (rule.cadence === 'weekdays') return day.getDay() > 0 && day.getDay() < 6
  if (rule.cadence === 'weekly') return day.getDay() === rule.weekday
  return true
}
/** Bounded candidate generation: long offline gaps never enumerate all missed periods. */
function candidates(rule: CalendarSchedule, instant: number, direction: 1 | -1): number[] {
  const reference = new Date(instant), days: Date[] = []
  if (rule.cadence === 'once') days.push(parseDate(rule.date, '一次性安排'))
  else if (rule.cadence === 'monthly') {
    for (let i = 0; i < 3; i++) {
      const first = new Date(reference.getFullYear(), reference.getMonth() + i * direction, 1)
      const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
      if (rule.monthDay !== 'last' && rule.monthDay! > last) continue
      days.push(new Date(first.getFullYear(), first.getMonth(), rule.monthDay === 'last' ? last : rule.monthDay))
    }
  } else if (rule.cadence === 'interval') {
    const anchor = parseDate(rule.anchorDate, '起始日期'), step = rule.intervalDays!
    const index = Math.floor((ordinal(reference) - ordinal(anchor)) / step)
    const first = direction === 1 ? Math.max(0, index) : index
    for (let i = 0; i < 3; i++) {
      const n = first + i * direction
      if (n < 0) continue
      const date = new Date(anchor); date.setDate(date.getDate() + n * step); days.push(date)
    }
  } else {
    for (let i = 0; i < 8; i++) {
      const day = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate() + i * direction)
      if (eligibleDay(rule, day)) days.push(day)
    }
  }
  // Date uses the first repeated hour in autumn and shifts a nonexistent spring hour forward.
  return [...new Set(days.flatMap(day => rule.times.map(time => {
    const [hour, minute] = time.split(':').map(Number), date = new Date(day)
    date.setHours(hour, minute, 0, 0); return date.getTime()
  })))].filter(Number.isFinite).sort((a, b) => direction * (a - b))
}
export function nextCalendarAt(rule: CalendarSchedule, after: number): number {
  const result = candidates(rule, after, 1).find(time => time > after)
  if (result === undefined) throw new Error(rule.cadence === 'once' ? '一次性安排的时间已过，请选择未来的时间。' : '无法计算下次执行时间。')
  return result
}
export function latestCalendarAt(rule: CalendarSchedule, now: number): number | undefined {
  return candidates(rule, now, -1).find(time => time <= now)
}
export function calendarScheduleLabel(rule: CalendarSchedule): string {
  const cadence = rule.cadence === 'once' ? `${rule.date}（一次性）` : rule.cadence === 'daily' ? '每天' : rule.cadence === 'weekdays' ? '工作日'
    : rule.cadence === 'weekly' ? `每周${'日一二三四五六'[rule.weekday ?? 0]}` : rule.cadence === 'monthly' ? `每月${rule.monthDay === 'last' ? '最后一天' : `${rule.monthDay}日`}`
      : `从 ${rule.anchorDate} 起每隔 ${rule.intervalDays} 天`
  return `${cadence} ${rule.times.join('、')}`
}
