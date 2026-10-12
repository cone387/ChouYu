import type { DeliverySection } from '../../../../shared/agent-delivery'
import { deliveryText, textHash, validateAnchor, validateDeliveryRef, type DeliveryRef, type ReadingPosition, type TextAnchor } from '../../../../shared/contact-content'

export function restoreReading(position: ReadingPosition, sections: DeliverySection[]): { sectionId: string; anchor?: TextAnchor; changed: boolean } {
  const sectionId = position.ref.sectionId ?? '', section = sections.find(s => s.id === sectionId)
  if (!section) return { sectionId, changed: true }
  if (!position.anchor) return { sectionId, changed: false }
  try { return { sectionId, anchor: validateAnchor(position.anchor, deliveryText(section.body)), changed: false } }
  catch { return { sectionId, changed: true } }
}
export function validPresentationEvent(event: MessageEvent, source: Window | null, ref: DeliveryRef, nonce: string, sections: DeliverySection[]): ReadingPosition | null {
  if (!source || event.source !== source || event.origin !== 'null' || event.data?.type !== 'delivery-reading' || event.data.nonce !== nonce) return null
  try {
    const actual = validateDeliveryRef(event.data.ref)
    if (actual.characterId !== ref.characterId || actual.topicId !== ref.topicId || actual.version !== ref.version) return null
    const section = sections.find(s => s.id === actual.sectionId), ratio = event.data.scrollRatio
    if (!section || !Number.isFinite(ratio) || ratio < 0 || ratio > 1) return null
    const anchor = validateAnchor(event.data.anchor, deliveryText(section.body))
    return { ref: actual, anchor, scrollRatio: ratio, updatedAt: Date.now() }
  } catch { return null }
}
export function readingAt(ref: DeliveryRef, section: DeliverySection, scrollRatio: number): ReadingPosition {
  const text = deliveryText(section.body)
  // A short verified anchor also detects changes when no text is selected.
  const start = Math.min(Math.max(0, Math.floor(text.length * scrollRatio)), Math.max(0, text.length - 1)), end = Math.min(text.length, start + 120)
  return { ref: { ...ref, sectionId: section.id }, scrollRatio, updatedAt: Date.now(), ...(text ? { anchor: { start, end, quote: text.slice(start, end), textHash: textHash(text) } } : {}) }
}
