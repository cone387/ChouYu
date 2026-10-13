import { validateCalendarSchedule, nextCalendarAt, latestCalendarAt, type CalendarSchedule } from './calendar-schedule'
export interface AssistantRoutineInput extends CalendarSchedule {
  title: string
  instruction: string
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
  /** Frozen scheduled time, including failures before content is generated. */
  attemptAt?: number
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
export function validateRoutine(raw: unknown, titleLimit: 100 | 160 = 100): AssistantRoutineInput {
  if (!raw || typeof raw !== 'object') throw new Error('助手安排无效。')
  const v = raw as AssistantRoutineInput & { time?: string }
  if (typeof v.title !== 'string' || !v.title.trim() || v.title.length > titleLimit || typeof v.instruction !== 'string' || !v.instruction.trim() || v.instruction.length > 2000) throw new Error(`请填写标题和具体安排（最多 ${titleLimit} / 2000 字）。`)
  if (!['reminder', 'contact-summary'].includes(v.kind) || typeof v.enabled !== 'boolean') throw new Error('安排类型无效。')
  return { ...validateCalendarSchedule(v), title: v.title.trim(), instruction: v.instruction.trim(), kind: v.kind, enabled: v.enabled }
}
export const nextRoutineAt = nextCalendarAt
export const latestRoutineAt = latestCalendarAt
