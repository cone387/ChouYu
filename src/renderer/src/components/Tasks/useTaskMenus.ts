import { useEffect, useRef } from 'react'

// Only transient menus participate; project groups and archived sections stay expanded.
const MENU_SELECTOR = 'details.tasks-tool-menu, details.tasks-project-menu, details.tasks-item-menu'

export default function useTaskMenus(active: boolean) {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const openMenus = () => Array.from(root.querySelectorAll<HTMLDetailsElement>(MENU_SELECTOR)).filter(menu => menu.open)
    const closeOutside = (event: Event) => {
      if (!(event.target instanceof Node)) return
      for (const menu of openMenus()) if (!menu.contains(event.target)) menu.open = false
    }
    const onClick = (event: MouseEvent) => {
      closeOutside(event)
      if (!(event.target instanceof Element)) return
      const button = event.target.closest('button')
      const menu = button?.closest<HTMLDetailsElement>(MENU_SELECTOR)
      // Checkbox/select changes remain open so users can adjust several filters.
      if (button && !button.disabled && menu && root.contains(menu)) menu.open = false
    }
    const onToggle = (event: Event) => {
      const menu = event.target
      if (!(menu instanceof HTMLDetailsElement) || !menu.matches(MENU_SELECTOR) || !menu.open) return
      for (const other of openMenus()) if (other !== menu) other.open = false
    }
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const menus = openMenus()
      if (!menus.length) return
      const focusedMenu = menus.find(menu => menu.contains(document.activeElement)) ?? menus[menus.length - 1]
      for (const menu of menus) menu.open = false
      focusedMenu.querySelector<HTMLElement>(':scope > summary')?.focus()
      event.preventDefault()
      event.stopPropagation()
    }
    const closeAll = () => { for (const menu of openMenus()) menu.open = false }
    if (!active) { closeAll(); return }
    document.addEventListener('pointerdown', closeOutside, true)
    document.addEventListener('click', onClick, true)
    document.addEventListener('focusin', closeOutside, true)
    document.addEventListener('keydown', onEscape, true)
    root.addEventListener('toggle', onToggle, true)
    return () => {
      closeAll()
      document.removeEventListener('pointerdown', closeOutside, true)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('focusin', closeOutside, true)
      document.removeEventListener('keydown', onEscape, true)
      root.removeEventListener('toggle', onToggle, true)
    }
  }, [active])

  return rootRef
}
