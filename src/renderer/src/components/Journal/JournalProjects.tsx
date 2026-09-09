import { useEffect, useMemo, useRef, useState } from 'react'
import type { JournalSavedItem } from '../../../../shared/journal'
import { resolveJournalProject, type JournalProjectInput, type JournalProjectState } from '../../../../shared/journal-projects'
import { SavedSource } from './JournalSaved'

const empty = (): JournalProjectInput => ({ name: '', description: '', archived: false, rules: [] })
export function JournalProjects() {
  const [state, setState] = useState<JournalProjectState>({ projects: [], assignments: [] })
  const [items, setItems] = useState<JournalSavedItem[]>([]), [draft, setDraft] = useState<JournalProjectInput | null>(null)
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState('')
  const [filter, setFilter] = useState('all'), [page, setPage] = useState(0), [expanded, setExpanded] = useState(''), [deleting, setDeleting] = useState('')
  const alive = useRef(true), request = useRef(0)
  const reload = async () => {
    const id = ++request.current
    const [next, saved] = await Promise.all([window.electronAPI.journal.projects(), window.electronAPI.journal.savedItems()])
    if (alive.current && id === request.current) { setState(next); setItems(saved); setLoading(false) }
  }
  useEffect(() => { alive.current = true; void reload().catch(reason => { if (alive.current) { setError(String(reason)); setLoading(false) } }); return () => { alive.current = false; request.current++ } }, [])
  const run = async (operation: () => Promise<void>) => {
    if (busy) return
    setBusy(true); setError('')
    try { await operation(); await reload() } catch (reason) { if (alive.current) setError(String(reason)) }
    finally { if (alive.current) { setBusy(false); setLoading(false) } }
  }
  const resolved = useMemo(() => items.map(item => ({ item, match: resolveJournalProject(item, state) })), [items, state])
  const matches = resolved.filter(({ match }) => filter === 'all' || (filter === 'none' ? !match.projectIds.length : filter === 'ambiguous' ? match.mode === 'ambiguous' : match.projectIds.includes(filter)))
  const currentPage = Math.min(page, Math.max(0, Math.ceil(matches.length / 50) - 1))
  const names = (ids: string[]) => ids.map(id => state.projects.find(project => project.id === id)?.name).filter(Boolean).join('、')
  return <section className="journal-projects" aria-label="项目归档">
    <div className="journal-saved-heading"><div><h2>按项目接着做</h2><p>整理已保存的接续卡和书签。规则只建议归属，手动选择优先。</p></div><div className="journal-actions"><button disabled={busy} onClick={() => setDraft(empty())}>新建项目</button><button disabled={busy} onClick={() => void run(async () => {})}>刷新项目</button></div></div>
    {error && <p role="alert" className="journal-error">{error}</p>}
    {loading && <p role="status">正在读取项目与收藏…</p>}
    {draft && <form className="journal-edit-form" aria-label="项目编辑" onSubmit={event => { event.preventDefault(); void run(async () => { await window.electronAPI.journal.saveProject(draft); if (alive.current) setDraft(null) }) }}>
      <h3>{draft.id ? '编辑项目' : '建立项目'}</h3>
      <label>项目名称<input autoFocus aria-label="项目名称" required maxLength={80} disabled={busy} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
      <label>项目说明<textarea aria-label="项目说明" maxLength={1000} disabled={busy} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label>
      <label className="journal-project-archive"><input type="checkbox" disabled={busy} checked={draft.archived} onChange={event => setDraft({ ...draft, archived: event.target.checked })} />已归档（保留手动归属，不产生新建议）</label>
      <p>每条规则的应用和标题须命中同一来源；多条规则满足任意一条即可。留空规则列表时只手动归属。</p>
      {draft.rules.map((rule, index) => <fieldset className="journal-project-rule" key={index} disabled={busy}><legend>匹配规则 {index + 1}</legend><label>应用包含<input aria-label={`规则 ${index + 1} 应用`} maxLength={120} value={rule.app} onChange={event => setDraft({ ...draft, rules: draft.rules.map((value, at) => at === index ? { ...value, app: event.target.value } : value) })} /></label><label>标题包含<input aria-label={`规则 ${index + 1} 标题`} maxLength={120} value={rule.title} onChange={event => setDraft({ ...draft, rules: draft.rules.map((value, at) => at === index ? { ...value, title: event.target.value } : value) })} /></label><button type="button" onClick={() => setDraft({ ...draft, rules: draft.rules.filter((_, at) => at !== index) })}>移除规则 {index + 1}</button></fieldset>)}
      <div className="journal-actions"><button type="button" disabled={busy || draft.rules.length >= 20} onClick={() => setDraft({ ...draft, rules: [...draft.rules, { app: '', title: '' }] })}>添加匹配规则</button><button disabled={busy}>保存项目</button><button type="button" disabled={busy} onClick={() => setDraft(null)}>取消编辑</button></div>
    </form>}
    <div aria-label="项目列表">{state.projects.map(project => <article className="journal-project-card" key={project.id}><h3>{project.name}{project.archived ? ' · 已归档' : ''}</h3>{project.description && <p>{project.description}</p>}<p>{project.rules.length} 条规则 · {resolved.filter(value => value.match.projectIds.includes(project.id)).length} 份收藏（含建议与重叠匹配）</p><div className="journal-actions"><button disabled={busy} onClick={() => setDraft({ ...project, rules: project.rules.map(rule => ({ ...rule })) })}>编辑项目</button><button disabled={busy} onClick={() => setDeleting(project.id)}>删除项目</button></div>{deleting === project.id && <div role="alert"><p>删除项目后，收藏和快照仍保留，原手动归属变为不归属。</p><button disabled={busy} onClick={() => void run(async () => { await window.electronAPI.journal.deleteProject(project.id); if (alive.current) { setDeleting(''); setFilter('all'); setPage(0); if (draft?.id === project.id) setDraft(null) } })}>确认删除项目</button><button disabled={busy} onClick={() => setDeleting('')}>取消删除</button></div>}</article>)}</div>
    {!loading && !state.projects.length && <p>还没有项目。新建项目后，可按规则找出相关收藏。</p>}
    <label>筛选收藏归属<select aria-label="筛选收藏归属" value={filter} disabled={busy} onChange={event => { setFilter(event.target.value); setPage(0) }}><option value="all">全部收藏</option><option value="none">无归属或建议</option><option value="ambiguous">多个项目待确认</option>{state.projects.map(project => <option key={project.id} value={project.id}>{project.name}{project.archived ? '（已归档）' : ''}</option>)}</select></label>
    <p>共 {matches.length} 份收藏。建议不是已确认归属；可回看保存时的原始来源再选择。</p>
    {matches.slice(currentPage * 50, (currentPage + 1) * 50).map(({ item, match }) => <article className="journal-project-card" key={item.id} data-project-saved={item.id}><h3>{item.title}</h3><p>{match.mode === 'manual' ? `手动归属：${names(match.projectIds) || '不归属'}` : match.mode === 'ambiguous' ? `待确认：${names(match.projectIds)}` : match.mode === 'suggested' ? `建议归属：${names(match.projectIds)}` : '暂无匹配建议'}</p><label>调整归属<select aria-label={`调整归属：${item.title}`} disabled={busy} value={match.mode === 'manual' ? match.projectIds[0] || 'none' : 'auto'} onChange={event => { const value = event.target.value; void run(() => window.electronAPI.journal.assignProject({ savedId: item.id, projectId: value === 'auto' || value === 'none' ? null : value, automatic: value === 'auto' })) }}><option value="auto">按规则建议（未确认）</option><option value="none">明确不归属</option>{state.projects.map(project => <option key={project.id} value={project.id}>{project.name}{project.archived ? '（已归档）' : ''}</option>)}</select></label><button onClick={() => setExpanded(expanded === item.id ? '' : item.id)} aria-expanded={expanded === item.id}>{expanded === item.id ? '收起快照' : '回看来源快照'}</button>{expanded === item.id && <SavedSource item={item} onRecognized={() => void run(async () => {})} />}</article>)}
    {!loading && !matches.length && <p>没有符合筛选的收藏。可在“接着做”保存接续卡或书签后再整理。</p>}
    <div className="journal-pagination"><button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页收藏</button><span>第 {matches.length ? currentPage + 1 : 0} / {Math.ceil(matches.length / 50)} 页</span><button disabled={(currentPage + 1) * 50 >= matches.length} onClick={() => setPage(currentPage + 1)}>下一页收藏</button></div>
  </section>
}
