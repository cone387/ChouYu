import { Message } from '../shared/types'
import { DEFAULT_SOUL_MD } from '../../../shared/config'

export function buildSystemPrompt(soulMd?: string, memoryContext?: string): string {
  const base = soulMd?.trim() || DEFAULT_SOUL_MD
  return memoryContext?.trim() ? `${base}\n\n${memoryContext.trim()}` : base
}

export function buildMessages(
  history: Message[],
  maxMessages: number = 30
): Message[] {
  return history.filter((message) => !message.toolData).slice(-maxMessages)
}
