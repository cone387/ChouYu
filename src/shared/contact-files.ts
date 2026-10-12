import type { DeliveryRef } from './contact-content'
import { validId } from './contact-content'
import { skillReference } from './skills'
export type WorkFileContext = { characterId: string; skillId: string; runId?: string; topicId?: string; sessionId?: string; requestId: string }
export type ContactFile = { id: string; context: WorkFileContext; name: string; hash: string; bytes: number; mediaType: string; createdAt: number; deliveryRef?: DeliveryRef }
export type ValidatedWorkFile = { name: string; bytes: Uint8Array }
export interface ContactFileAPI {
  fileList(owner: string, topicId?: string): Promise<ContactFile[]>
  readContactFile(owner: string, id: string): Promise<{ file: ContactFile; bytes: Uint8Array }>
  exportContactFile(owner: string, id: string): Promise<boolean>
}
export function validateFileContext(raw: WorkFileContext): WorkFileContext {
  if (!raw || !validId(raw.characterId) || !validId(raw.requestId) || [raw.runId, raw.topicId, raw.sessionId].some(id => id !== undefined && !validId(id)) || Boolean(raw.runId) !== Boolean(raw.topicId) || Boolean(raw.runId) === Boolean(raw.sessionId)) throw new Error('文件来源无效。')
  return { characterId: raw.characterId, skillId: skillReference(raw.skillId), requestId: raw.requestId, ...(raw.runId ? { runId: raw.runId, topicId: raw.topicId } : { sessionId: raw.sessionId }) }
}
export function workFileName(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 500 || /[\\:\x00-\x1f]/.test(value) || value.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part))) throw new Error('工作文件名称无效。')
  return value
}
