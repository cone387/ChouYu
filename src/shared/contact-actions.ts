import type { ContactInteractionDetails } from './contact-interactions'
import { containsSecret } from './memory'

export const CONTACT_ACTION_TOOLS = ['edit_contact_work_settings', 'edit_contact_profile', 'configure_contact_skill', 'update_contact_topic', 'answer_contact_question', 'edit_contact_task', 'set_contact_schedule', 'assign_contact_task', 'revise_contact_presentation', 'save_assistant_routine'] as const
export type ContactActionTool = typeof CONTACT_ACTION_TOOLS[number]
export interface ContactActionOption {
  id: string
  label: string
  tool: ContactActionTool
  arguments: Record<string, string | number | boolean | string[]>
}
export interface ContactActionRequest {
  purpose: 'permission' | 'configuration' | 'choice' | 'material' | 'feedback' | 'confirmation'
  title: string
  body: string
  sessionId: string
  subject: { kind: 'contact' } | { kind: 'task'; topicId: string; revision: number } | { kind: 'delivery'; topicId: string; revision: number; version: number }
  actions: ContactActionOption[]
  input?: { label: string; argument: 'answer' | 'reason'; maxLength: number; required?: boolean }
}
export interface ContactActionResponse { actionId: string; text?: string }
export interface ContactActionOutcome { content: string; summary: string }
export interface ContactActionInteraction extends ContactInteractionDetails {
  kind: 'action'
  id: string
  version: string
  characterId: string
  characterName?: string
  topicId?: never
  runId?: never
  topicTitle: string
  status: 'pending' | 'executing' | 'failed' | 'resolved' | 'obsolete'
  createdAt: number
  request: ContactActionRequest
  response?: ContactActionResponse
  outcome?: ContactActionOutcome
  result?: string
  retryable?: boolean
  budgets: []
}
const bounded = (value: unknown, limit: number): value is string => typeof value === 'string' && !!value.trim() && value.length <= limit
const identifier = (value: unknown): value is string => bounded(value, 128) && !value.includes('\0')
export function validateContactActionRequest(raw: unknown): ContactActionRequest {
  const v = raw as ContactActionRequest
  if (!v || typeof v !== 'object' || !['permission', 'configuration', 'choice', 'material', 'feedback', 'confirmation'].includes(v.purpose) || !bounded(v.title, 160) || !bounded(v.body, 12000) || !identifier(v.sessionId)) throw new Error('交互事项内容无效。')
  const s = v.subject
  if (!s || !['contact', 'task', 'delivery'].includes(s.kind)) throw new Error('交互事项对象无效。')
  if (s.kind !== 'contact' && (!identifier(s.topicId) || !Number.isSafeInteger(s.revision) || s.revision < 1)) throw new Error('交互事项任务版本无效。')
  if (s.kind === 'delivery' && (!Number.isSafeInteger(s.version) || s.version < 1)) throw new Error('交互事项成果版本无效。')
  if (!Array.isArray(v.actions) || !v.actions.length || v.actions.length > 8) throw new Error('交互事项须提供1–8个实际操作。')
  const actions = v.actions.map(a => {
    if (!a || !identifier(a.id) || !bounded(a.label, 80) || !CONTACT_ACTION_TOOLS.includes(a.tool) || !a.arguments || typeof a.arguments !== 'object' || Array.isArray(a.arguments)) throw new Error('交互事项操作无效。')
    const entries = Object.entries(a.arguments)
    if (entries.length > 32 || entries.some(([key, value]) => !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key) || ['constructor', 'prototype'].includes(key) || !(typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) || Array.isArray(value) && value.length <= 32 && value.every(item => typeof item === 'string')))) throw new Error('交互操作参数无效。')
    return { id: a.id, label: a.label, tool: a.tool, arguments: Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value])) }
  })
  if (new Set(actions.map(a => a.id)).size !== actions.length) throw new Error('交互事项操作重复。')
  const input = v.input
  if (input && (!bounded(input.label, 80) || !['answer', 'reason'].includes(input.argument) || !Number.isSafeInteger(input.maxLength) || input.maxLength < 1 || input.maxLength > 2000 || input.required !== undefined && typeof input.required !== 'boolean')) throw new Error('交互事项输入无效。')
  if (input?.argument === 'answer' && actions.some(a => a.tool !== 'answer_contact_question')) throw new Error('只有原问题回复可以填写答案。')
  const result: ContactActionRequest = { purpose: v.purpose, title: v.title, body: v.body, sessionId: v.sessionId,
    subject: s.kind === 'contact' ? { kind: s.kind } : { kind: s.kind, topicId: s.topicId, revision: s.revision, ...(s.kind === 'delivery' ? { version: s.version } : {}) } as ContactActionRequest['subject'],
    actions, ...(input ? { input: { ...input } } : {}) }
  const serialized = JSON.stringify(result)
  if (serialized.length > 100000 || containsSecret(serialized)) throw new Error('交互事项过长或含有凭据，请使用安全输入。')
  return result
}
export function validateContactActionResponse(request: ContactActionRequest, raw: unknown): ContactActionResponse {
  const v = raw as ContactActionResponse
  if (!v || !request.actions.some(a => a.id === v.actionId)) throw new Error('请选择此事项中的实际操作。')
  if (v.text !== undefined && (typeof v.text !== 'string' || !request.input || v.text.length > request.input.maxLength || containsSecret(v.text))) throw new Error('回复无效、过长或包含凭据。')
  if (request.input?.required && !v.text?.trim()) throw new Error('请填写回复。')
  return { actionId: v.actionId, ...(v.text === undefined ? {} : { text: v.text }) }
}
