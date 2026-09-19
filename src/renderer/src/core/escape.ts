const overlayEscapes = new WeakSet<KeyboardEvent>()
const OVERLAY_SELECTOR = 'dialog[open], [aria-modal="true"], [role="alertdialog"], [role="menu"], :popover-open, [data-escape-overlay]'
const RESTORED_CONTROL_SELECTOR = 'button, summary, a[href], [tabindex], [role="button"], [role="combobox"]'

/** Remember overlays before React handlers can synchronously unmount them. */
export function initEscapeInteractions(): () => void {
  let overlays: Element[] = []
  let frame: number | undefined
  const resetRestoration = () => {
    overlays = []
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = undefined
  }
  const isOpen = (element: Element) => element.isConnected && element.matches(OVERLAY_SELECTOR) && element.getClientRects().length > 0
  const clearRestoredFocus = () => {
    const target = document.activeElement
    if (!(target instanceof HTMLElement) || !target.matches(RESTORED_CONTROL_SELECTOR)) return
    // Preserve the caret and selection when returning to a composer or search field.
    if (target.matches('input, textarea, select') || target.isContentEditable) return
    // A nested picker can close while its parent dialog remains open.
    if (overlays.some(overlay => !isOpen(overlay) && !overlay.contains(target))) target.blur()
  }
  const capture = (event: KeyboardEvent) => {
    resetRestoration()
    if (event.key !== 'Escape') return
    overlays = Array.from(document.querySelectorAll(OVERLAY_SELECTOR)).filter(isOpen)
    if (!overlays.length) return
    overlayEscapes.add(event)
    // Some dialogs never move focus away from their opener, so focusin alone
    // cannot catch them. Check after dismissal and again after deferred restores.
    frame = requestAnimationFrame(() => {
      clearRestoredFocus()
      frame = requestAnimationFrame(() => { frame = undefined; clearRestoredFocus() })
    })
  }
  window.addEventListener('keydown', capture, true)
  window.addEventListener('pointerdown', resetRestoration, true)
  window.addEventListener('focusin', clearRestoredFocus, true)
  return () => {
    resetRestoration()
    window.removeEventListener('keydown', capture, true)
    window.removeEventListener('pointerdown', resetRestoration, true)
    window.removeEventListener('focusin', clearRestoredFocus, true)
  }
}

export function isOverlayEscape(event: KeyboardEvent): boolean {
  return overlayEscapes.has(event)
}
