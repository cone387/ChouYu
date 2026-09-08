import { useEffect, useRef, useState } from 'react'

type Result = { id: string; kind: 'session' | 'memory' | 'journal'; title: string; detail: string; date?: string }
const dateKey = (at: number) => {
  const date = new Date(at)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export default function GlobalSearch({ onClose, onSession, onMemory, onJournal }: {
  onClose: () => void
  onSession: (id: string, query: string) => Promise<void>
  onMemory: (id: string) => void
  onJournal: (date: string, query: string) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [query, setQuery] = useState('')
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
    setResults([]); setError('')
    const term = query.trim()
    if (!term) { setLoading(false); return }
    setLoading(true)
    const timer = setTimeout(async () => {
      const to = Date.now() + 1
      const responses = await Promise.allSettled([
        window.electronAPI.db.searchSessions(term),
        window.electronAPI.memory.list({ query: term, status: 'active', limit: 20 }),
        window.electronAPI.journal.list({ from: Math.max(0, to - 30 * 86400_000), to, query: term })
      ])
      if (!active) return
      const [sessions, memories, journal] = responses
      const items: Result[] = []
      if (sessions.status === 'fulfilled') items.push(...sessions.value.slice(0, 20).map(item => ({ id: item.id, kind: 'session' as const, title: item.title, detail: item.preview })))
      if (memories.status === 'fulfilled') items.push(...memories.value.map(item => ({ id: item.id, kind: 'memory' as const, title: item.content, detail: '长期记忆' })))
      if (journal.status === 'fulfilled') items.push(...journal.value.items.slice(0, 20).map(item => ({ id: String(item.id), kind: 'journal' as const, title: item.title || item.app, detail: `${dateKey(item.startedAt)} · ${item.app}`, date: dateKey(item.startedAt) })))
      setResults(items); setLoading(false)
      const failed = responses.flatMap((result, index) => result.status === 'rejected' ? [['会话', '记忆', '活动'][index]] : [])
      if (failed.length) setError(`${failed.join('、')}暂时无法搜索，请重新输入重试。`)
    }, 200)
    return () => { active = false; clearTimeout(timer) }
  }, [query])

  const open = async (item: Result) => {
    setOpening(true)
    try {
      if (item.kind === 'session') await onSession(item.id, query.trim())
      else if (item.kind === 'memory') onMemory(item.id)
      else onJournal(item.date!, query.trim())
      onClose()
    } catch { setError('无法打开这条结果，请重试。'); setOpening(false) }
  }
  return <dialog ref={dialog} className="global-search-dialog" aria-label="全局搜索" onCancel={event => { event.preventDefault(); onClose() }}
    onKeyDown={event => {
      if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('.global-search-result')]
      if (!buttons.length) return
      event.preventDefault()
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
      const next = index < 0 ? (event.key === 'ArrowDown' ? 0 : buttons.length - 1) : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
      buttons[next]?.focus()
    }}>
    <div className="global-search-heading"><input autoFocus aria-label="搜索会话、记忆和活动" placeholder="搜索会话、记忆和活动…" maxLength={200} value={query} onChange={event => setQuery(event.target.value)}
      onKeyDown={event => { if (event.key === 'Enter' && results[0] && !loading && !opening) void open(results[0]) }} />
      <button onClick={onClose} aria-label="关闭全局搜索">Esc</button></div>
    <p className="global-search-hint">会话全文 · 长期记忆 · 最近 30 天活动</p>
    <div className="global-search-results" aria-busy={loading || opening}>
      {error && <p role="alert">{error}</p>}
      {loading ? <p role="status">正在搜索…</p> : !query.trim() ? <p>输入关键词，查找并跳转到相关内容。</p> : !results.length && !error ? <p role="status">没有找到相关内容。</p> : null}
      {results.map(item => <button key={`${item.kind}:${item.id}`} className="global-search-result" disabled={opening} onClick={() => void open(item)}>
        <span className="global-search-kind">{{ session: '会话', memory: '记忆', journal: '活动' }[item.kind]}</span>
        <span><strong>{item.title}</strong><small>{item.detail}</small></span>
      </button>)}
    </div>
  </dialog>
}
