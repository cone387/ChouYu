import { appendAssistantMessage, appendAgentNotice, appendContactAction, retireContactAction, getSession } from '../database'
import type { DeliveryRequest, PersistedDelivery } from './contracts'

/** Existing database validation, receipts and pending-write retry remain the sole authority. */
export function persistDelivery(request: DeliveryRequest): PersistedDelivery {
  if (request.kind === 'assistant') return { disposition: 'delivered', workspace: appendAssistantMessage(request.content, request.timestamp, request.messageKind, {
    receiptIds: request.receiptIds, messageId: request.messageId, taskReminder: request.taskReminder, snoozeKey: request.snoozeKey
  }) }
  if (request.kind === 'agent') return { disposition: 'delivered', workspace: appendAgentNotice(request.notice) }
  if (!getSession(request.card.request.sessionId)) return { disposition: 'obsolete', workspace: retireContactAction(request.card) }
  return { disposition: 'delivered', workspace: appendContactAction(request.card) }
}
