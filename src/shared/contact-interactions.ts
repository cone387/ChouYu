export type ContactInteractionKind = 'question' | 'budget' | 'retry'
export type ContactInteractionStatus = 'pending' | 'resolved' | 'obsolete'
export type ContactBudgetKey = 'taskCalls' | 'dailyCalls' | 'taskTokens' | 'dailyTokens'
export interface ContactBudgetField {
  key: ContactBudgetKey; label: string; unit: string; used: number; limit: number; needed: number; max: number
}
export interface ContactInteraction {
  automaticRetryAt?: number
  characterName?: string
  id: string; version: string; characterId: string; topicId: string; runId: string; topicTitle: string
  kind: ContactInteractionKind; status: ContactInteractionStatus; question?: string
  failure?: { kind: 'billing' | 'configuration' | 'network' | 'format' | 'unknown'; message: string; action: string; settings: boolean }
  budgets: ContactBudgetField[]; result?: string; createdAt: number
}
export interface ContactInteractionSubmission {
  version: string
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
