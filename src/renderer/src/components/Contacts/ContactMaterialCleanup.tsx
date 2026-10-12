import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { MaterialSummary } from '../../../../shared/contact-materials'
export default function ContactMaterialCleanup({ owner }: { owner: string }) {
  const [items, setItems] = useState<MaterialSummary[]>([]), [selected, setSelected] = useState<MaterialSummary | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null), alive = useRef(true), pending = useRef(false)
  useEffect(() => {
    alive.current = true; let epoch = 0
    const refresh = async () => { const request = ++epoch; try { const values = await window.electronAPI.agents.materialInventory(owner); if (alive.current && request === epoch) setItems(values.filter(m => m.status !== 'ready')) } catch { if (alive.current && request === epoch) setError('无法读取已撤回资料。') } }
    void refresh(); const off = window.electronAPI.agents.onChanged(id => { if (id === owner) void refresh() })
    return () => { alive.current = false; off() }
  }, [owner])
  useEffect(() => { if (selected) dialog.current?.showModal() }, [selected])
  return <details className="contact-material-cleanup"><summary>资料整理 · 已撤回与已移除</summary>
    {!items.length && <p>没有已撤回资料。</p>}
    {error && !selected && <p role="alert">{error}</p>}
    {items.map(m => <p key={m.id}>{m.name} · {m.status === 'removed' ? '正文已移除，来源记录保留' : '已撤回'}{m.status === 'withdrawn' && <button type="button" data-material-cleanup={m.id} onClick={() => { setError(''); setSelected(m) }}>清理正文</button>}</p>)}
    {selected && createPortal(<dialog ref={dialog} className="contact-task-dialog" data-material-cleanup-dialog data-interactive data-interactive-bounds aria-label="清理已撤回资料" onCancel={e => { e.preventDefault(); e.stopPropagation(); if (!pending.current) setSelected(null) }} onKeyDown={e => { if (e.key === 'Escape') e.stopPropagation() }}>
      <h3>清理已撤回资料</h3><p>永久移除“{selected.name}”所有版本的正文以释放资料容量。名称、版本和来源记录会保留，旧引用将显示“正文已移除”。此操作不能撤销。</p>
      {error && <p role="alert">{error}</p>}
      <footer><button type="button" disabled={busy} onClick={() => setSelected(null)}>取消</button><button type="button" data-material-purge disabled={busy} onClick={async () => {
        if (pending.current) return
        pending.current = true; setBusy(true); setError('')
        try { await window.electronAPI.agents.purgeMaterial(owner, selected.id, selected.version); if (alive.current) setSelected(null) }
        catch (reason) { if (alive.current) setError(String(reason)) }
        finally { pending.current = false; if (alive.current) setBusy(false) }
      }}>确认清理正文</button></footer>
    </dialog>, document.body)}
  </details>
}
