import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { DeliveryRef } from '../../../../shared/contact-content'
import type { HandoffPreparation } from '../../../../shared/contact-handoffs'
import { ASSISTANT_CHARACTER_ID } from '../../../../shared/characters'
import ContactTaskDescription from './ContactTaskDescription'
import { navigateContact } from './contactNavigation'
export default function ContactHandoffDialog({ source, title, onClose, onSaved }: { source: DeliveryRef; title: string; onClose(): void; onSaved(): void }) {
  const key = `contact-handoff:${source.characterId}:${source.topicId}:${source.version}:${source.sectionId || ''}`
  const [initial] = useState(() => { try { return JSON.parse(sessionStorage.getItem(key) || '{}') as { recipient?: string; description?: string; requestId?: string; question?: string } } catch { return {} } })
  const dialog = useRef<HTMLDialogElement>(null), alive = useRef(true), pending = useRef(false), requestId = useRef(initial.requestId || crypto.randomUUID()), label = useId()
  const [characters, setCharacters] = useState<{ id: string; name: string }[]>([]), [recipient, setRecipient] = useState(initial.recipient || ''), [description, setDescription] = useState(initial.description || ''), [question, setQuestion] = useState(initial.question || ''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const prepared = useRef<HandoffPreparation | null>(null)
  useEffect(() => { alive.current = true; const previous = document.activeElement as HTMLElement | null; dialog.current?.showModal(); void window.electronAPI.characters.list().then(items => { if (alive.current) setCharacters(items.filter(c => c.id !== source.characterId && c.id !== ASSISTANT_CHARACTER_ID)) }).catch(() => { if (alive.current) setError('无法读取联系人。') }); return () => { alive.current = false; if (previous?.isConnected) previous.focus() } }, [])
  useEffect(() => { sessionStorage.setItem(key, JSON.stringify({ recipient, description, requestId: requestId.current, question })) }, [key, recipient, description, question])
  const edit = () => { if (prepared.current) { prepared.current = null; requestId.current = crypto.randomUUID() } }
  const submit = async () => {
    if (pending.current || !recipient || !description.trim()) return
    pending.current = true; setBusy(true); setError('')
    try {
      const preparation = prepared.current ?? await window.electronAPI.agents.prepareHandoff(source.characterId, { requestId: requestId.current, source, recipientId: recipient, description })
      if (!alive.current) return
      if (preparation.kind === 'question') { setQuestion(preparation.question); setDescription(''); return }
      prepared.current = preparation
      await window.electronAPI.agents.commitHandoff(source.characterId, preparation)
      if (alive.current) { sessionStorage.removeItem(key); onSaved(); onClose() }
    } catch (reason) { if (alive.current) setError(String(reason).replace(/^Error: Error invoking remote method '[^']+': (?:Error: )?/, '')) }
    finally { pending.current = false; if (alive.current) setBusy(false) }
  }
  const settings = async (characterId: string) => { try { await navigateContact({ kind: 'contact-settings', characterId, tab: 'settings' }); onClose() } catch (e) { setError(String(e)) } }
  return createPortal(<dialog ref={dialog} className="contact-task-dialog" data-contact-handoff-dialog data-contact-owner={source.characterId} data-source-ref={JSON.stringify(source)} data-interactive data-interactive-bounds aria-labelledby={label} onCancel={e => { e.preventDefault(); e.stopPropagation(); if (!pending.current) onClose() }} onKeyDown={e => { if (e.key === 'Escape') e.stopPropagation() }}>
    <form onSubmit={e => { e.preventDefault(); void submit() }} aria-busy={busy}>
      <h3 id={label}>交给联系人评审</h3><p>{title} · 第 {source.version} 版{source.sectionId ? ' · 当前分节' : ''}</p>
      <label htmlFor={`${label}-recipient`}>接收者</label><select id={`${label}-recipient`} data-handoff-recipient required value={recipient} disabled={busy} onChange={e => { edit(); requestId.current = crypto.randomUUID(); setQuestion(''); setRecipient(e.target.value) }}><option value="">选择一位联系人</option>{characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      {question && <p role="status">{question}</p>}
      <ContactTaskDescription id={`${label}-description`} question={question} value={description} disabled={busy} onChange={value => { edit(); setDescription(value) }} />
      <p className="agent-caption">默认只评审这个版本。需要持续跟进新版本时，在描述中说明。不会替你批准意见或修改原作者的正文。</p>
      {error && <><p role="alert" className="agent-error">{error}</p><div className="agent-actions"><button type="button" onClick={() => void settings(source.characterId)}>作者共享设置</button>{recipient && <button type="button" onClick={() => void settings(recipient)}>接收者读取设置</button>}</div><p className="agent-caption">草稿已保留，设置后回到此版本继续交接。</p></>}
      <footer><button type="button" disabled={busy} onClick={onClose}>取消</button><button type="submit" data-handoff-save className="primary" disabled={busy || !recipient || !description.trim()}>{busy ? '交接中…' : '保存并交接'}</button></footer>
    </form>
  </dialog>, document.body)
}
