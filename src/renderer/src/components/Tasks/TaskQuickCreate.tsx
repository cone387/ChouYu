import { useState } from 'react'
import TaskIcon from './TaskIcon'

export default function TaskQuickCreate({ label = '新建任务', onCreate, onDetails }: {
  label?: string
  onCreate: (title: string) => Promise<void>
  onDetails: (title: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!open) return <button type="button" className="tasks-board-add" onClick={() => { setOpen(true); setError('') }}><TaskIcon name="plus" />{label}</button>
  return <form className="tasks-quick-create" aria-label="快速新建任务" onSubmit={event => {
    event.preventDefault()
    if (!title.trim() || busy) return
    setBusy(true); setError('')
    void onCreate(title.trim()).then(() => { setTitle(''); setOpen(false) }).catch(reason => setError(String(reason))).finally(() => setBusy(false))
  }}>
    <input autoFocus aria-label="快速任务标题" placeholder="输入标题，回车创建" value={title} disabled={busy} onChange={event => setTitle(event.target.value)} onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.preventDefault(); event.stopPropagation(); setOpen(false); setTitle('') } }} />
    {error && <p role="alert" className="tasks-error">{error}</p>}
    <div><button type="button" disabled={busy} onClick={() => { onDetails(title); setOpen(false); setTitle('') }}>详细设置</button><span /><button type="button" disabled={busy} onClick={() => { setOpen(false); setTitle('') }}>取消</button><button type="submit" disabled={busy || !title.trim()}>{busy ? '创建中…' : '创建'}</button></div>
  </form>
}
