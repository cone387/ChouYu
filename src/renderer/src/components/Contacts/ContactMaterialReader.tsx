import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { MaterialReadRef, MaterialRef } from '../../../../shared/contact-materials'
import ContactMarkdown from './ContactMarkdown'
export default function ContactMaterialReader({ owner, reference, topicId, onClose }: { owner: string; reference: MaterialRef | MaterialReadRef; topicId?: string; onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null), label = useId(), [text, setText] = useState(''), [next, setNext] = useState<number>(), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const alive = useRef(true)
  const read = async (offset = 0) => {
    setBusy(true); setError('')
    try { const result = await window.electronAPI.agents.readMaterial(owner, { query: '', topicId }, reference, offset); if (alive.current) { setText(previous => offset ? previous + result.text : result.text); setNext(result.nextOffset) } }
    catch { if (alive.current) { setText(''); setError('此版本已撤回、范围不匹配或暂时无法读取。') } }
    finally { if (alive.current) setBusy(false) }
  }
  useEffect(() => { alive.current = true; const previous = document.activeElement as HTMLElement | null; dialog.current?.showModal(); void read(); return () => { alive.current = false; if (previous?.isConnected) previous.focus() } }, [])
  return createPortal(<dialog ref={dialog} className="contact-task-dialog" data-material-reader data-interactive data-interactive-bounds aria-labelledby={label} onCancel={e => { e.preventDefault(); e.stopPropagation(); onClose() }} onKeyDown={e => { if (e.key === 'Escape') e.stopPropagation() }}>
    <h3 id={label}>资料 · 第 {reference.version} 版</h3>
    {'start' in reference && <p className="agent-caption">当时读取位置：{reference.start + 1}–{reference.end} 字符</p>}
    {error && <p role="alert">{error}</p>}
    <div style={{ maxHeight: '55vh', overflow: 'auto', overflowWrap: 'anywhere' }}><ContactMarkdown>{text}</ContactMarkdown></div>
    <footer>{next !== undefined && <button type="button" disabled={busy} onClick={() => void read(next)}>继续读取</button>}<button type="button" onClick={onClose}>关闭</button></footer>
  </dialog>, document.body)
}
