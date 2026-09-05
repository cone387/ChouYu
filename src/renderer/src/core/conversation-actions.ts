import type { Message } from '../shared/types'

/** handleStopGeneration 在流被截断且未产生任何文本时写入的占位内容。 */
export const STOPPED_PLACEHOLDER_CONTENT = '已停止生成。'

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

/** 编辑某条用户消息：截断其后所有消息并替换文本；保留 id、imageUrl、timestamp。 */
export function getEditedConversation(messages: Message[], userMessageId: string, newContent: string): Message[] | null {
  const userIndex = messages.findIndex((message) => message.id === userMessageId)
  if (userIndex < 0) return null
  const userMessage = messages[userIndex]
  if (userMessage.role !== 'user' || userMessage.toolData || userMessage.pluginData) return null
  if (!newContent.trim()) return null
  return messages.slice(0, userIndex + 1).map((message, index) =>
    index === userIndex ? { ...message, content: newContent } : message
  )
}

/** 已停止的纯文本助手消息可继续生成；返回续写的 seed 内容（占位消息 seed 为空串）。 */
export function getContinuationSeed(messages: Message[], assistantMessageId: string): string | null {
  const assistantIndex = messages.findIndex((message) => message.id === assistantMessageId)
  if (assistantIndex < 0 || assistantIndex !== messages.length - 1) return null
  const target = messages[assistantIndex]
  if (target.role !== 'assistant' || target.pluginData || target.toolData) return null
  if (target.responseStatus !== 'stopped') return null
  return target.content === STOPPED_PLACEHOLDER_CONTENT ? '' : target.content
}
