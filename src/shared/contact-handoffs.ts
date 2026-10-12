import type { ContentCitation, DeliveryRef } from './contact-content'
import type { AgentOverview } from './agents'
export type HandoffRequest = { requestId: string; source: DeliveryRef; recipientId: string; description: string }
export type Handoff = { id: string; source: DeliveryRef; recipientId: string; topicId: string; description: string; createdAt: number; continuous: boolean }
export type HandoffWork = { description: string; requestLog: string; tokens?: number; continuous: boolean }
export type HandoffPreparation = { kind: 'ready'; token: string; request: HandoffRequest; work: HandoffWork } | { kind: 'question'; question: string } | { kind: 'committed'; handoff: Handoff }
export type HandoffState = { handoff: Handoff; status: string; state?: import('./task-state').TaskState; reviewedVersion?: number; latestVersion: number }
export interface ContactHandoffAPI {
  prepareHandoff(owner: string, request: HandoffRequest): Promise<HandoffPreparation>
  commitHandoff(owner: string, preparation: HandoffPreparation): Promise<Handoff>
  handoffs(owner: string, topicId?: string): Promise<Handoff[]>
  handoffState(owner: string, id: string): Promise<HandoffState>
  returnReview(owner: string, request: { handoffId: string; review: ContentCitation; source: ContentCitation; feedback: string; topicRevision: number }): Promise<AgentOverview>
}
