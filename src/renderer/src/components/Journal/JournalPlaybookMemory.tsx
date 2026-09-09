import { useRef, useState } from 'react'
import type { JournalPlaybookEntry, JournalPlaybookMemoryPlan } from '../../../../shared/journal-playbook'

export function JournalPlaybookMemory({ entry }: { entry: JournalPlaybookEntry }) {
  const [open, setOpen] = useState(false), [content, setContent] = useState(''), [sensitive, setSensitive] = useState(false)
  const [plan, setPlan] = useState<JournalPlaybookMemoryPlan | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('')
  const running = useRef(false)
  const execute = async (action: () => Promise<void>) => {
    if (running.current) return
    running.current = true; setBusy(true); setError(''); setMessage('')
    try { await action() } catch (reason) { setError(String(reason)); setPlan(null) }
    finally { running.current = false; setBusy(false) }
  }
  return <div className="journal-playbook-memory">
    <button disabled={busy || entry.status !== 'resolved'} onClick={() => { setOpen(true); setPlan(null); setContent(`经验：${entry.title}\n问题：${entry.problem}\n解决办法：${entry.resolution}`); setError(''); setMessage('') }}>整理为长期记忆</button>
    {entry.status !== 'resolved' && <p>核对解决办法并标记已解决后，可整理为长期记忆。</p>}
    {open && <div className="journal-edit-form" aria-label="手册记忆确认">
      <h4>留下可复用的经验</h4>
      {!plan ? <><label>记忆摘要<textarea aria-label="手册记忆摘要" disabled={busy} value={content} onChange={event => setContent(event.target.value)} /></label><p>{content.length} / 500 字。请手动精简，保留适用条件和解决办法。</p><label><input type="checkbox" disabled={busy} checked={sensitive} onChange={event => setSensitive(event.target.checked)} />标记为敏感记忆</label><button disabled={busy || !content.trim() || content.length > 500} onClick={() => void execute(async () => setPlan(await window.electronAPI.journal.preparePlaybookMemory({ id: entry.id, revision: entry.revision, content, sensitive })))}>预览保存位置</button></>
        : <><p>保存位置：{plan.destination}</p><p>{plan.indexing}</p><p>类型：工作流程 · {plan.sensitive ? '敏感' : '普通'}。只写入以下摘要及手册标识，来源截图和完整正文不会随之上传。存在冲突时会进入待处理列表。</p><pre className="journal-playbook-preview">{plan.content}</pre><button disabled={busy} onClick={() => void execute(async () => {
          const result = await window.electronAPI.journal.confirmPlaybookMemory(plan.token)
          setPlan(null); setOpen(false)
          setMessage(result.status === 'pending' ? '已进入记忆待处理列表，请在设置 → 记忆 → 待处理核对冲突。' : result.status === 'archived' ? '返回的记忆已归档，请到记忆库核对状态。' : '记忆已保存，可在记忆库查看；相同内容可能复用已有记录。')
        })}>确认写入长期记忆</button><button disabled={busy} onClick={() => setPlan(null)}>返回修改摘要</button></>}
      <button disabled={busy} onClick={() => { setOpen(false); setPlan(null); setError('') }}>取消写入</button>
      {busy && <p role="status">正在处理，请等待结果…</p>}
    </div>}
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error} 尚未确认保存成功，请到记忆库核对后再决定是否重试。</p>}
  </div>
}
