import type { ContactCommunication } from './contact-communication'
import type { AgentMessageRef } from './agents'
import type { TaskReminderRef } from './reminders'
import type { AssistantMessageKind } from './assistant-message'
import type { ToolActivityData } from './tools'
import type { MemoryFeedbackValue } from './memory'

export interface Message {
  harnessSource?:import('./harness').HarnessSource
  communication?: ContactCommunication
  contactCitations?: import('./contact-content').ContentCitation[]
  contactContext?: import('./contact-content').ContactContextRecord
  agentNotice?: AgentMessageRef
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  imageUrl?: string
  snoozeKey?: string
  taskReminder?: TaskReminderRef
  assistantKind?: AssistantMessageKind
  responseStatus?: 'error' | 'stopped'
  replyCompletedAt?: number
  replyReadAt?: number
  toolData?: ToolActivityData
  memoryRefs?: Array<{ id: string; content: string; type: string; feedback?: MemoryFeedbackValue; sourceIds?: string[]; clusterId?: string; compressedCount?: number }>
  pluginData?: unknown
}

export interface ChatSession {
  id: string
  title: string
  messages: Message[]
  characterId: string
  createdAt: number
  updatedAt: number
  lastReadAt?: number
}

export interface ChatSessionSummary {
  id: string
  title: string
  preview: string
  messageCount: number
  characterId: string
  createdAt: number
  updatedAt: number
  unreadCount: number
}

export interface SessionWorkspace {
  sessions: ChatSessionSummary[]
  activeSession: ChatSession
}

