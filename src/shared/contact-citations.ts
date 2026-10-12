import { validateDeliveryRef, type ContentCitation } from './contact-content'

/** Storage validates shape; send/revision boundaries additionally resolve the saved version. */
export function validateCitationShapes(raw: unknown): ContentCitation[] {
  if (!Array.isArray(raw) || raw.length > 4) throw new Error('每条消息最多引用 4 处正文。')
  return raw.map(value => {
    if (!value || typeof value !== 'object') throw new Error('正文引用无效。')
    const ref = validateDeliveryRef(value.ref), a = value.anchor
    if (a === undefined) return { ref }
    if (!ref.sectionId || !a || !Number.isSafeInteger(a.start) || !Number.isSafeInteger(a.end) || a.start < 0 || a.end <= a.start || a.end > 1000000 || typeof a.quote !== 'string' || !a.quote.length || a.quote.length > 2000 || a.end - a.start !== a.quote.length || typeof a.textHash !== 'string' || !/^[a-f0-9]{64}$/.test(a.textHash)) throw new Error('引文范围无效，请重新选择。')
    return { ref, anchor: { start: a.start, end: a.end, quote: a.quote, textHash: a.textHash } }
  })
}
export function sanitizeCitations(raw: unknown): ContentCitation[] | undefined {
  if (raw === undefined) return undefined
  try { const values = validateCitationShapes(raw); return values.length ? values : undefined } catch { return undefined }
}
