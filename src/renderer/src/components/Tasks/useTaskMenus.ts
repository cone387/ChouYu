import { useEffect, useRef } from 'react'

// Only transient menus participate; project groups and archived sections stay expanded.
const MENU_SELECTOR = 'details.tasks-tool-menu, details.tasks-project-menu, details.tasks-item-menu'

export default function useTaskMenus(active: boolean) {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const openMenus = () => Array.from(root.querySelectorAll<HTMLDetailsElement>(MENU_SELECTOR)).filter(menu => menu.open)
    const popupFor = (menu: HTMLDetailsElement) => menu.querySelector<HTMLElement>(':scope > .tasks-item-menu-popover')
    const closeMenu = (menu: HTMLDetailsElement) => {
      for (const child of Array.from(menu.querySelectorAll<HTMLDetailsElement>(MENU_SELECTOR)).reverse()) {
        const childPopup = popupFor(child)
        if (childPopup?.matches(':popover-open')) childPopup.hidePopover()
        child.open = false
      }
      const popup = popupFor(menu)
      if (popup?.matches(':popover-open')) popup.hidePopover()
      menu.open = false
    }
    const positionMenu = (menu: HTMLDetailsElement) => {
      const popup = popupFor(menu)
      const trigger = menu.querySelector<HTMLElement>(':scope > summary')
      if (!popup || !trigger || !menu.open) return
      const anchor = trigger.getBoundingClientRect()
      const panel = (menu.closest('.tasks-composer') ?? root).getBoundingClientRect()
      const margin = 8, gap = 5
      const leftEdge = Math.max(0, panel.left) + margin
      const rightEdge = Math.min(window.innerWidth, panel.right) - margin
      const topEdge = Math.max(0, panel.top) + margin
      const bottomEdge = Math.min(window.innerHeight, panel.bottom) - margin
      const maxWidth = Math.max(1, rightEdge - leftEdge)
      const maxHeight = Math.max(1, bottomEdge - topEdge)
      Object.assign(popup.style, {
        inset: 'auto', margin: '0', position: 'fixed',
        left: `${leftEdge}px`, top: `${topEdge}px`,
        minWidth: `${Math.min(160, maxWidth)}px`, width: menu.matches('.tasks-field-menu') ? `${Math.min(280, maxWidth)}px` : 'max-content', maxWidth: `${maxWidth}px`, maxHeight: `${maxHeight}px`
      })
      popup.setAttribute('popover', 'manual')
      if (!popup.matches(':popover-open')) popup.showPopover()
      const size = popup.getBoundingClientRect()
      // Calendars can overlap their trigger so the month and time settings stay visible together.
      if (menu.matches('.tasks-composer-dates')) {
        popup.style.left = `${Math.max(leftEdge, Math.min(anchor.left, rightEdge - size.width))}px`
        popup.style.top = `${Math.max(topEdge, Math.min(anchor.bottom + gap, bottomEdge - size.height))}px`
        return
      }
      const below = Math.max(0, bottomEdge - anchor.bottom - gap)
      const above = Math.max(0, anchor.top - topEdge - gap)
      const upwards = size.height > below && above > below
      const available = upwards ? above : below
      // When the anchor itself is at an edge, use the available panel height.
      popup.style.maxHeight = `${available || maxHeight}px`
      // Windows scrollbars consume width when maxHeight makes the menu scroll.
      // Position using the final box, including that scrollbar and any wrapping.
      const finalSize = popup.getBoundingClientRect()
      const alignLeft = menu.matches('.tasks-create-options, .tasks-heading-menu, .tasks-composer-dates, .tasks-select') || Boolean(menu.closest('.tasks-toolbar'))
      const desiredLeft = alignLeft ? anchor.left : anchor.right - finalSize.width
      const desiredTop = upwards ? anchor.top - gap - finalSize.height : anchor.bottom + gap
      popup.style.left = `${Math.max(leftEdge, Math.min(desiredLeft, rightEdge - finalSize.width))}px`
      popup.style.top = `${Math.max(topEdge, Math.min(desiredTop, bottomEdge - finalSize.height))}px`
    }
    const closeOutside = (event: Event) => {
      if (!(event.target instanceof Node)) return
      for (const menu of openMenus()) if (!menu.contains(event.target)) closeMenu(menu)
    }
    const onClick = (event: MouseEvent) => {
      closeOutside(event)
      if (!(event.target instanceof Element)) return
      const button = event.target.closest('button')
      const menu = button?.closest<HTMLDetailsElement>(MENU_SELECTOR)
      // Checkbox/select changes remain open so users can adjust several filters.
      if (button && !button.disabled && !button.hasAttribute('data-menu-keep-open') && menu && root.contains(menu)) closeMenu(menu)
    }
    const onToggle = (event: Event) => {
      const menu = event.target
      if (!(menu instanceof HTMLDetailsElement) || !menu.matches(MENU_SELECTOR)) return
      if (!menu.open) { closeMenu(menu); return }
      for (const other of openMenus()) if (other !== menu && !other.contains(menu)) closeMenu(other)
      positionMenu(menu)
    }
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const menus = openMenus()
      if (!menus.length) return
      const focusedMenu = [...menus].reverse().find(menu => menu.contains(document.activeElement)) ?? menus[menus.length - 1]
      closeMenu(focusedMenu)
      focusedMenu.querySelector<HTMLElement>(':scope > summary')?.focus()
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    const closeAll = () => { for (const menu of openMenus()) closeMenu(menu) }
    const onScroll = (event: Event) => {
      // Scrolling a long popup should not dismiss it; scrolling its page should.
      if (event.target instanceof Element && event.target.closest('.tasks-item-menu-popover')) return
      closeAll()
    }
    const onResize = () => { for (const menu of openMenus()) positionMenu(menu) }
    if (!active) { closeAll(); return }
    document.addEventListener('pointerdown', closeOutside, true)
    document.addEventListener('click', onClick, true)
    document.addEventListener('focusin', closeOutside, true)
    document.addEventListener('keydown', onEscape, true)
    root.addEventListener('toggle', onToggle, true)
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    const observer = new ResizeObserver(onResize)
    observer.observe(root)
    return () => {
      closeAll()
      observer.disconnect()
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('pointerdown', closeOutside, true)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('focusin', closeOutside, true)
      document.removeEventListener('keydown', onEscape, true)
      root.removeEventListener('toggle', onToggle, true)
    }
  }, [active])

  return rootRef
}
