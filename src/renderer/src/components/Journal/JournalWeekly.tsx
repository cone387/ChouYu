import { useEffect, useRef, useState } from 'react'
import { weeklyDate, weeklyExport, type JournalWeeklyDraft, type JournalWeeklySource } from '../../../../shared/journal-weekly'
import type { JournalSavedItem } from '../../../../shared/journal'
import { SavedSource } from './JournalSaved'

const monday = () => { const date = new Date(); date.setDate(date.getDate() - (date.getDay() + 6) % 7); return weeklyDate(date.getTime()) }
export function JournalWeekly() {
  const [start, setStart] = useState(monday), [sources, setSources] = useState<JournalWeeklySource[]>([]), [selected, setSelected] = useState<string[]>([]), [query, setQuery] = useState(''), [page, setPage] = useState(0)
  const [reports, setReports] = useState<JournalWeeklyDraft[]>([]), [draft, setDraft] = useState<JournalWeeklyDraft | null>(null), [preview, setPreview] = useState(''), [deleting, setDeleting] = useState(''), [source, setSource] = useState<JournalSavedItem | null>(null)
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const alive = useRef(true), sequence = useRef(0), running = useRef(false)
  const from = new Date(`${start}T00:00:00`).getTime(), end = new Date(from); end.setDate(end.getDate() + 7); const to = end.getTime()
  const reload = async () => { const next = await window.electronAPI.journal.weekly(); if (alive.current) setReports(next) }
  const loadSources = async () => {
    const id = ++sequence.current
    setLoading(true); setSources([]); setSelected([]); setPage(0)
    try { const next = await window.electronAPI.journal.weeklySources({ from, to }); if (alive.current && id === sequence.current) setSources(next) }
    catch (reason) { if (alive.current && id === sequence.current) setError(String(reason)) }
    finally { if (alive.current && id === sequence.current) setLoading(false) }
  }
  useEffect(() => { alive.current = true; void reload().catch(reason => { if (alive.current) setError(String(reason)) }); return () => { alive.current = false; sequence.current++ } }, [])
  useEffect(() => { void loadSources() }, [start])
  const run = async (operation: () => Promise<void>) => {
    if (running.current) return
    running.current = true; setBusy(true); setError(''); setNotice('')
    try { await operation(); await reload() } catch (reason) { if (alive.current) setError(String(reason)) }
    finally { running.current = false; if (alive.current) setBusy(false) }
  }
  const matches = sources.filter(item => `${item.title}\n${item.note}\n${item.project}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  const currentPage = Math.min(page, Math.max(0, Math.ceil(matches.length / 50) - 1)), visible = matches.slice(currentPage * 50, (currentPage + 1) * 50)
  const stored = draft && reports.find(report => report.id === draft.id)
  const dirty = Boolean(draft && (!stored || stored.revision !== draft.revision || stored.title !== draft.title || stored.markdown !== draft.markdown))
  return <section className="journal-weekly journal-playbook journal-projects" aria-label="周报草稿">
    <div className="journal-saved-heading"><div><h2>整理这一周</h2><p>勾选并确认收藏中的事实，生成可编辑草稿。生成在本机完成，不调用模型。</p></div><button disabled={busy} onClick={() => void run(async () => { await loadSources() })}>刷新周报与来源</button></div>
    {error && <p role="alert" className="journal-error">{error} 编辑草稿仍保留；遇到版本冲突，请先保留修改，再刷新核对。</p>}{notice && <p role="status">{notice}</p>}
    <label>起始日期<input type="date" aria-label="周报起始日期" disabled={busy} value={start} onChange={event => { if (event.target.value) setStart(event.target.value) }} /></label>
    <p>范围：{start} 至 {Number.isFinite(to) ? weeklyDate(to - 1) : '无效日期'}。按来源发生时间筛选，完成状态取当前手动标记，不统计工时。</p>
    <label>查找事项<input aria-label="查找周报事项" value={query} maxLength={200} onChange={event => { setQuery(event.target.value); setPage(0) }} /></label>
    {loading ? <p role="status">正在读取周报来源…</p> : <><p>共 {sources.length} 份来源，匹配 {matches.length} 份，已选 {selected.length} / 100。</p><div className="journal-actions"><button disabled={busy || new Set([...selected, ...visible.filter(item => item.completed).map(item => item.id)]).size > 100} onClick={() => setSelected([...new Set([...selected, ...visible.filter(item => item.completed).map(item => item.id)])])}>选中本页已完成</button><button disabled={busy} onClick={() => setSelected([])}>清空选择</button></div>
      <div className="journal-playbook-source-list">{visible.map(item => <label key={item.id}><input type="checkbox" data-weekly-source={item.id} disabled={busy || !selected.includes(item.id) && selected.length >= 100} checked={selected.includes(item.id)} onChange={event => setSelected(event.target.checked ? [...selected, item.id] : selected.filter(id => id !== item.id))} /><span>{item.title} · {item.kind === 'decision' ? '决定（请核对）' : item.completed ? '手动标记完成' : '未完成'}{item.project && ` · ${item.project}`}{item.note && <small className="journal-weekly-note">{item.note}</small>}</span></label>)}</div>
      <div className="journal-pagination"><button disabled={currentPage === 0 || busy} onClick={() => setPage(currentPage - 1)}>上一页事项</button><span>{matches.length ? currentPage + 1 : 0} / {Math.ceil(matches.length / 50)}</span><button disabled={(currentPage + 1) * 50 >= matches.length || busy} onClick={() => setPage(currentPage + 1)}>下一页事项</button></div>
      <button disabled={busy || !selected.length || Boolean(dirty)} onClick={() => void run(async () => { const next = await window.electronAPI.journal.createWeekly({ from, to, sources: sources.filter(item => selected.includes(item.id)).map(({ id, signature }) => ({ id, signature })) }); if (alive.current) { setDraft(next); setNotice('新草稿已保存，请编辑核对后导出。') } })}>确认所选事项并生成新草稿</button></>}
    {draft && <form className="journal-edit-form" aria-label="周报编辑" onSubmit={event => { event.preventDefault(); void run(async () => { const next = await window.electronAPI.journal.editWeekly(draft); if (alive.current) { setDraft(next); setNotice('周报修改已保存。') } }) }}>
      <h3>编辑周报</h3><label>标题<input aria-label="周报标题" required maxLength={120} disabled={busy} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label><label>Markdown 正文<textarea aria-label="周报正文" required maxLength={60000} disabled={busy} value={draft.markdown} onChange={event => setDraft({ ...draft, markdown: event.target.value })} /></label><p>生成草稿不会覆盖旧周报；导出使用已保存的版本。</p><div className="journal-actions"><button disabled={busy}>保存周报修改</button><button disabled={busy} type="button" onClick={() => setDraft(null)}>放弃未保存修改并关闭</button></div>
    </form>}
    <h3>已保存草稿 · {reports.length} / 100</h3>
    {reports.map(report => <article className="journal-project-card" data-weekly-id={report.id} key={report.id}><h4>{report.title}</h4><p>{weeklyDate(report.from)} 至 {weeklyDate(report.to - 1)} · {report.sourceIds.length} 份来源</p><div className="journal-actions"><button disabled={busy || Boolean(dirty)} onClick={() => setDraft({ ...report })}>编辑周报</button><button onClick={() => setPreview(preview === report.id ? '' : report.id)}>预览周报 Markdown</button><button disabled={busy || Boolean(dirty && draft?.id === report.id)} onClick={() => void run(async () => { const saved = await window.electronAPI.journal.exportWeekly(report); if (alive.current) setNotice(saved ? '周报 Markdown 已导出。' : '已取消周报导出。') })}>导出周报 Markdown</button><button disabled={busy} onClick={() => setDeleting(report.id)}>删除周报</button></div>
      {preview === report.id && <pre className="journal-playbook-preview">{weeklyExport(report)}</pre>}
      {report.sourceIds.map(id => <div key={id}>{report.missingSourceIds.includes(id) ? <p>来源已删除，无法回看（{id}）。正文仍保留。</p> : <button disabled={busy} onClick={() => void run(async () => { const found = (await window.electronAPI.journal.savedItems()).find(item => item.id === id); if (!found) throw new Error('来源已删除，请刷新。'); if (alive.current) setSource(found) })}>回看周报来源：{sources.find(item => item.id === id)?.title || id}</button>}</div>)}
      {deleting === report.id && <div role="alert"><p>删除这份周报？收藏来源仍保留。</p><button disabled={busy} onClick={() => void run(async () => { await window.electronAPI.journal.deleteWeekly(report); if (alive.current) { setDeleting(''); if (draft?.id === report.id) setDraft(null) } })}>确认删除周报</button><button disabled={busy} onClick={() => setDeleting('')}>取消删除周报</button></div>}
    </article>)}
    {source && <section aria-label="周报来源回看"><h3>{source.title}</h3><button onClick={() => setSource(null)}>关闭来源回看</button><SavedSource item={source} onRecognized={() => void run(async () => { const next = (await window.electronAPI.journal.savedItems()).find(item => item.id === source.id); if (alive.current) setSource(next || null) })} /></section>}
  </section>
}
