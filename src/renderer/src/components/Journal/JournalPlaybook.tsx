import { useEffect, useRef, useState } from 'react'
import type { JournalSavedItem } from '../../../../shared/journal'
import type { JournalProject } from '../../../../shared/journal-projects'
import { playbookMarkdown, type JournalPlaybookEntry, type JournalPlaybookInput } from '../../../../shared/journal-playbook'
import { SavedSource } from './JournalSaved'
import { JournalPlaybookMemory } from './JournalPlaybookMemory'

const blank = (): JournalPlaybookInput => ({ title: '', problem: '', attempts: '', resolution: '', status: 'open', projectId: null, sourceIds: [] })
export function JournalPlaybook() {
  const [entries, setEntries] = useState<JournalPlaybookEntry[]>([]), [sources, setSources] = useState<JournalSavedItem[]>([]), [projects, setProjects] = useState<JournalProject[]>([])
  const [draft, setDraft] = useState<JournalPlaybookInput | null>(null), [filter, setFilter] = useState('all'), [query, setQuery] = useState(''), [sourceQuery, setSourceQuery] = useState(''), [sourcePage, setSourcePage] = useState(0)
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState(''), [deleting, setDeleting] = useState(''), [expanded, setExpanded] = useState(''), [preview, setPreview] = useState(''), [page, setPage] = useState(0)
  const alive = useRef(true), request = useRef(0)
  const reload = async () => {
    const id = ++request.current
    const [next, saved, state] = await Promise.all([window.electronAPI.journal.playbook(), window.electronAPI.journal.savedItems(), window.electronAPI.journal.projects()])
    if (alive.current && request.current === id) { setEntries(next); setSources(saved); setProjects(state.projects); setFilter(value => value === 'all' || value === 'none' || state.projects.some(project => project.id === value) ? value : 'all'); setLoading(false) }
  }
  useEffect(() => { alive.current = true; void reload().catch(reason => { if (alive.current) { setError(String(reason)); setLoading(false) } }); return () => { alive.current = false; request.current++ } }, [])
  const run = async (operation: () => Promise<void>) => {
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try { await operation(); await reload() } catch (reason) { if (alive.current) setError(String(reason)) }
    finally { if (alive.current) { setBusy(false); setLoading(false) } }
  }
  const shown = entries.filter(entry => (filter === 'all' || (filter === 'none' ? !entry.projectId : entry.projectId === filter)) && `${entry.title}\n${entry.problem}\n${entry.attempts}\n${entry.resolution}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const currentPage = Math.min(page, Math.max(0, Math.ceil(shown.length / 20) - 1))
  const choices = sources.filter(source => source.title.toLocaleLowerCase().includes(sourceQuery.toLocaleLowerCase()))
  const currentSourcePage = Math.min(sourcePage, Math.max(0, Math.ceil(choices.length / 50) - 1))
  return <section className="journal-playbook journal-projects" aria-label="踩坑手册">
    <div className="journal-saved-heading"><div><h2>把经验留下来</h2><p>记录问题、尝试和解决办法。状态由你确认，保存手册不会写入长期记忆。</p></div><div className="journal-actions"><button disabled={busy} onClick={() => { setDraft(blank()); setSourceQuery(''); setSourcePage(0) }}>新建手册</button><button disabled={busy} onClick={() => void run(async () => {})}>刷新手册</button></div></div>
    {error && <p role="alert" className="journal-error">{error} 编辑失败时草稿会保留；如提示版本过期，请取消编辑、刷新并重新核对。</p>}{notice && <p role="status">{notice}</p>}{loading && <p role="status">正在读取手册…</p>}
    {draft && <form className="journal-edit-form" aria-label="手册编辑" onSubmit={event => { event.preventDefault(); void run(async () => { await window.electronAPI.journal.savePlaybook(draft); if (alive.current) { setDraft(null); setNotice('手册已保存。') } }) }}>
      <h3>{draft.id ? '编辑经验记录' : '建立经验记录'}</h3>
      <label>标题<input autoFocus required disabled={busy} aria-label="手册标题" maxLength={120} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
      {([['problem', '问题', 4000], ['attempts', '尝试过程', 8000], ['resolution', '解决办法', 4000]] as const).map(([key, label, max]) => <label key={key}>{label}<textarea aria-label={`手册${label}`} required={key === 'problem' || key === 'resolution' && draft.status === 'resolved'} disabled={busy} maxLength={max} value={draft[key]} onChange={event => setDraft({ ...draft, [key]: event.target.value })} /></label>)}
      <label>状态<select aria-label="手册状态" disabled={busy} value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value as 'open' | 'resolved' })}><option value="open">待解决</option><option value="resolved">我确认已解决</option></select></label>
      <label>关联项目<select aria-label="手册项目" disabled={busy} value={draft.projectId || ''} onChange={event => setDraft({ ...draft, projectId: event.target.value || null })}><option value="">不关联项目</option>{draft.projectId && !projects.some(project => project.id === draft.projectId) && <option value={draft.projectId}>项目已删除，请重新选择</option>}{projects.map(project => <option key={project.id} value={project.id}>{project.name}{project.archived ? '（已归档）' : ''}</option>)}</select></label>
      <fieldset className="journal-playbook-sources" disabled={busy}><legend>来源收藏 · 已选 {draft.sourceIds.length} / 10</legend><p>只关联已有收藏，不复制图片。删除收藏后，手册会显示来源缺失。</p><label>查找来源<input aria-label="查找手册来源" maxLength={200} value={sourceQuery} onChange={event => { setSourceQuery(event.target.value); setSourcePage(0) }} /></label>
        {draft.sourceIds.map(id => <div className="journal-actions" key={id}><span>{sources.find(source => source.id === id)?.title || '来源已删除，无法回看'}</span><button type="button" onClick={() => setDraft({ ...draft, sourceIds: draft.sourceIds.filter(value => value !== id) })}>移除来源</button></div>)}
        <div className="journal-playbook-source-list">{choices.slice(currentSourcePage * 50, (currentSourcePage + 1) * 50).map(source => <label key={source.id}><input type="checkbox" data-playbook-source={source.id} disabled={!draft.sourceIds.includes(source.id) && draft.sourceIds.length >= 10} checked={draft.sourceIds.includes(source.id)} onChange={event => setDraft({ ...draft, sourceIds: event.target.checked ? [...draft.sourceIds, source.id] : draft.sourceIds.filter(id => id !== source.id) })} />{source.title}</label>)}</div>{choices.length > 50 && <div className="journal-pagination"><button type="button" disabled={currentSourcePage === 0} onClick={() => setSourcePage(currentSourcePage - 1)}>上一页来源</button><span>{currentSourcePage + 1} / {Math.ceil(choices.length / 50)}</span><button type="button" disabled={(currentSourcePage + 1) * 50 >= choices.length} onClick={() => setSourcePage(currentSourcePage + 1)}>下一页来源</button></div>}
      </fieldset><div className="journal-actions"><button disabled={busy}>保存手册</button><button type="button" disabled={busy} onClick={() => setDraft(null)}>取消编辑</button></div>
    </form>}
    <div className="journal-actions"><label>项目筛选<select aria-label="筛选手册项目" disabled={busy} value={filter} onChange={event => { setFilter(event.target.value); setPage(0) }}><option value="all">全部项目</option><option value="none">未关联项目</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label>搜索手册<input aria-label="搜索手册" maxLength={200} value={query} onChange={event => { setQuery(event.target.value); setPage(0) }} /></label></div>
    <p>共 {shown.length} 条记录，每页 20 条。</p>
    {shown.slice(currentPage * 20, (currentPage + 1) * 20).map(entry => <article className="journal-project-card" data-playbook-id={entry.id} key={entry.id}><h3>{entry.title}</h3><p>{entry.status === 'resolved' ? '手动标记已解决' : '待解决'} · {projects.find(project => project.id === entry.projectId)?.name || '未关联项目'}</p><h4>问题</h4><p className="journal-playbook-text">{entry.problem}</p><h4>尝试过程</h4><p className="journal-playbook-text">{entry.attempts || '尚未记录'}</p><h4>解决办法</h4><p className="journal-playbook-text">{entry.resolution || '尚未确认'}</p>
      <div className="journal-actions"><button disabled={busy} onClick={() => { setDraft({ ...entry, sourceIds: [...entry.sourceIds] }); setSourceQuery(''); setSourcePage(0) }}>编辑手册</button><button onClick={() => setPreview(preview === entry.id ? '' : entry.id)}>预览 Markdown</button><button disabled={busy} onClick={() => void run(async () => { const saved = await window.electronAPI.journal.exportPlaybook({ id: entry.id, revision: entry.revision }); if (alive.current) setNotice(saved ? 'Markdown 已导出。' : '已取消导出。') })}>导出 Markdown</button><button disabled={busy} onClick={() => setDeleting(entry.id)}>删除手册</button></div>
      {preview === entry.id && <pre className="journal-playbook-preview">{playbookMarkdown(entry)}</pre>}
      <JournalPlaybookMemory key={`${entry.id}:${entry.revision}`} entry={entry} />
      {!entry.sourceIds.length && <p>未关联来源。</p>}{entry.sourceIds.map(id => { const source = sources.find(value => value.id === id); return <div key={id}>{source ? <><button aria-expanded={expanded === `${entry.id}:${id}`} onClick={() => setExpanded(expanded === `${entry.id}:${id}` ? '' : `${entry.id}:${id}`)}>回看来源：{source.title}</button>{expanded === `${entry.id}:${id}` && <SavedSource item={source} onRecognized={() => void run(async () => {})} />}</> : <p>来源已删除，无法回看（{id}）。</p>}</div> })}
      {deleting === entry.id && <div role="alert"><p>删除这条手册？项目和来源收藏仍保留。</p><button disabled={busy} onClick={() => void run(async () => { await window.electronAPI.journal.deletePlaybook({ id: entry.id, revision: entry.revision }); if (alive.current) { setDeleting(''); if (draft?.id === entry.id) setDraft(null) } })}>确认删除手册</button><button disabled={busy} onClick={() => setDeleting('')}>取消删除</button></div>}
    </article>)}
    {!loading && !shown.length && <p>暂无匹配手册。可以新建记录，并选取相关收藏作为来源。</p>}
    <div className="journal-pagination"><button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页手册</button><span>第 {shown.length ? currentPage + 1 : 0} / {Math.ceil(shown.length / 20)} 页</span><button disabled={(currentPage + 1) * 20 >= shown.length} onClick={() => setPage(currentPage + 1)}>下一页手册</button></div>
  </section>
}
