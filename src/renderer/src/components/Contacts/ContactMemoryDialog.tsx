import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AgentOverview } from '../../../../shared/agents'
import { MEMORY_KIND_LABELS, type ContactMemory, type MemoryKind } from '../../../../shared/contact-memories'
import type { ContactScope } from '../../../../shared/contact-content'

export default function ContactMemoryDialog({ characterId, name, memory, topics, onSaved, onClose }: {
  characterId: string
  name: string
  memory?: ContactMemory
  topics: { id: string; title: string }[]
  onSaved: (overview: AgentOverview) => void
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const alive = useRef(true), pending = useRef(false)
  const title = useId()
  const [content, setContent] = useState(memory?.content || '')
  const [kind, setKind] = useState<MemoryKind>(memory?.kind || 'preference')
  const [scope, setScope] = useState<ContactScope>(memory?.scope || { kind: 'contact' })
  const [sessions, setSessions] = useState<{ id: string; title: string }[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    alive.current = true
    const previous = document.activeElement as HTMLElement | null, element = dialog.current
    element?.showModal()
    void window.electronAPI.db.getSessionWorkspace().then(workspace => {
      if (alive.current) setSessions(workspace.sessions.filter(s => s.characterId === characterId))
    }).catch(() => { if (alive.current) setError('无法读取会话范围，请稍后重试。') })
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
      const input = { content: content.trim(), kind, scope, source: { kind: 'user' as const, at: Date.now() } }
      if (memory) await window.electronAPI.agents.updateMemory(characterId, memory.id, memory.revision, input)
      else await window.electronAPI.agents.createMemory(characterId, input)
      const result = await window.electronAPI.agents.get(characterId)
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
      <h3 id={title}>{memory ? memory.status === 'candidate' ? '确认记忆' : '纠正记忆' : '新增独立记忆'}</h3>
      <label htmlFor={`${title}-content`}>记忆内容</label>
      <textarea id={`${title}-content`} data-contact-memory-input autoFocus rows={4} maxLength={2000} required value={content} disabled={busy}
        onChange={event => setContent(event.target.value)} placeholder="告诉我一件需要记住的事……" />
      <p className="agent-caption">仅供{name}使用，其他联系人不会读取这条记忆。</p>
      <label htmlFor={`${title}-kind`}>类型</label>
      <select id={`${title}-kind`} value={kind} disabled={busy} onChange={e => setKind(e.target.value as MemoryKind)}>{Object.entries(MEMORY_KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <label htmlFor={`${title}-scope`}>适用范围</label>
      <select id={`${title}-scope`} value={JSON.stringify(scope)} disabled={busy} onChange={e => setScope(JSON.parse(e.target.value))}>
        <option value={JSON.stringify({ kind: 'contact' })}>此联系人的所有工作与对话</option>
        {topics.map(t => <option key={t.id} value={JSON.stringify({ kind: 'task', topicId: t.id })}>任务：{t.title}</option>)}
        {sessions.map(s => <option key={s.id} value={JSON.stringify({ kind: 'session', sessionId: s.id })}>会话：{s.title}</option>)}
      </select>
      <p className="agent-caption">{memory ? `基于第 ${memory.revision} 版修正，旧版本保留在历史中。` : '来源：你在此处明确告诉我的。'}保存后由你确认生效。</p>
      {error && <p className="agent-error" role="alert">{error}</p>}
      <footer>
        <button type="button" disabled={busy} onClick={close}>取消</button>
        <button type="submit" className="primary" data-contact-memory-save disabled={busy || !content.trim()}>{busy ? '保存中…' : '保存'}</button>
      </footer>
    </form>
  </dialog>, document.body)
}
