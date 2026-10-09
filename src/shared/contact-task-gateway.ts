import type { AgentOverview } from './agents'
import type { AssistantRoutine } from './assistant-routines'
import type { AssistantDutyKey } from './assistant-duties'

export type ContactTaskTarget =
  | { kind: 'create'; characterId: string }
  | { kind: 'edit-work'; characterId: string; topicId: string; topicRevision: number }
  | { kind: 'edit-routine'; characterId: string; routineId: string; routineRevision: number }
  | { kind: 'edit-duty'; characterId: string; dutyKey: AssistantDutyKey }
/** Draft-store key for a target; main and renderer must derive it identically. */
export function contactTaskTargetKey(target: ContactTaskTarget): string {
  return target.kind === 'create' ? `create:${target.characterId}`
    : target.kind === 'edit-work' ? `edit-work:${target.characterId}:${target.topicId}`
    : target.kind === 'edit-routine' ? `edit-routine:${target.routineId}`
    : `edit-duty:${target.dutyKey}`
}
export interface ContactTaskGatewayResultQuestion { kind: 'question'; question: string }
export interface ContactTaskGatewayResultWorkCreated { kind: 'work-created'; overview: AgentOverview }
export interface ContactTaskGatewayResultWorkEdited { kind: 'work-edited'; overview: AgentOverview; budgetApplied: boolean; budgetError?: string; statusApplied: boolean; statusError?: string }
export interface ContactTaskGatewayResultRoutine { kind: 'routine'; routine: AssistantRoutine }
export interface ContactTaskGatewayResultDuty { kind: 'duty' }
export type ContactTaskRequestResult = ContactTaskGatewayResultQuestion | ContactTaskGatewayResultWorkCreated | ContactTaskGatewayResultWorkEdited | ContactTaskGatewayResultRoutine | ContactTaskGatewayResultDuty
export interface ContactTaskGatewayAPI {
  request(target: ContactTaskTarget, message: string): Promise<ContactTaskRequestResult>
  drafts(): Promise<{ targetKey: string; turns: { role: 'user' | 'assistant'; text: string }[]; updatedAt: number }[]>
}
