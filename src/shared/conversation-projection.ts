import type { ChatSession, ChatSessionSummary, Message } from './conversations'
import { buildSessionPreview } from './sessions'
export const messageReadTimestamp = (message: Message): number => Math.max(message.timestamp, message.replyCompletedAt ?? 0)
export function isUnreadMessage(session: ChatSession, message: Message): boolean {
  return message.role === 'assistant' && (Boolean(message.assistantKind) || Boolean(message.agentNotice) || message.communication?.source.kind === 'interaction'
    || Boolean(message.replyCompletedAt && message.replyCompletedAt > (message.replyReadAt ?? 0)))
    && messageReadTimestamp(message) > (session.lastReadAt ?? 0)
}
export interface ConversationProjection { summary: ChatSessionSummary; unread?: { at: number; preview: string } }
export function projectConversation(session: ChatSession): ConversationProjection {
  let unreadCount = 0, unread: ConversationProjection['unread']
  for (const message of session.messages) if (isUnreadMessage(session, message)) {
    unreadCount++
    const at = messageReadTimestamp(message)
    if (!unread || at > unread.at) unread = { at, preview: buildSessionPreview([message]) }
  }
  return { summary: { id: session.id, title: session.title, characterId: session.characterId, createdAt: session.createdAt,
    updatedAt: session.updatedAt, messageCount: session.messages.length, preview: buildSessionPreview(session.messages), unreadCount }, unread }
}
