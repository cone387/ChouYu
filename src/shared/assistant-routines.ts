export interface AssistantRoutineInput {
  title: string
  instruction: string
  times: string[]
  cadence: 'daily' | 'weekdays' | 'weekly' | 'once'
  date?: string
  weekday?: number
  kind: 'reminder' | 'contact-summary'
  enabled: boolean
}
export interface AssistantRoutine extends AssistantRoutineInput {
  id: string
  revision: number
  createdAt?: number
  updatedAt?: number
  nextAt: number
  lastAt?: number
  lastError?: string
  lastResult?: string
  retryAt?: number
  failures?: number
  pending?: { dueAt: number; content: string }
  finishedAt?: number
  requestLog?: string
}
export interface AssistantRoutinesAPI {
  history(id: string, before?: number): Promise<AssistantRoutineHistoryPage>
  onChanged(callback: () => void): () => void
  list(): Promise<AssistantRoutine[]>
  save(input: AssistantRoutineInput, id?: string, revision?: number): Promise<AssistantRoutine[]>
  remove(id: string, revision: number): Promise<AssistantRoutine[]>
}
export interface AssistantRoutineExecution {
  id: string
  receipt: string
  title: string
  scheduledAt: number
  startedAt: number
  finishedAt?: number
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  content?: string
  error?: string
  sessionId?: string
  messageId?: string
}
export interface AssistantRoutineHistoryPage { items: AssistantRoutineExecution[]; nextCursor?: number }
export function validateRoutine(raw: unknown): AssistantRoutineInput {
  if (!raw || typeof raw !== 'object') throw new Error('助手安排无效。')
  const v = raw as AssistantRoutineInput & { time?: string }
  if (typeof v.title !== 'string' || !v.title.trim() || v.title.length > 100 || typeof v.instruction !== 'string' || !v.instruction.trim() || v.instruction.length > 2000) throw new Error('请填写标题和具体安排（最多 100 / 2000 字）。')
  const rawTimes = Array.isArray(v.times) ? v.times : typeof v.time === 'string' ? [v.time] : undefined
  if (!rawTimes || !rawTimes.every(t => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t))) throw new Error('请使用 HH:mm 格式填写时间。')
  const times = [...new Set(rawTimes)].sort()
  if (!times.length || times.length > 5) throw new Error('最多安排 5 个时刻。')
  if (!['daily', 'weekdays', 'weekly', 'once'].includes(v.cadence) || !['reminder', 'contact-summary'].includes(v.kind) || typeof v.enabled !== 'boolean') throw new Error('安排类型或重复规则无效。')
  let date: string | undefined
  if (v.cadence === 'once') {
    if (typeof v.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.date) || Number.isNaN(new Date(`${v.date}T00:00:00`).getTime())) throw new Error('一次性安排请填写合法日期（YYYY-MM-DD）。')
    if (times.length !== 1) throw new Error('一次性安排只能有一个时刻。')
    date = v.date
  }
  if (v.cadence === 'weekly' && (!Number.isInteger(v.weekday) || v.weekday! < 0 || v.weekday! > 6)) throw new Error('请选择星期。')
  return { title: v.title.trim(), instruction: v.instruction.trim(), times, cadence: v.cadence, ...(date ? { date } : {}), weekday: v.cadence === 'weekly' ? v.weekday : undefined, kind: v.kind, enabled: v.enabled }
}
/** Device-local wall clock, recalculated by calendar day (including DST). */
export function nextRoutineAt(input: AssistantRoutineInput, after: number): number {
  if (input.cadence === 'once') {
    const [hour, minute] = input.times[0].split(':').map(Number)
    const date = new Date(`${input.date}T00:00:00`)
    date.setHours(hour, minute, 0, 0)
    if (date.getTime() <= after) throw new Error('一次性安排的时间已过，请选择未来的时间。')
    return date.getTime()
  }
  for (let offset = 0; offset < 8; offset++) {
    const day = new Date(after)
    day.setDate(day.getDate() + offset)
    for (const time of input.times) {
      const [hour, minute] = time.split(':').map(Number)
      const date = new Date(day)
      date.setHours(hour, minute, 0, 0)
      const weekday = date.getDay()
      if (date.getTime() > after && (input.cadence === 'daily' || input.cadence === 'weekdays' && weekday > 0 && weekday < 6 || input.cadence === 'weekly' && weekday === input.weekday)) return date.getTime()
    }
  }
  throw new Error('无法计算下次执行时间。')
}
