import type { Message } from '../shared/types'

export function getConversationForRetry(messages: Message[], assistantMessageId: string): Message[] | null {
  const assistantIndex = messages.findIndex((message) => message.id === assistantMessageId)
  if (assistantIndex <= 0 || assistantIndex !== messages.length - 1) return null
  const assistant = messages[assistantIndex]
  if (assistant.role !== 'assistant' || assistant.pluginData || assistant.toolData) return null
  let userIndex = assistantIndex - 1
  while (userIndex >= 0 && messages[userIndex].role !== 'user') userIndex -= 1
  if (userIndex < 0) return null
  return messages.slice(0, userIndex + 1)
}
