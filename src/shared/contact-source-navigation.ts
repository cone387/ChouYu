import { validateDeliveryRef, type DeliveryRef } from './contact-content'
import { sanitizeContactCommunication } from './contact-communication'
export function receiptDeliveryRef(value: unknown): DeliveryRef | null {
  const message = sanitizeContactCommunication(value), source = message?.source
  if (!message || source?.kind !== 'task' || !source.artifact) return null
  return { characterId: message.characterId, topicId: source.topicId, version: source.artifact.version, sectionId: source.artifact.sectionId }
}
export function parseDeliverySource(href: string): DeliveryRef | null {
  try {
    const url = new URL(href)
    if (url.protocol !== 'contact-delivery:' || url.username || url.password || url.port) return null
    const [topicId, sectionId, extra] = url.pathname.slice(1).split('/').map(decodeURIComponent)
    if (extra !== undefined) return null
    return validateDeliveryRef({ characterId: decodeURIComponent(url.hostname), topicId, sectionId, version: Number(url.searchParams.get('version')) })
  } catch { return null }
}
