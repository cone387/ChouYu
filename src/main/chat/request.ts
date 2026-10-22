import { validateCitationShapes } from '../../shared/contact-citations'
import type { AIChatMessage, AIStreamRequest } from '../../shared/ai'

export function parseAIStreamRequest(value: unknown): AIStreamRequest | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Record<string, unknown>
  if (typeof input.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(input.requestId)) return null
  if (typeof input.systemPrompt !== 'string' || input.systemPrompt.length > 50_000) return null
  if (!Array.isArray(input.messages) || input.messages.length > 30) return null

  const messages: AIChatMessage[] = []
  for (const item of input.messages) {
    if (!item || typeof item !== 'object') return null
    const message = item as Record<string, unknown>
    if (!['user', 'assistant', 'system'].includes(String(message.role))) return null
    if (typeof message.content !== 'string' || message.content.length > 200_000) return null
    if (message.imageUrl !== undefined && (typeof message.imageUrl !== 'string' || message.imageUrl.length > 15_000_000)) return null
    let contactCitations: import('../../shared/contact-content').ContentCitation[] | undefined
    try { if (message.contactCitations !== undefined) contactCitations = validateCitationShapes(message.contactCitations) } catch { return null }
    messages.push({
      role: message.role as AIChatMessage['role'],
      content: message.content,
      contactCitations,
      imageUrl: message.imageUrl as string | undefined
    })
  }

  const characterId = typeof input.characterId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(input.characterId) ? input.characterId : undefined

  const sessionId = typeof input.sessionId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(input.sessionId) ? input.sessionId : undefined
  return { requestId: input.requestId, systemPrompt: input.systemPrompt, messages, characterId, sessionId }
}
