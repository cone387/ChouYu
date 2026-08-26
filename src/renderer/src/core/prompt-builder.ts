import { Message } from '../shared/types'
import { DEFAULT_SOUL_MD } from '../../../shared/config'

export function buildSystemPrompt(soulMd?: string): string {
  return soulMd?.trim() || DEFAULT_SOUL_MD
}

export function buildMessages(
  history: Message[],
  maxMessages: number = 30
): Message[] {
  return history.slice(-maxMessages)
}
