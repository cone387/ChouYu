import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { outputKinds, type ContactOutputPreference, type ContactOutputPreferenceRecord, type ContactOutputScope } from '../../../../shared/contact-output'

export default function ContactOutputDialog({ characterId, topicId, version, onClose }: { characterId: string; topicId?: string; version?: number; onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null), pending = useRef(false), title = useId()
  const [range, setRange] = useState<ContactOutputScope['kind']>(version ? 'delivery' : topicId ? 'task' : 'contact')
  const [saved, setSaved] = useState<ContactOutputPreferenceRecord>(), [draft, setDraft] = useState<ContactOutputPreference>({})
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const scope: ContactOutputScope = range === 'contact' ? { kind: range } : range === 'task' ? { kind: range, topicId: topicId! } : { kind: range, topicId: topicId!, version: version! }
  useEffect(() => { const previous = document.activeElement as HTMLElement, el = dialog.current; el?.showModal(); return () => { el?.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }) } }, [])
  useEffect(() => {
    let current = true; setSaved(undefined); setError('')
    void window.electronAPI.agents.outputPreferences(characterId, range === 'contact' ? undefined : topicId, range === 'delivery' ? version : undefined).then(records => {
      if (!current) return
      const record = records.find(record => record.scope.kind === range)
      if (!record) throw new Error('没有读取到阅读偏好。')
      setSaved(record); setDraft(record.preference)
    }).catch(e => { if (current) setError(String(e)) })
    return () => { current = false }
  }, [characterId, topicId, version, range])
  const submit = async () => {
    if (!saved || pending.current) return
    pending.current = true; setBusy(true); setError('')
    try { await window.electronAPI.agents.setOutputPreference(characterId, scope, saved.revision, draft); onClose() }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { pending.current = false; setBusy(false) }
  }
  const labels = { writing: '正文阅读', ideas: '想法', review: '评审', research: '调研', plan: '行动计划', briefing: '简报', plain: '普通正文' }
  return createPortal(<dialog ref={dialog} className="contact-task-dialog" data-contact-output-dialog data-interactive data-interactive-bounds aria-labelledby={title} onKeyDown={e => { if (e.key === 'Escape') e.stopPropagation() }} onCancel={e => { e.preventDefault(); e.stopPropagation(); if (!pending.current) onClose() }}>
    <form onSubmit={e => { e.preventDefault(); void submit() }} aria-busy={busy}>
      <h3 id={title}>阅读偏好</h3>
      <label>生效范围<select value={range} disabled={busy} onChange={e => setRange(e.target.value as ContactOutputScope['kind'])}><option value="contact">这个联系人的全部成果</option>{topicId && <option value="task">这项任务的成果</option>}{version && <option value="delivery">仅此成果版本 {version}</option>}</select></label>
      {!saved && !error && <p role="status">正在读取…</p>}
      {saved && <>
        <label>阅读样式<select value={draft.kind ?? ''} disabled={busy} onChange={e => setDraft(value => ({ ...value, kind: e.target.value as ContactOutputPreference['kind'] }))}><option value="" disabled>沿用已有设置</option><option value="auto">自动选择</option>{outputKinds.map(kind => <option key={kind} value={kind}>{labels[kind]}</option>)}</select></label>
        <label>行文间距<select value={draft.density ?? ''} disabled={busy} onChange={e => setDraft(value => ({ ...value, density: e.target.value as ContactOutputPreference['density'] }))}><option value="" disabled>沿用已有设置</option><option value="comfortable">舒适</option><option value="compact">紧凑</option></select></label>
        {range !== 'delivery' && <label>后续表达要求<textarea rows={3} maxLength={2000} disabled={busy} value={draft.instruction ?? ''} onChange={e => setDraft(value => ({ ...value, instruction: e.target.value }))} placeholder="例如：评审先给结论，保留关键依据。" /></label>}
        <p className="agent-caption">已有正文保持完整。长期表达要求用于后续生成；任务目标、状态和权限保持原设置。</p>
      </>}
      {error && <p role="alert">{error}</p>}
      <footer><button type="button" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="primary" disabled={busy || !saved}>{busy ? '保存中…' : '保存'}</button></footer>
    </form>
  </dialog>, document.body)
}
