import { Message, SessionWorkspace } from '../shared/types'

export async function loadMessages(): Promise<Message[]> {
  return window.electronAPI.db.getMessages()
}

export async function saveMessages(messages: Message[]): Promise<void> {
  await window.electronAPI.db.saveMessages(messages)
}

export async function clearMessages(): Promise<void> {
  await window.electronAPI.db.clearMessages()
}

export async function loadSessionWorkspace(): Promise<SessionWorkspace> {
  return window.electronAPI.db.getSessionWorkspace()
}

export async function saveActiveSessionMessages(sessionId: string, messages: Message[]): Promise<SessionWorkspace> {
  return window.electronAPI.db.saveSessionMessages(sessionId, messages)
}
