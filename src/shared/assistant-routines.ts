export interface AssistantRoutineInput {
  title: string
  instruction: string
  time: string
  cadence: 'daily' | 'weekdays' | 'weekly'
  weekday?: number
  kind: 'reminder' | 'contact-summary'
  enabled: boolean
}
export interface AssistantRoutine extends AssistantRoutineInput {
  id: string
  revision: number
  nextAt: number
  lastAt?: number
  lastError?: string
  lastResult?: string
  retryAt?: number
  failures?: number
  pending?: { dueAt: number; content: string }
}
export interface AssistantRoutinesAPI {
  request(description: string, id?: string, revision?: number): Promise<AssistantTaskRequestResult>
  onChanged(callback: () => void): () => void
  list(): Promise<AssistantRoutine[]>
  save(input: AssistantRoutineInput, id?: string, revision?: number): Promise<AssistantRoutine[]>
  remove(id: string, revision: number): Promise<AssistantRoutine[]>
}
export type AssistantTaskRequestResult = { kind: 'routine'; routine: AssistantRoutine } | { kind: 'question'; question: string } | { kind: 'work'; description: string }
export function validateRoutine(raw: unknown): AssistantRoutineInput {
  if (!raw || typeof raw !== 'object') throw new Error('助手安排无效。')
  const v = raw as AssistantRoutineInput
  if (typeof v.title !== 'string' || !v.title.trim() || v.title.length > 100 || typeof v.instruction !== 'string' || !v.instruction.trim() || v.instruction.length > 2000) throw new Error('请填写标题和具体安排（最多 100 / 2000 字）。')
  if (typeof v.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v.time)) throw new Error('请使用 HH:mm 格式填写时间。')
  if (!['daily', 'weekdays', 'weekly'].includes(v.cadence) || !['reminder', 'contact-summary'].includes(v.kind) || typeof v.enabled !== 'boolean') throw new Error('安排类型或重复规则无效。')
  if (v.cadence === 'weekly' && (!Number.isInteger(v.weekday) || v.weekday! < 0 || v.weekday! > 6)) throw new Error('请选择星期。')
  return { title: v.title.trim(), instruction: v.instruction.trim(), time: v.time, cadence: v.cadence, weekday: v.cadence === 'weekly' ? v.weekday : undefined, kind: v.kind, enabled: v.enabled }
}
/** Device-local wall clock, recalculated by calendar day (including DST). */
export function nextRoutineAt(input: AssistantRoutineInput, after: number): number {
  const [hour, minute] = input.time.split(':').map(Number)
  for (let offset = 0; offset < 8; offset++) {
    const date = new Date(after)
    date.setDate(date.getDate() + offset)
    date.setHours(hour, minute, 0, 0)
    const day = date.getDay()
    if (date.getTime() > after && (input.cadence === 'daily' || input.cadence === 'weekdays' && day > 0 && day < 6 || input.cadence === 'weekly' && day === input.weekday)) return date.getTime()
  }
  throw new Error('无法计算下次执行时间。')
}
