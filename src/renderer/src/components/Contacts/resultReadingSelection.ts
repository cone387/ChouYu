/** Locate the selected saved section before asking the existing citation validator for an anchor. */
export function resultReadingSelection(root: HTMLElement | null, fallbackId: string): { sectionId: string; body: HTMLElement } | null {
  const reader = root?.querySelector('[data-result-a2ui]')
  if (!reader) return null
  const selection = window.getSelection()
  const node = selection && !selection.isCollapsed && selection.rangeCount ? selection.getRangeAt(0).startContainer : null
  const element = node instanceof Element ? node : node?.parentElement
  const selected = element?.closest<HTMLElement>('[data-result-section]')
  const section = selected && reader.contains(selected) ? selected : [...reader.querySelectorAll<HTMLElement>('[data-result-section]')].find(s => s.dataset.resultSection === fallbackId)
  const body = section?.querySelector<HTMLElement>('.contact-markdown')
  return section?.dataset.resultSection && body ? { sectionId: section.dataset.resultSection, body } : null
}
