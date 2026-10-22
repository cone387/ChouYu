import type { AgentRunStatus } from './agents'
import type { ContentCitation } from './contact-content'

export interface DeliveryFeedbackInput {
  topicId: string; revision: number; version: number; action: 'accept' | 'revise'; reason: string; requestId: string; conversation?: string
  citation?: ContentCitation; scope?: 'content' | 'presentation'
}
export interface DeliveryFeedbackReceipt {
  saved: true; feedbackId: number; requestId: string; topicId: string; version: number; action: 'accept' | 'revise'
  runId?: string; workCompleted: false; message: string
}
export interface DeliveryFeedbackRecord {
  id: number; owner: string; topicId: string; requestId?: string; baseVersion: number; action: 'accept' | 'revise'; reason: string
  runId?: string; originalRunId?: string; resultVersion?: number; createdAt: number
  status: AgentRunStatus | 'accepted' | 'unlinked' | 'no-result'
}
