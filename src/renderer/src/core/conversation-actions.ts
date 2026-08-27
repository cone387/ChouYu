import type { Message } from '../shared/types'

export function getConversationForRetry(messages: Message[], assistantMessageId: string): Message[] | null {
  const assistantIndex = messages.findIndex((message) => message.id === assistantMessageId)
  if (assistantIndex <= 0 || assistantIndex !== messages.length - 1) return null
  const assistant = messages[assistantIndex]
  if (assistant.role !== 'assistant' || assistant.pluginData) return null
  if (messages[assistantIndex - 1]?.role !== 'user') return null
  return messages.slice(0, assistantIndex)
}
