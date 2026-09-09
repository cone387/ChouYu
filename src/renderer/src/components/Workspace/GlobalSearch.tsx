import { useEffect, useRef, useState } from 'react'
import { journalDateKey as dateKey, journalSearchExcerpt, journalSearchRange } from '../../core/journal-search'

type Result = { id: string; kind: 'session' | 'memory' | 'journal' | 'capture'; title: string; detail: string; excerpt?: string; date?: string }

export default function GlobalSearch({ onClose, onSession, onMemory, onJournal }: {
  onClose: () => void
  onSession: (id: string, query: string) => Promise<void>
  onMemory: (id: string) => void
  onJournal: (date: string, query: string, sourceId: string) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [query, setQuery] = useState('')
  const [startDate, setStartDate] = useState(() => { const date = new Date(); date.setDate(date.getDate() - 29); return dateKey(date.getTime()) })
  const [endDate, setEndDate] = useState(() => dateKey(Date.now()))
  const [coverage, setCoverage] = useState('')
  const [appFilter, setAppFilter] = useState(''), [journalOffset, setJournalOffset] = useState(0)
  const [journalTotal, setJournalTotal] = useState(0)
  const [results, setResults] = useState<Result[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [opening, setOpening] = useState(false)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const element = dialog.current!
    const panel = element.closest('.app-workspace')?.getBoundingClientRect()
    if (panel) {
      const width = Math.min(580, panel.width - 32, window.innerWidth - 32)
      element.style.width = `${width}px`
      element.style.left = `${Math.max(16, Math.min(window.innerWidth - width - 16, panel.left + (panel.width - width) / 2))}px`
      element.style.top = `${Math.max(16, Math.min(window.innerHeight - 200, panel.top + 48))}px`
      element.style.maxHeight = `${Math.max(180, Math.min(panel.height - 64, window.innerHeight - parseFloat(element.style.top) - 16))}px`
    }
    element.showModal()
    return () => { element.close(); previous?.focus() }
  }, [])
  useEffect(() => {
    let active = true
    setResults([]); setError(''); setCoverage(''); setJournalTotal(0)
    const term = query.trim()
    if (!term) { setLoading(false); return }
    setLoading(true)
    let range: { from: number; to: number } | undefined, rangeError = ''
    try { range = journalSearchRange(startDate, endDate) } catch (reason) { rangeError = (reason as Error).message }
    const timer = setTimeout(async () => {
      const responses = await Promise.allSettled([
        window.electronAPI.db.searchSessions(term),
        window.electronAPI.memory.list({ query: term, status: 'active', limit: 20 }),
        range ? window.electronAPI.journal.list({ ...range, query: term, app: appFilter, offset: journalOffset }) : Promise.reject(new Error(rangeError)),
        range ? window.electronAPI.journal.captures({ ...range, query: term, app: appFilter, offset: journalOffset }) : Promise.reject(new Error(rangeError))
      ])
      if (!active) return
      const [sessions, memories, journal, captures] = responses
      const total = Math.max(journal.status === 'fulfilled' ? journal.value.total : 0, captures.status === 'fulfilled' ? captures.value.total : 0)
      if (journal.status === 'fulfilled' && captures.status === 'fulfilled' && journalOffset && journalOffset >= total) { setJournalOffset(Math.max(0, Math.floor((total - 1) / 20) * 20)); return }
      setJournalTotal(total)
      const items: Result[] = []
      if (sessions.status === 'fulfilled') items.push(...sessions.value.slice(0, 20).map(item => ({ id: item.id, kind: 'session' as const, title: item.title, detail: item.preview })))
      if (memories.status === 'fulfilled') items.push(...memories.value.map(item => ({ id: item.id, kind: 'memory' as const, title: item.content, detail: '长期记忆' })))
      if (journal.status === 'fulfilled') items.push(...journal.value.items.slice(0, 20).map(item => ({ id: String(item.id), kind: 'journal' as const, title: item.title || item.app, detail: `${dateKey(item.startedAt)} · ${item.app}`, date: dateKey(item.startedAt) })))
      if (captures.status === 'fulfilled') items.push(...captures.value.items.slice(0, 20).map(item => ({ id: item.id, kind: 'capture' as const, title: item.title || item.app, detail: `${dateKey(item.capturedAt)} · ${item.app}`, excerpt: journalSearchExcerpt(item.ocrText || item.title, term), date: dateKey(item.capturedAt) })))
      setCoverage([journal.status === 'fulfilled' ? `活动本页 ${Math.min(20, journal.value.items.length)} / 共 ${journal.value.total} 条` : '', captures.status === 'fulfilled' ? `画面本页 ${Math.min(20, captures.value.items.length)} / 共 ${captures.value.total} 条` : ''].filter(Boolean).join(' · '))
      setResults(items); setLoading(false)
      const failed = responses.flatMap((result, index) => result.status === 'rejected' ? [['会话', '记忆', '活动', '画面'][index]] : [])
      if (failed.length) setError([rangeError, `${failed.join('、')}暂时无法搜索，请调整日期或重新输入重试。`].filter(Boolean).join(' '))
    }, 200)
    return () => { active = false; clearTimeout(timer) }
  }, [query, startDate, endDate, appFilter, journalOffset])

  const open = async (item: Result) => {
    setOpening(true)
    try {
      if (item.kind === 'session') await onSession(item.id, query.trim())
      else if (item.kind === 'memory') onMemory(item.id)
      else onJournal(item.date!, query.trim(), `${item.kind === 'capture' ? 'capture' : 'activity'}:${item.id}`)
      onClose()
    } catch { setError('无法打开这条结果，请重试。'); setOpening(false) }
  }
  return <dialog ref={dialog} className="global-search-dialog" aria-label="全局搜索" onCancel={event => { event.preventDefault(); onClose() }}
    onKeyDown={event => {
      if (!['ArrowDown', 'ArrowUp'].includes(event.key) || (event.target instanceof HTMLInputElement && event.target.type === 'date')) return
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('.global-search-result')]
      if (!buttons.length) return
      event.preventDefault()
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
      const next = index < 0 ? (event.key === 'ArrowDown' ? 0 : buttons.length - 1) : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
      buttons[next]?.focus()
    }}>
    <div className="global-search-heading"><input autoFocus aria-label="搜索会话、记忆和活动" placeholder="搜索会话、记忆和活动…" maxLength={200} value={query} onChange={event => { setQuery(event.target.value); setJournalOffset(0) }}
      onKeyDown={event => { if (event.key === 'Enter' && results[0] && !loading && !opening) void open(results[0]) }} />
      <button onClick={onClose} aria-label="关闭全局搜索">Esc</button></div>
    <details className="global-search-range"><summary>日志范围：{startDate} 至 {endDate}{appFilter.trim() ? ` · 应用包含“${appFilter.trim()}”` : ''}</summary><div><label>开始日期<input type="date" aria-label="日志搜索开始日期" value={startDate} onChange={event => { setStartDate(event.target.value); setJournalOffset(0) }} /></label><label>结束日期<input type="date" aria-label="日志搜索结束日期" value={endDate} onChange={event => { setEndDate(event.target.value); setJournalOffset(0) }} /></label><label>应用包含<input aria-label="日志搜索应用" maxLength={120} value={appFilter} placeholder="如 chrome.exe 或 Safari" onChange={event => { setAppFilter(event.target.value); setJournalOffset(0) }} /></label></div><p className="global-search-hint">含结束当天，每次最多 31 天。日期和应用仅限定日志，会话和记忆不受限。</p></details>
    <p className="global-search-hint">会话、记忆最多各 20 条；活动和画面各按 20 条分页。尚未识别的画面只能按标题和应用查找。</p>
    {coverage && <p className="global-search-hint" role="status">{coverage}</p>}
    {(journalTotal > 20 || journalOffset > 0) && <nav className="global-search-pagination" aria-label="跨日日志分页"><button disabled={loading || opening || !journalOffset} onClick={() => setJournalOffset(value => Math.max(0, value - 20))}>上一页日志</button><span>第 {Math.floor(journalOffset / 20) + 1} 页</span><button disabled={loading || opening || journalOffset + 20 >= journalTotal} onClick={() => setJournalOffset(value => value + 20)}>下一页日志</button></nav>}
    <div className="global-search-results" aria-busy={loading || opening}>
      {error && <p role="alert">{error}</p>}
      {loading ? <p role="status">正在搜索…</p> : !query.trim() ? <p>输入关键词，查找并跳转到相关内容。</p> : !results.length && !error ? <p role="status">没有找到相关内容。</p> : null}
      {results.map(item => <button key={`${item.kind}:${item.id}`} className="global-search-result" disabled={opening} onClick={() => void open(item)}>
        <span className="global-search-kind">{{ session: '会话', memory: '记忆', journal: '活动', capture: '画面' }[item.kind]}</span>
        <span><strong>{item.title}</strong><small>{item.detail}</small>{item.excerpt && <small className="global-search-excerpt">{item.excerpt}</small>}</span>
      </button>)}
    </div>
  </dialog>
}
