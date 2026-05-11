import { Message } from '../shared/types'
import { MAX_HISTORY_MESSAGES } from '../shared/constants'

const STORAGE_KEY = 'chouyu-messages'

export function loadMessages(): Message[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw)
  } catch {
    return []
  }
}

export function saveMessages(messages: Message[]): void {
  const toSave = messages.slice(-MAX_HISTORY_MESSAGES)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave))
}

export function clearMessages(): void {
  localStorage.removeItem(STORAGE_KEY)
}
