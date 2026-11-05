import { containsSecret } from './memory'

export const TRACKED_TASK_TOOLS = new Set(['edit_contact_task', 'assign_contact_task', 'set_contact_schedule', 'update_contact_topic', 'answer_contact_question', 'revise_contact_presentation', 'submit_contact_delivery_feedback'])

/** Supplied by the host, never by a model tool's arguments. */
export interface TaskRequestSource {
  requestId: string
  sessionId: string
  messageId?: string
  text: string
  acceptedAt: number
}
export interface TaskRequestSubmission { source: TaskRequestSource; tool: string; arguments: Record<string, unknown> }
export type TaskRequestEffect = 'requirements' | 'assignment' | 'revision' | 'answer' | 'control'
export interface TaskRequestReceipt { requestId: string; topicId: string | null; revision: number; effect: TaskRequestEffect; savedAt: number }
export interface TaskRequestAttempt {
  runId: string; linkedAt: number; suppliedAt?: number; resultVersion?: number; status: string
}
export interface TaskRequestRecord extends TaskRequestReceipt {
  id: number; source: TaskRequestSource; tool: string; status: string; attempts: TaskRequestAttempt[]
}
export interface TaskRequestPage { items: TaskRequestRecord[]; nextCursor?: number }

export function validateTaskRequestSource(value: unknown): TaskRequestSource {
  const v = value as TaskRequestSource
  const id = (s: unknown): s is string => typeof s === 'string' && !!s.trim() && s.length <= 240 && !/[\0\r\n]/.test(s)
  if (!v || !id(v.requestId) || !id(v.sessionId) || v.messageId !== undefined && !id(v.messageId)
    || typeof v.text !== 'string' || !v.text.trim() || v.text.length > 16000 || containsSecret(v.text)
    || !Number.isSafeInteger(v.acceptedAt) || v.acceptedAt < 0) throw new Error('任务请求来源无效、过长或包含凭据。')
  return { requestId: v.requestId, sessionId: v.sessionId, text: v.text, acceptedAt: v.acceptedAt, ...(v.messageId ? { messageId: v.messageId } : {}) }
}

/** Canonical object ordering makes transport/object construction order irrelevant. */
export function taskRequestPayload(input: TaskRequestSubmission): string {
  const source = validateTaskRequestSource(input?.source)
  if (typeof input.tool !== 'string' || !/^[a-z][a-z_]{0,100}$/.test(input.tool) || !input.arguments || typeof input.arguments !== 'object' || Array.isArray(input.arguments)) throw new Error('任务请求操作无效。')
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => [key, canonical(v)])) : value
  const text = JSON.stringify(canonical({ sessionId: source.sessionId, text: source.text, tool: input.tool, arguments: input.arguments }))
  if (text.length > 60000 || containsSecret(text)) throw new Error('任务请求过长或包含凭据。')
  return text
}
