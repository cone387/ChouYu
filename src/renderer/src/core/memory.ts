import { Message } from '../shared/types'

export async function loadMessages(): Promise<Message[]> {
  return window.electronAPI.db.getMessages()
}

export async function saveMessages(messages: Message[]): Promise<void> {
  await window.electronAPI.db.saveMessages(messages)
}

export async function clearMessages(): Promise<void> {
  await window.electronAPI.db.clearMessages()
}
