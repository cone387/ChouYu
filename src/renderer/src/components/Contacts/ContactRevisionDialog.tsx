import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AgentTopic } from '../../../../shared/agents'
import { deliveryText, type ContentCitation } from '../../../../shared/contact-content'
import type { AgentDelivery } from '../../../../shared/agent-delivery'

export default function ContactRevisionDialog({ characterId, topic, citation, scope = 'content', onClose, onSaved }: {
  characterId: string; topic: AgentTopic; citation: ContentCitation; scope?: 'content' | 'presentation'; onClose: () => void; onSaved: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null), alive = useRef(true), pending = useRef(false), title = useId()
  const [feedback, setFeedback] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [basis, setBasis] = useState(citation), [revision, setRevision] = useState(topic.revision)
  const [latest, setLatest] = useState<AgentDelivery | null>(null)
  useEffect(() => { alive.current = true; const previous = document.activeElement as HTMLElement, el = dialog.current; el?.showModal(); return () => { alive.current = false; el?.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }) } }, [])
  const submit = async () => {
    if (pending.current || !feedback.trim()) return
    pending.current = true; setBusy(true); setError('')
    try {
      if (scope === 'presentation') await window.electronAPI.agents.reviseTopic(characterId, topic.id, revision, feedback, undefined, 'presentation', basis.ref.version)
      else await window.electronAPI.agents.reviseCitation(characterId, revision, basis, feedback)
      if (alive.current) { onSaved(); onClose() }
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : String(e))
      try { const artifact = await window.electronAPI.agents.delivery(characterId, topic.id); if (alive.current && artifact && artifact.version !== basis.ref.version) setLatest(artifact) } catch { /* Original failure remains visible and draft stays intact. */ }
    } finally { pending.current = false; if (alive.current) setBusy(false) }
  }
  return createPortal(<dialog className="contact-task-dialog" data-contact-revision-dialog data-interactive data-interactive-bounds ref={dialog} aria-labelledby={title}
    onKeyDown={e => { if (e.key === 'Escape') e.stopPropagation() }} onCancel={e => { e.preventDefault(); e.stopPropagation(); if (!pending.current) onClose() }}>
    <form onSubmit={e => { e.preventDefault(); void submit() }} aria-busy={busy}>
      <h3 id={title}>{scope === 'presentation' ? '修改阅读样式' : '提出修改意见'}</h3>
      <p>{topic.title} · 版本 {basis.ref.version}</p>
      {basis.anchor && <blockquote className="citation-quote">{basis.anchor.quote}</blockquote>}
      <label htmlFor={`${title}-feedback`}>修改意见</label>
      <textarea id={`${title}-feedback`} data-delivery-feedback autoFocus rows={4} maxLength={2000} required disabled={busy} value={feedback} onChange={e => setFeedback(e.target.value)} placeholder={scope === 'presentation' ? '描述希望调整的阅读样式，正文与进度保持不变。' : '例如：保留引用的这一段，调整后面的对话。'} />
      <p className="agent-caption">按所选版本修订一轮，保留旧版本，并沿用任务的额度与权限。</p>
      {error && <p role="alert">{error}</p>}
      {latest && <details open><summary>已有版本 {latest.version}，请先核对变化</summary>
        {basis.anchor && <><strong>原引用</strong><blockquote className="citation-quote">{basis.anchor.quote}</blockquote></>}
        <strong>新版对应分节</strong><p className="citation-quote">{deliveryText(latest.sections.find(s => s.id === basis.ref.sectionId)?.body ?? '原分节已移除。').slice(0, 2000)}</p>
        <button type="button" disabled={busy || Boolean(basis.ref.sectionId && !latest.sections.some(s => s.id === basis.ref.sectionId))} onClick={async () => {
          try { const work = await window.electronAPI.agents.get(characterId), current = work.topics.find(t => t.id === topic.id); if (!current) throw new Error('任务已删除。'); if (alive.current) { setRevision(current.revision); setBasis({ ref: { ...basis.ref, version: latest.version } }); setLatest(null); setError('已改为基于新版分节；意见仍保留，请核对后提交。') } }
          catch (e) { if (alive.current) setError(String(e)) }
        }}>改为基于此新版分节</button></details>}
      <footer><button type="button" disabled={busy} onClick={onClose}>取消</button><button type="submit" data-delivery-submit className="primary" disabled={busy || !feedback.trim()}>{busy ? '提交中…' : '提交并修订'}</button></footer>
    </form>
  </dialog>, document.body)
}
