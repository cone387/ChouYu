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
  if (!source || event.source !== source || event.origin !== 'null' || !['delivery-reading', 'delivery-selection'].includes(event.data?.type) || event.data.nonce !== nonce) return null
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
/** Preserve DOM occurrence identity while accounting for Markdown's block separators. */
export function anchorFromRenderedText(canonical: string, rendered: string, start: number, end: number): TextAnchor {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > rendered.length) throw new Error('请选择当前分节内的文字。')
  const starts: number[] = [], ends: number[] = [0]
  let offset = 0
  for (let i = 0; i < rendered.length; i++) {
    const char = rendered[i]
    while (canonical[offset] !== char && /\s/.test(canonical[offset] ?? '') && offset < canonical.length) offset++
    if (canonical[offset] !== char) {
      if (/\s/.test(char)) { starts[i] = offset; ends[i + 1] = offset; continue }
      throw new Error('当前展示无法精确对应正文，请切换正文后重新选择。')
    }
    starts[i] = offset; ends[i + 1] = ++offset
  }
  const from = starts[start], to = ends[end]
  return validateAnchor({ start: from, end: to, quote: canonical.slice(from, to), textHash: textHash(canonical) }, canonical)
}
export function selectedCitation(ref: DeliveryRef, section: DeliverySection, container: HTMLElement | null): { ref: DeliveryRef; anchor?: TextAnchor } {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || !selection.rangeCount) return { ref: { ...ref, sectionId: section.id } }
  const range = selection.getRangeAt(0)
  if (!container?.contains(range.startContainer) || !container.contains(range.endContainer)) throw new Error('请选择当前正文分节中的文字。')
  const before = document.createRange(); before.selectNodeContents(container); before.setEnd(range.startContainer, range.startOffset)
  const through = document.createRange(); through.selectNodeContents(container); through.setEnd(range.endContainer, range.endOffset)
  const anchor = anchorFromRenderedText(deliveryText(section.body), container.textContent ?? '', before.toString().length, through.toString().length)
  return { ref: { ...ref, sectionId: section.id }, anchor }
}
export function highlightAnchor(container: HTMLElement, body: string, anchor: TextAnchor): void {
  const canonical = deliveryText(body)
  validateAnchor(anchor, canonical)
  const targetStart = canonical.slice(0, anchor.start).replace(/\s/g, '').length, targetEnd = canonical.slice(0, anchor.end).replace(/\s/g, '').length
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT), range = document.createRange()
  let count = 0, started = false, node: Node | null
  while ((node = walker.nextNode())) {
    const text = node.textContent ?? ''
    for (let i = 0; i < text.length; i++) {
      if (/\s/.test(text[i])) continue
      if (!started && count === targetStart) { range.setStart(node, i); started = true }
      count++
      if (started && count === targetEnd) {
        range.setEnd(node, i + 1)
        const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range)
        node.parentElement?.scrollIntoView({ block: 'center' }); return
      }
    }
  }
  throw new Error('当前展示无法精确定位引文，请查看该分节正文。')
}
