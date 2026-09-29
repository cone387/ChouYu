import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react'

export default function ContactTaskSettingsDialog({ id, taskTitle, busy, returnFocus, onClose, children }: {
  id: string; taskTitle: string; busy: boolean; returnFocus: RefObject<HTMLButtonElement>; onClose: () => void; children: ReactNode
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const element = dialog.current
    const previous = returnFocus.current
    element?.showModal()
    return () => {
      element?.close()
      // Wait until the modal is removed from the top layer and the task is no longer inert.
      requestAnimationFrame(() => { if (previous?.isConnected) previous.focus({ preventScroll: true }) })
    }
  }, [returnFocus])
  const close = () => { if (!busy) { dialog.current?.close(); onClose() } }

  return <dialog ref={dialog} id={id} className="topic-settings-dialog" data-interactive aria-labelledby={titleId}
    onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation() }}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); close() }}>
    <header className="topic-settings-dialog-heading">
      <div><h3 id={titleId}>本任务设置</h3><p>{taskTitle}</p></div>
      <button type="button" autoFocus aria-label="关闭本任务设置" disabled={busy} onClick={close}>关闭</button>
    </header>
    <div className="topic-settings">{children}</div>
  </dialog>
}
