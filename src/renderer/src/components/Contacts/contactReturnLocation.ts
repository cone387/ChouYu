import type { ContactAgentTab } from './ContactAgentPanel'
import type { ContentCitation } from '../../../../shared/contact-content'
import { validId, validateDeliveryRef } from '../../../../shared/contact-content'
import { DEFAULT_CHARACTER_ID } from '../../../../shared/characters'
import { ASSISTANT_DUTIES } from '../../../../shared/assistant-duties'
export type ContactReturnLocation = { characterId: string; tab: ContactAgentTab; topicId?: string; delivery?: ContentCitation; interactionId?: string; scrollTop: number; surfaceId?: string; handoff?: boolean }
export class ReturnLocations {
  private items = new Map<string, ContactReturnLocation>()
  save(location: ContactReturnLocation): string {
    if (!validId(location.characterId) || !['overview', 'work', 'portfolio', 'memory', 'materials', 'skills', 'profile', 'settings', 'history', 'analytics'].includes(location.tab) || !Number.isFinite(location.scrollTop) || location.scrollTop < 0 || location.topicId !== undefined && !validId(location.topicId)) throw new Error('返回位置无效。')
    if (location.delivery && validateDeliveryRef(location.delivery.ref).characterId !== location.characterId) throw new Error('返回成果不属于此联系人。')
    const token = crypto.randomUUID(); this.items.set(token, structuredClone(location))
    while (this.items.size > 20) this.items.delete(this.items.keys().next().value!)
    return token
  }
  peek(token: string) { const value = this.items.get(token); return value && structuredClone(value) }
  take(token: string) { const value = this.peek(token); this.items.delete(token); return value }
}
const locations = new ReturnLocations()
export const saveReturnLocation = (location: ContactReturnLocation) => locations.save(location)
export const takeReturnLocation = (token: string) => locations.take(token)
export const peekReturnLocation = (token: string) => locations.peek(token)
export async function validateReturnLocation(location: ContactReturnLocation) {
  const api = window.electronAPI
  if (!(await api.characters.list()).some(contact => contact.id === location.characterId)) throw new Error('原联系人已删除，无法返回。')
  if (location.delivery) await api.agents.validateCitation(location.characterId, location.delivery)
  else if (location.topicId) {
    const topic = location.topicId
    if (topic.startsWith('routine:') || topic.startsWith('duty:') || topic === 'morning-summary') {
      if (location.characterId !== DEFAULT_CHARACTER_ID) throw new Error('原事项不属于此联系人。')
      if (topic.startsWith('duty:')) { if (!ASSISTANT_DUTIES.some(duty => `duty:${duty.key}` === topic)) throw new Error('原职责不存在。') }
      else {
        const routines = await api.assistantRoutines.list()
        if (topic === 'morning-summary' ? routines.some(item => item.kind === 'contact-summary') : !routines.some(item => `routine:${item.id}` === topic)) throw new Error('原安排已改变或删除，请重新打开任务。')
      }
    } else await api.agents.topicDetail(location.characterId, topic)
  }
  if (location.interactionId) await api.agents.getInteraction(location.characterId, location.interactionId)
}
export function captureReturnLocation(): { location: ContactReturnLocation; focus: HTMLElement | null; scroll: HTMLElement | null } | undefined {
  const focus = document.activeElement as HTMLElement | null
  const handoff = focus?.closest<HTMLElement>('[data-contact-handoff-dialog]')
  const agent = focus?.closest<HTMLElement>('[data-contact-agent]') || focus?.closest<HTMLElement>('[data-contact-work-surface]')?.querySelector<HTMLElement>('[data-contact-agent]') || (handoff ? Array.from(document.querySelectorAll<HTMLElement>('[data-contact-agent]')).filter(el => el.dataset.contactAgent === handoff.dataset.contactOwner && !!el.getClientRects().length).sort((a, b) => Number(!!b.closest('.contact-work-sheet[open]')) - Number(!!a.closest('.contact-work-sheet[open]')))[0] : undefined)
  const interaction = focus?.closest<HTMLElement>('[data-contact-interaction]')
  const owner = handoff?.dataset.contactOwner || agent?.dataset.contactAgent || interaction?.dataset.contactOwner
  if (!owner) return
  const surface = agent?.closest<HTMLElement>('[data-contact-work-surface]')
  const scroll = surface?.querySelector<HTMLElement>('.contact-work-sheet-content') || agent?.closest<HTMLElement>('.contacts-detail') || focus?.closest<HTMLElement>('.contact-pending-dialog') || null
  const reader = agent && Array.from(agent.querySelectorAll<HTMLElement>('[data-reading-reference]')).find(el => !!el.getClientRects().length)
  let delivery: ContentCitation | undefined
  try { if (handoff?.dataset.sourceRef || reader?.dataset.readingReference) delivery = { ref: JSON.parse(handoff?.dataset.sourceRef || reader!.dataset.readingReference!) } } catch { /* A malformed transient DOM value is not restored. */ }
  const tab = (handoff ? 'portfolio' : agent?.dataset.selectedTab || 'work') as ContactAgentTab
  return { location: { characterId: owner, tab, ...(delivery ? { delivery, topicId: delivery.ref.topicId } : { topicId: interaction?.dataset.interactionTopic || agent?.querySelector<HTMLElement>('.contact-topics')?.dataset.selectedTopic || undefined }), interactionId: interaction?.dataset.contactInteraction, scrollTop: scroll?.scrollTop || 0, surfaceId: surface?.dataset.contactWorkSurface, handoff: !!handoff }, focus, scroll }
}
