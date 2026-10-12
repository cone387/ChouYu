import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { MaterialImport, MaterialSummary } from '../../../../shared/contact-materials'
export default function ContactMaterialDialog({ owner, topics, material, attachment, initialTopicId, onClose, onSaved }: { owner: string; topics: { id: string; title: string }[]; material?: MaterialSummary; initialTopicId?: string; attachment?: { name: string; data: string }; onClose(): void; onSaved(): void }) {
  const dialog = useRef<HTMLDialogElement>(null), alive = useRef(true), pending = useRef(false), requestId = useRef(crypto.randomUUID())
  const label = useId(), [name, setName] = useState(material?.name || attachment?.name || ''), [content, setContent] = useState(attachment?.data || ''), [kind, setKind] = useState<MaterialImport['source']['kind']>(attachment ? 'attachment' : 'text')
  const [scope, setScope] = useState(material?.scope || (initialTopicId ? { kind: 'task' as const, topicId: initialTopicId } : { kind: 'contact' as const })), [url, setUrl] = useState(material?.source.url || ''), [busy, setBusy] = useState(Boolean(material)), [error, setError] = useState('')
  useEffect(() => { alive.current = true; const previous = document.activeElement as HTMLElement | null; dialog.current?.showModal(); return () => { alive.current = false; if (pending.current) void window.electronAPI.agents.cancelMaterialImport(owner, requestId.current); if (previous?.isConnected) previous.focus() } }, [owner])
  useEffect(() => {
    if (!material) return
    void (async () => {
      try {
        let body = '', offset: number | undefined = 0
        while (alive.current && offset !== undefined) { const part = await window.electronAPI.agents.readMaterial(owner, { query: '', topicId: material.scope.kind === 'task' ? material.scope.topicId : undefined }, material, offset); body += part.text; offset = part.nextOffset }
        if (alive.current) setContent(body)
      } catch { if (alive.current) setError('无法读取旧版正文，请稍后重新打开。') }
      finally { if (alive.current) setBusy(false) }
    })()
  }, [])
  const close = () => { if (pending.current) void window.electronAPI.agents.cancelMaterialImport(owner, requestId.current); onClose() }
  const save = async () => {
    if (pending.current) return
    pending.current = true; setBusy(true); setError('')
    try {
      const saved = await window.electronAPI.agents.importMaterial(owner, { requestId: requestId.current, name, scope, content, source: { kind, label: kind === 'attachment' ? attachment!.name : kind === 'web' ? url : '手动输入', ...(kind === 'web' ? { url } : {}) }, id: material?.id, expectedVersion: material?.version })
      if (alive.current && saved) { onSaved(); onClose() }
    } catch (reason) { if (alive.current) setError(String(reason).replace(/^Error: Error invoking remote method '[^']+': (?:Error: )?/, '')) }
    finally { pending.current = false; if (alive.current) setBusy(false) }
  }
  return createPortal(<dialog ref={dialog} className="contact-task-dialog" data-contact-material-dialog data-interactive data-interactive-bounds aria-labelledby={label} onCancel={e => { e.preventDefault(); e.stopPropagation(); close() }} onKeyDown={e => { if (e.key === 'Escape') e.stopPropagation() }}>
    <form onSubmit={e => { e.preventDefault(); void save() }} aria-busy={busy}>
      <h3 id={label}>{material ? '更新资料' : '添加资料'}</h3>
      <label htmlFor={`${label}-name`}>名称</label><input id={`${label}-name`} data-material-name autoFocus required maxLength={200} value={name} disabled={busy} onChange={e => setName(e.target.value)} />
      <label htmlFor={`${label}-kind`}>内容来源</label><select id={`${label}-kind`} value={kind} disabled={busy || Boolean(attachment)} onChange={e => setKind(e.target.value as typeof kind)}>{attachment ? <option value="attachment">当前文本附件</option> : <><option value="text">粘贴文本或 Markdown</option><option value="file">选择文本文件</option><option value="web">读取网页</option></>}</select>
      {(kind === 'text' || kind === 'attachment') && <><label htmlFor={`${label}-body`}>正文</label><textarea id={`${label}-body`} data-material-content required rows={7} value={content} disabled={busy} onChange={e => setContent(e.target.value)} /></>}
      {kind === 'file' && <p className="agent-caption">保存时选择一份 .txt、.md 或 .markdown 文件，最多 2 MB。</p>}
      {kind === 'web' && <><label htmlFor={`${label}-url`}>网页地址</label><input id={`${label}-url`} type="url" required value={url} disabled={busy} onChange={e => setUrl(e.target.value)} /><p className="agent-caption">沿用当前网页读取权限，保存本次实际读到的正文。</p></>}
      <label htmlFor={`${label}-scope`}>适用范围</label><select id={`${label}-scope`} value={JSON.stringify(scope)} disabled={busy} onChange={e => setScope(JSON.parse(e.target.value))}><option value={JSON.stringify({ kind: 'contact' })}>此联系人的所有任务与对话</option>{topics.map(t => <option key={t.id} value={JSON.stringify({ kind: 'task', topicId: t.id })}>任务：{t.title}</option>)}</select>
      {material && <p className="agent-caption">基于第 {material.version} 版更新，旧版保留。文本更新请填写完整的新正文。</p>}
      {error && <p className="agent-error" role="alert">{error}</p>}
      <footer><button type="button" onClick={close}>取消</button><button type="submit" data-material-save className="primary" disabled={busy || !name.trim()}>{busy ? '读取并保存中…' : '保存'}</button></footer>
    </form>
  </dialog>, document.body)
}
