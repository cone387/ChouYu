import type { AgentNotice } from '../../shared/agents'
import type { AssistantMessageKind } from '../../shared/assistant-message'
import type { ContactActionInteraction } from '../../shared/contact-actions'
import type { TaskReminderRef } from '../../shared/reminders'
import type { SessionWorkspace } from '../database'

export type DeliveryRequest =
  | { kind: 'assistant'; content: string; timestamp?: number; messageKind?: AssistantMessageKind; receiptIds: string[]; taskReminder?: TaskReminderRef; snoozeKey?: string; messageId?: string }
  | { kind: 'agent'; notice: AgentNotice }
  | { kind: 'interaction'; card: ContactActionInteraction }
export interface PersistedDelivery {
  workspace: SessionWorkspace
  disposition: 'delivered' | 'obsolete'
}
export interface DeliveryReceipt extends PersistedDelivery {
  keys: string[]
  persisted: true
}
export interface DeliveryPorts {
  persist(request: DeliveryRequest): PersistedDelivery
  notify(): void
}

/** Keep legacy keys so a version upgrade does not deliver historical events again. */
export function deliveryKeys(request: DeliveryRequest): string[] {
  if (request.kind === 'agent') return [`agent-notice:${request.notice.characterId}:${request.notice.id}`]
  if (request.kind === 'interaction') return [`contact-action:${request.card.characterId}:${request.card.id}`]
  if (!Array.isArray(request.receiptIds) || !request.receiptIds.length || request.receiptIds.some(id => typeof id !== 'string' || !id.trim())) throw new Error('消息缺少稳定的送达标识。')
  return [...new Set(request.receiptIds.map(id => `reminder-receipt:${id}`))]
}
