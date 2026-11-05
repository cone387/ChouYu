import { createHash } from 'node:crypto'
import type { AIStreamRequest } from '../../shared/ai'
import type { TaskRequestSource } from '../../shared/contact-task-requests'

/** Track the originating user turn across retries/continuations; quoted artifacts never become new requests. */
export function chatTaskRequestSource(request: AIStreamRequest, savedMessages: readonly { id: string; role: string; content: string; timestamp: number; editRevision?: number }[], now: number): TaskRequestSource | undefined {
  const latest = request.messages.at(-1)?.role === 'user' ? request.messages.at(-1)
    : request.sourceMessageId ? request.messages.findLast(message => message.role === 'user') : undefined
  if (!request.sessionId || latest?.role !== 'user' || !latest.content.trim()) return
  const saved = request.sourceMessageId ? savedMessages.find(message => message.id === request.sourceMessageId) : savedMessages.at(-1)
  const matched = saved?.role === 'user' && saved.content === latest.content && (saved.editRevision ?? 0) === (request.sourceMessageRevision ?? 0) ? saved : undefined
  // Stable renderer message identity is scoped to the session and exact current text.
  // It is not persistence evidence: only matching saved text gets a source link.
  const identity = request.sourceMessageId ? ['message', request.sourceMessageId, request.sourceMessageRevision ?? 0, latest.content, latest.contactCitations] : ['stream', request.requestId]
  return { requestId: `chat:${createHash('sha256').update(JSON.stringify([request.sessionId, ...identity])).digest('hex')}`,
    sessionId: request.sessionId, text: latest.content, acceptedAt: matched?.timestamp ?? now, ...(matched ? { messageId: matched.id } : {}) }
}
