import { validId, validateDeliveryRef, type ContactScope, type ContactSourceRef } from './contact-content'
import { containsSecret } from './memory'
export type MemoryKind = 'preference' | 'project' | 'experience' | 'research'
export type MemoryInput = { content: string; kind: MemoryKind; scope: ContactScope; source: ContactSourceRef }
export type ContactMemory = MemoryInput & { id: string; owner: string; revision: number; createdAt: number; updatedAt: number; status: 'active' | 'candidate' | 'forgotten' }
export interface ContactMemoryAPI {
  memoryList(owner: string): Promise<ContactMemory[]>
  createMemory(owner: string, input: MemoryInput): Promise<ContactMemory>
  updateMemory(owner: string, id: string, revision: number, input: MemoryInput): Promise<ContactMemory>
  memoryHistory(owner: string, id: string): Promise<ContactMemory[]>
  forgetMemory(owner: string, id: string, revision: number): Promise<void>
}
export const MEMORY_KIND_LABELS: Record<MemoryKind, string> = { preference: '用户偏好', project: '项目背景', experience: '共同经历', research: '研究判断' }
export function validateContactScope(raw: unknown): ContactScope {
  const s = raw as ContactScope
  if (s?.kind === 'contact') return { kind: 'contact' }
  if (s?.kind === 'task' && validId(s.topicId)) return { kind: 'task', topicId: s.topicId }
  if (s?.kind === 'session' && validId(s.sessionId)) return { kind: 'session', sessionId: s.sessionId }
  throw new Error('请选择有效的适用范围。')
}
export function validateContactSource(raw: unknown): ContactSourceRef {
  const s = raw as ContactSourceRef
  if (s?.kind === 'user' && Number.isSafeInteger(s.at) && s.at >= 0) return { kind: 'user', at: s.at }
  if (s?.kind === 'conversation' && validId(s.sessionId) && validId(s.messageId)) return { kind: 'conversation', sessionId: s.sessionId, messageId: s.messageId }
  if (s?.kind === 'research' && validId(s.runId)) return { kind: 'research', runId: s.runId }
  if (s?.kind === 'delivery') return { kind: 'delivery', ref: validateDeliveryRef(s.ref) }
  throw new Error('来源无效。')
}
export function validateMemoryInput(raw: unknown): MemoryInput {
  const m = raw as MemoryInput
  if (!m || typeof m.content !== 'string' || !m.content.trim() || m.content.length > 2000) throw new Error('记忆内容应为 1–2000 字。')
  if (containsSecret(m.content)) throw new Error('请勿将密码、密钥等敏感凭据写入记忆。')
  if (!Object.hasOwn(MEMORY_KIND_LABELS, m.kind)) throw new Error('记忆类型无效。')
  return { content: m.content.trim(), kind: m.kind, scope: validateContactScope(m.scope), source: validateContactSource(m.source) }
}
