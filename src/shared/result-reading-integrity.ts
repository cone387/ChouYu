type ProjectionNode = {
  querySelectorAll(selector: string): Iterable<ProjectionNode>
  textContent: string | null
  replaceWith(text: string): void
  getAttribute(name: string): string | null
  remove(): void
}
/** Self-contained: also serialized into the isolated preview's host-owned JS world. */
export function resultReadingDOMText(root: { cloneNode(deep: boolean): unknown }): string {
  const clone = root.cloneNode(true) as ProjectionNode
  // Match deliveryText's canonical Markdown projection, not generated footnote navigation.
  for (const node of clone.querySelectorAll('[data-footnotes],[data-footnote-ref]')) node.remove()
  for (const node of clone.querySelectorAll('img')) node.replaceWith(node.getAttribute('alt') ?? '')
  for (const node of clone.querySelectorAll('[data-reading-image-alt]')) node.replaceWith(node.getAttribute('data-reading-image-alt') ?? '')
  return clone.textContent ?? ''
}
