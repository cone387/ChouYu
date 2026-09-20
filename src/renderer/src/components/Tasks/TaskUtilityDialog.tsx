import { useEffect, useRef, type ReactNode } from 'react'

export default function TaskUtilityDialog({ title, busy = false, onClose, children }: { title: string; busy?: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    ref.current?.showModal()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [])
  return <dialog ref={ref} className="tasks-dialog tasks-utility-dialog" data-interactive aria-label={title} onCancel={event => { event.preventDefault(); if (!busy) onClose() }}>
    <header className="tasks-dialog-header"><h2>{title}</h2><button type="button" disabled={busy} aria-label={`关闭${title}`} onClick={onClose}>×</button></header>
    <div className="tasks-utility-body">{children}</div>
  </dialog>
}
