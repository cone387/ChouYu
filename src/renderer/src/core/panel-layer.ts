/** Activate the DOM window actually clicked, including React portals. */
export function activatePanel(target: EventTarget | null): void {
  const panel = target instanceof Element ? target.closest<HTMLElement>('[data-panel-window]') : null
  if (!panel) return
  for (const window of document.querySelectorAll<HTMLElement>('[data-panel-window]')) {
    const active = window === panel
    window.style.zIndex = active ? '9999' : '9998'
    window.dataset.panelActive = String(active)
  }
}
