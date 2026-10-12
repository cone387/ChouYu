import { useEffect, useState } from 'react'
import type { MaterialSummary } from '../../../../shared/contact-materials'
import ContactMaterialDialog from './ContactMaterialDialog'
import ContactMaterialReader from './ContactMaterialReader'
export default function ContactMaterials({ owner, topics }: { owner: string; topics: { id: string; title: string }[] }) {
  const [items, setItems] = useState<MaterialSummary[]>([]), [topicId, setTopicId] = useState(''), [edit, setEdit] = useState<MaterialSummary | 'new' | null>(null), [reader, setReader] = useState<MaterialSummary | null>(null), [history, setHistory] = useState<Record<string, MaterialSummary[]>>({}), [error, setError] = useState(''), [refresh, setRefresh] = useState(0), [busy, setBusy] = useState(false)
  useEffect(() => { let alive = true; window.electronAPI.agents.materialList(owner, { query: '', topicId: topicId || undefined }).then(values => { if (alive) setItems(values) }).catch(() => { if (alive) setError('无法读取资料空间。') }); const off = window.electronAPI.agents.onChanged(id => { if (id === owner) setRefresh(n => n + 1) }); return () => { alive = false; off() } }, [owner, topicId, refresh])
  return <div className="contact-materials">
    <p className="agent-description">保存供此联系人反复参考的资料。资料更新保留旧版，读取时按当前任务范围提供。</p>
    <div className="agent-actions"><button type="button" data-material-new onClick={() => setEdit('new')}>添加资料</button><select aria-label="资料范围" value={topicId} onChange={e => setTopicId(e.target.value)}><option value="">联系人通用资料</option>{topics.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</select></div>
    {error && <p role="alert" className="agent-error">{error}</p>}
    {!items.length && <p className="agent-empty">此范围还没有资料。添加项目背景、参考文章或写作要求，之后可按版本回看。</p>}
    <ul className="agent-memories">{items.map(m => <li key={m.id} data-material-id={m.id}><h4>{m.name}</h4><p className="agent-caption">第 {m.version} 版 · {m.source.label} · {m.scope.kind === 'contact' ? '联系人通用' : topics.find(t => m.scope.kind === 'task' && t.id === m.scope.topicId)?.title || '指定任务'}</p>
      <div className="agent-memory-footer"><button type="button" data-material-read onClick={() => setReader(m)}>阅读</button><button type="button" data-material-edit onClick={() => setEdit(m)}>更新</button><button type="button" disabled={busy} onClick={async () => { setBusy(true); try { const values = await window.electronAPI.agents.materialHistory(owner, m.id); setHistory(h => ({ ...h, [m.id]: values })) } catch (reason) { setError(String(reason)) } finally { setBusy(false) } }}>版本与来源</button><button type="button" data-material-withdraw disabled={busy} onClick={async () => { setBusy(true); try { await window.electronAPI.agents.withdrawMaterial(owner, m.id, m.version); setRefresh(n => n + 1) } catch (reason) { setError(String(reason)) } finally { setBusy(false) } }}>撤回</button></div>
      {history[m.id]?.map(v => <p key={v.version}><button type="button" onClick={() => setReader(v)}>第 {v.version} 版</button> · {v.source.label} · {new Date(v.createdAt).toLocaleString()}</p>)}
    </li>)}</ul>
    {edit && <ContactMaterialDialog owner={owner} topics={topics} initialTopicId={topicId || undefined} material={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} onSaved={() => setRefresh(n => n + 1)} />}
    {reader && <ContactMaterialReader key={`${reader.id}:${reader.version}`} owner={owner} reference={reader} topicId={reader.scope.kind === 'task' ? reader.scope.topicId : undefined} onClose={() => setReader(null)} />}
  </div>
}
