import { useEffect, type RefObject } from 'react'
/** Only acknowledge when the latest content is visible in the focused conversation. */
export function useReminderRead(container: RefObject<HTMLElement>, end: RefObject<HTMLElement>, active: boolean, onRead?: () => void): void {
  useEffect(() => {
    const area = container.current, last = end.current
    if (!active || !area || !last || !onRead) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const visible = () => {
      const a = area.getBoundingClientRect(), b = last.getBoundingClientRect()
      return document.hasFocus() && document.visibilityState === 'visible' && area.clientHeight > 0 && b.top >= a.top && b.bottom <= a.bottom + 1
    }
    const check = () => {
      if (timer) clearTimeout(timer)
      timer = undefined
      if (visible()) timer = setTimeout(() => { if (visible()) onRead() }, 600)
    }
    const observer = new IntersectionObserver(check, { root: area, threshold: 1 })
    observer.observe(last)
    window.addEventListener('focus', check); window.addEventListener('blur', check)
    document.addEventListener('visibilitychange', check); area.addEventListener('scroll', check)
    check()
    return () => {
      if (timer) clearTimeout(timer)
      observer.disconnect(); window.removeEventListener('focus', check); window.removeEventListener('blur', check)
      document.removeEventListener('visibilitychange', check); area.removeEventListener('scroll', check)
    }
  }, [container, end, active, onRead])
}
