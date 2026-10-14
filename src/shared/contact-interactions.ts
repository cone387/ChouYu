export type ContactInteractionKind = 'question' | 'budget' | 'retry'
export type ContactInteractionStatus = 'pending' | 'resolved' | 'obsolete'
export type ContactBudgetKey = 'taskCalls' | 'dailyCalls' | 'taskTokens' | 'dailyTokens'
export interface ContactBudgetField {
  key: ContactBudgetKey; label: string; unit: string; used: number; limit: number; needed: number; max: number
}
export interface ContactInteractionDetails {
  impact?: string
  recoveryMessage?: string
  currentState?: 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'paused' | 'abandoned' | 'deleted' | 'changed' | 'interrupted'
  automaticRetryAt?: number
  question?: string
  failureDetail?: string
  failure?: { title?: string; kind: 'billing' | 'configuration' | 'network' | 'format' | 'permission' | 'skill' | 'source' | 'tool-limit' | 'material' | 'chapter' | 'output' | 'storage' | 'context' | 'unknown'; message: string; action: string; settings: boolean; settingsTarget?: 'work' | 'skills' }
}
export interface ContactTaskInteraction extends ContactInteractionDetails {
  characterName?: string
  id: string; version: string; characterId: string; topicId: string; runId: string; topicTitle: string
  kind: ContactInteractionKind; status: ContactInteractionStatus
  budgets: ContactBudgetField[]; result?: string; createdAt: number
}
export type ContactInteraction = ContactTaskInteraction | import('./contact-actions').ContactActionInteraction
export interface ContactInteractionSubmission {
  version: string
  actionId?: string
  text?: string
  reject?: boolean
  /** Transient IPC input; never persisted in the interaction or sent to the model. */
  credential?: string
  answer?: string
  limits?: Partial<Record<ContactBudgetKey, number>>
}

export const interactionHref = (owner: string, id: string) => `#contact-interaction?characterId=${encodeURIComponent(owner)}&id=${encodeURIComponent(id)}`
export function interactionReferences(text: string) {
  const refs: { characterId: string; id: string }[] = []
  const content = text.replace(/\[[^\]\n]*\]\(#contact-interaction\?([^\s)]+)\)/g, (full, query: string) => {
    const params = new URLSearchParams(query), characterId = params.get('characterId'), id = params.get('id')
    if (!characterId || !id || characterId.length > 128 || id.length > 256) return full
    if (!refs.some(r => r.characterId === characterId && r.id === id)) refs.push({ characterId, id })
    return ''
  })
  return { content, refs }
}
