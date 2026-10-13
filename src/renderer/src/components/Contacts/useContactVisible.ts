import { useEffect, useState } from 'react'

/** Explicit surface visibility plus the containing Electron document. Does not stop work. */
export function useContactVisible(active: boolean) {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden')
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', update); update()
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  return active && visible
}
