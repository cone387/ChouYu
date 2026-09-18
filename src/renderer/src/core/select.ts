/** Let Escape dismiss the top-layer picker before a containing menu/dialog. */
export function initSelectInteractions(): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !(event.target instanceof Element)) return
    const select = event.target.closest('select')
    if (select?.matches(':open')) {
      // Keep the browser's default picker dismissal, but don't close its parent.
      event.stopImmediatePropagation()
    }
  }
  window.addEventListener('keydown', onKeyDown, true)
  return () => window.removeEventListener('keydown', onKeyDown, true)
}
