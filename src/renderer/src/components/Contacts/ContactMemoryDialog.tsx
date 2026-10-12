import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AgentOverview } from '../../../../shared/agents'

export default function ContactMemoryDialog({ characterId, name, onSaved, onClose }: {
  characterId: string
  name: string
  onSaved: (overview: AgentOverview) => void
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const alive = useRef(true), pending = useRef(false)
  const title = useId()
  const [content, setContent] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    alive.current = true
    const previous = document.activeElement as HTMLElement | null, element = dialog.current
    element?.showModal()
    return () => {
      alive.current = false
      element?.close()
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [])
  const close = () => { if (!pending.current) onClose() }
  const save = async () => {
    if (pending.current || !content.trim()) return
    pending.current = true; setBusy(true); setError('')
    try {
      const result = await window.electronAPI.agents.remember(characterId, content.trim())
      if (alive.current) { onSaved(result); onClose() }
    } catch (reason) {
      if (alive.current) setError(reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '保存失败，请重试。')
    } finally {
      pending.current = false
      if (alive.current) setBusy(false)
    }
  }
  return createPortal(<dialog ref={dialog} className="contact-task-dialog" data-contact-memory-dialog data-interactive data-interactive-bounds aria-labelledby={title}
    onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation() }}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); close() }}>
    <form onSubmit={event => { event.preventDefault(); void save() }} aria-busy={busy}>
      <h3 id={title}>新增独立记忆</h3>
      <label htmlFor={`${title}-content`}>记忆内容</label>
      <textarea id={`${title}-content`} data-contact-memory-input autoFocus rows={4} maxLength={2000} required value={content} disabled={busy}
        onChange={event => setContent(event.target.value)} placeholder="告诉我一件需要记住的事……" />
      <p className="agent-caption">仅供{name}使用，其他联系人不会读取这条记忆。</p>
      {error && <p className="agent-error" role="alert">{error}</p>}
      <footer>
        <button type="button" disabled={busy} onClick={close}>取消</button>
        <button type="submit" className="primary" data-contact-memory-save disabled={busy || !content.trim()}>{busy ? '保存中…' : '保存'}</button>
      </footer>
    </form>
  </dialog>, document.body)
}
