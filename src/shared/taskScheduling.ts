import { Lunar, LunarMonth, Solar } from 'lunar-typescript'

export type TaskRecurrence = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'weekdays' | 'lunarYearly' | 'custom'
export interface TaskRepeatRule {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'lunarYearly'
  interval: number
  basis: 'scheduled' | 'completed'
  weekdays?: number[]
  monthDays?: number[]
  lunarMonth?: number
  lunarDay?: number
  until?: number
  count?: number
}
export interface TaskReminder { at: number; firedAt: number | null }
export const TASK_RECURRENCES: TaskRecurrence[] = ['none', 'daily', 'weekly', 'monthly', 'yearly', 'weekdays', 'lunarYearly', 'custom']
const validTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Number.isFinite(new Date(value).getTime())
const integer = (n: unknown, min: number, max: number): n is number => typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max

export function validateRepeatRule(input: unknown): TaskRepeatRule | null {
  if (input == null) return null
  const r = input as TaskRepeatRule
  if (!['daily', 'weekly', 'monthly', 'yearly', 'lunarYearly'].includes(r.frequency) || !integer(r.interval, 1, 365) || !['scheduled', 'completed'].includes(r.basis)) throw new Error('重复规则无效。')
  const result: TaskRepeatRule = { frequency: r.frequency, interval: r.interval, basis: r.basis }
  if (r.until !== undefined) { if (!validTime(r.until)) throw new Error('重复结束日期无效。'); result.until = r.until }
  if (r.count !== undefined) { if (!integer(r.count, 1, 10000)) throw new Error('重复次数须为 1–10000。'); result.count = r.count }
  if (r.until !== undefined && r.count !== undefined) throw new Error('请选择一种重复结束条件。')
  if (r.weekdays !== undefined) {
    if (r.frequency !== 'weekly' || r.basis !== 'scheduled' || !Array.isArray(r.weekdays) || !r.weekdays.length || r.weekdays.length > 7 || r.weekdays.some(n => !integer(n, 0, 6))) throw new Error('请选择有效的重复星期。')
    result.weekdays = [...new Set(r.weekdays)].sort()
  }
  if (r.monthDays !== undefined) {
    if (r.frequency !== 'monthly' || r.basis !== 'scheduled' || !Array.isArray(r.monthDays) || !r.monthDays.length || r.monthDays.length > 32 || r.monthDays.some(n => n !== -1 && !integer(n, 1, 31))) throw new Error('请选择有效的每月日期。')
    result.monthDays = [...new Set(r.monthDays)].sort((a, b) => a - b)
  }
  if (r.frequency === 'lunarYearly' && r.basis !== 'scheduled') throw new Error('农历重复按固定农历日期计算。')
  if (r.lunarMonth !== undefined || r.lunarDay !== undefined) {
    if (r.frequency !== 'lunarYearly' || !integer(r.lunarMonth, -12, 12) || r.lunarMonth === 0 || !integer(r.lunarDay, 1, 30)) throw new Error('农历日期无效。')
    result.lunarMonth = r.lunarMonth; result.lunarDay = r.lunarDay
  }
  return result
}

export function repeatRuleFor(recurrence: TaskRecurrence, input?: TaskRepeatRule | null): TaskRepeatRule | null {
  if (recurrence === 'none') return null
  if (!TASK_RECURRENCES.includes(recurrence)) throw new Error('重复规则无效。')
  if (recurrence === 'custom') { const rule = validateRepeatRule(input); if (!rule) throw new Error('请设置自定义重复规则。'); return rule }
  return { frequency: recurrence === 'weekdays' ? 'weekly' : recurrence, interval: 1, basis: 'scheduled', ...(recurrence === 'weekdays' ? { weekdays: [1, 2, 3, 4, 5] } : {}) }
}

const dayNumber = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000
const withClock = (year: number, month: number, day: number, clock: Date) => new Date(year, month, day, clock.getHours(), clock.getMinutes(), clock.getSeconds(), clock.getMilliseconds()).getTime()

/** Calendar arithmetic keeps wall-clock time across DST and keeps the original month-day anchor. */
export function nextTaskOccurrence(dueAt: number, recurrence: TaskRecurrence, input: TaskRepeatRule | null = null, anchorAt = dueAt, completedAt = dueAt, occurrence = 1): number | null {
  const rule = repeatRuleFor(recurrence, input)
  if (!rule || !validTime(dueAt) || !validTime(anchorAt) || !validTime(completedAt) || (rule.count !== undefined && occurrence >= rule.count)) return null
  const completed = rule.basis === 'completed'
  const base = new Date(completed ? completedAt : anchorAt)
  const floor = completed ? completedAt : Math.max(dueAt, completedAt)
  const floorDate = new Date(floor)
  const accept = (at: number) => validTime(at) && at > floor && (rule.until === undefined || at <= rule.until)
  let next: number | null = null
  if (rule.frequency === 'daily') {
    const step = Math.max(1, Math.floor((dayNumber(floorDate) - dayNumber(base)) / rule.interval))
    for (let i = step; i <= step + 2; i++) { const d = new Date(base); d.setDate(base.getDate() + i * rule.interval); if (accept(d.getTime())) { next = d.getTime(); break } }
  } else if (rule.frequency === 'weekly') {
    const days = rule.weekdays ?? [base.getDay()]
    const monday = dayNumber(base) - (base.getDay() + 6) % 7
    // At most one complete interval plus a week is needed after the floor.
    for (let i = 0; i <= rule.interval * 7 + 7; i++) {
      const d = new Date(floorDate); d.setDate(d.getDate() + i); d.setHours(base.getHours(), base.getMinutes(), base.getSeconds(), base.getMilliseconds())
      const week = Math.floor((dayNumber(d) - monday) / 7)
      if (week >= (completed ? 1 : 0) && week % rule.interval === 0 && days.includes(d.getDay()) && accept(d.getTime())) { next = d.getTime(); break }
    }
  } else if (rule.frequency === 'monthly' || rule.frequency === 'yearly') {
    const unit = rule.frequency === 'yearly' ? rule.interval * 12 : rule.interval
    const months = (floorDate.getFullYear() - base.getFullYear()) * 12 + floorDate.getMonth() - base.getMonth()
    const first = Math.max(completed ? 1 : 0, Math.floor(months / unit))
    for (let i = first; i <= first + 2; i++) {
      const d = new Date(base.getFullYear(), base.getMonth() + i * unit, 1)
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
      const dates = [...new Set((rule.monthDays ?? [base.getDate()]).map(day => day === -1 ? last : Math.min(day, last)))].sort((a, b) => a - b)
      for (const day of dates) { const at = withClock(d.getFullYear(), d.getMonth(), day, base); if (accept(at)) { next = at; break } }
      if (next !== null) break
    }
  } else {
    const lunar = Solar.fromDate(base).getLunar()
    const lunarMonth = rule.lunarMonth ?? lunar.getMonth(), lunarDay = rule.lunarDay ?? lunar.getDay()
    const floorYear = Solar.fromDate(floorDate).getLunar().getYear()
    const first = Math.max(0, Math.floor((floorYear - lunar.getYear()) / rule.interval))
    for (let i = first; i <= first + 2; i++) {
      const year = lunar.getYear() + i * rule.interval
      // A leap-month birthday falls in the regular month in years without that leap month.
      const month = LunarMonth.fromYm(year, lunarMonth) ?? LunarMonth.fromYm(year, Math.abs(lunarMonth))
      if (!month) continue
      const solar = Lunar.fromYmd(year, month.getMonth(), Math.min(lunarDay, month.getDayCount())).getSolar()
      const at = withClock(solar.getYear(), solar.getMonth() - 1, solar.getDay(), base)
      if (accept(at)) { next = at; break }
    }
  }
  return next
}

export function validateReminderTimes(input: unknown): number[] {
  if (!Array.isArray(input) || input.length > 5 || input.some(t => !validTime(t))) throw new Error('最多设置 5 个有效提醒时间。')
  return [...new Set(input.map(t => Math.round(t)))].sort((a, b) => a - b)
}
export function validateReminders(input: unknown): TaskReminder[] {
  if (!Array.isArray(input)) throw new Error('提醒数据无效。')
  validateReminderTimes(input.map(r => r?.at))
  if (input.some(r => r.firedAt !== null && !validTime(r.firedAt))) throw new Error('提醒发送记录无效。')
  if (new Set(input.map(r => r.at)).size !== input.length) throw new Error('提醒时间不能重复。')
  return input.map(r => ({ at: r.at, firedAt: r.firedAt }))
}

export function repeatDescription(recurrence: TaskRecurrence, rule?: TaskRepeatRule | null): string {
  const r = repeatRuleFor(recurrence, rule)
  if (!r) return '不重复'
  const unit = { daily: '天', weekly: '周', monthly: '月', yearly: '年', lunarYearly: '农历年' }[r.frequency]
  const weekdays = r.weekdays?.map(d => ['日', '一', '二', '三', '四', '五', '六'][d]).join('、')
  return `${r.basis === 'completed' ? '完成后' : '每'}${r.interval === 1 && r.basis !== 'completed' ? '' : r.interval}${unit}${weekdays ? `（周${weekdays}）` : ''}${r.monthDays ? `（${r.monthDays.map(d => d === -1 ? '月末' : `${d}日`).join('、')}）` : ''}${r.lunarMonth ? `（${r.lunarMonth < 0 ? '闰' : ''}${Math.abs(r.lunarMonth)}月${r.lunarDay}日）` : ''}${r.count ? ` · 共 ${r.count} 次` : ''}${r.until ? ` · 至 ${new Date(r.until).toLocaleDateString('zh-CN')}` : ''}`
}

export function lunarDateAt(at: number): { month: number; day: number } {
  const lunar = Solar.fromDate(new Date(at)).getLunar()
  return { month: lunar.getMonth(), day: lunar.getDay() }
}

/** Only the explicitly supported subset is converted; unknown rules remain untouched. */
export function parseImportedRepeatRule(flag: string): TaskRepeatRule | null {
  const match = /^(RRULE|LUNAR):(.+)$/.exec(flag)
  if (!match) return null
  const fields = Object.fromEntries(match[2].split(';').map(part => part.split('=')))
  if (Object.keys(fields).some(key => !['FREQ', 'INTERVAL', 'BYMONTH', 'BYMONTHDAY'].includes(key))) return null
  const frequencies: Record<string, TaskRepeatRule['frequency']> = { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly' }
  const frequency = frequencies[fields.FREQ]
  if (!frequency) return null
  try {
    if (match[1] === 'LUNAR') {
      if (frequency !== 'yearly') return null
      return validateRepeatRule({ frequency: 'lunarYearly', interval: Number(fields.INTERVAL ?? 1), basis: 'scheduled', lunarMonth: Number(fields.BYMONTH), lunarDay: Number(fields.BYMONTHDAY) })
    }
    if (fields.BYMONTH || (fields.BYMONTHDAY && frequency !== 'monthly')) return null
    return validateRepeatRule({ frequency, interval: Number(fields.INTERVAL ?? 1), basis: 'scheduled', ...(fields.BYMONTHDAY ? { monthDays: fields.BYMONTHDAY.split(',').map(Number) } : {}) })
  } catch { return null }
}
