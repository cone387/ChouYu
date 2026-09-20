import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react'

interface ConfirmRequest {
  title: string; message: string; confirmLabel?: string
  checkbox?: { label: string; defaultChecked: boolean; onChange: (checked: boolean) => void }
}
type Confirm = (request: ConfirmRequest) => Promise<boolean>
const Context = createContext<Confirm | null>(null)
export function useConfirm(): Confirm {
  const confirm = useContext(Context)
  if (!confirm) throw new Error('Confirmation requires ConfirmProvider')
  return confirm
}
export default function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmRequest | null>(null)
  const [checked, setChecked] = useState(false)
  const resolveRef = useRef<((confirmed: boolean) => void) | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const titleId = useId(), messageId = useId()
  const finish = useCallback((confirmed: boolean) => {
    dialog.current?.close()
    resolveRef.current?.(confirmed)
    resolveRef.current = null
    setRequest(null)
    if (opener.current?.isConnected) opener.current.focus()
  }, [])
  const confirm = useCallback<Confirm>(next => {
    // Never leave a replaced or unmounted request awaiting a response.
    resolveRef.current?.(false)
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setRequest(next)
    setChecked(next.checkbox?.defaultChecked ?? false)
    return new Promise(resolve => { resolveRef.current = resolve })
  }, [])
  useEffect(() => {
    if (!request) return
    dialog.current?.showModal()
    const intercept = (event: KeyboardEvent) => {
      if (event.key === 'Escape') event.stopImmediatePropagation()
    }
    window.addEventListener('keydown', intercept, true)
    return () => window.removeEventListener('keydown', intercept, true)
  }, [request])
  useEffect(() => () => { resolveRef.current?.(false) }, [])
  return <Context.Provider value={confirm}>{children}
    {request && <dialog ref={dialog} className="app-confirm-dialog" data-interactive aria-labelledby={titleId} aria-describedby={messageId}
      onCancel={event => { event.preventDefault(); finish(false) }} onKeyDown={event => event.stopPropagation()}>
      <h2 id={titleId}>{request.title}</h2><p id={messageId}>{request.message}</p>
      {request.checkbox && <label className="app-confirm-checkbox"><input type="checkbox" checked={checked} onChange={event => { setChecked(event.target.checked); request.checkbox?.onChange(event.target.checked) }} /><span>{request.checkbox.label}</span></label>}
      <div className="app-dialog-actions"><button type="button" className="app-button" autoFocus onClick={() => finish(false)}>取消</button><button type="button" className="app-button app-button-danger" onClick={() => finish(true)}>{request.confirmLabel ?? '删除'}</button></div>
    </dialog>}
  </Context.Provider>
}
