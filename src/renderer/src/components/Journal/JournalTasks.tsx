import { useEffect, useState } from 'react'
import type { JournalTaskPage } from '../../../../shared/journal'
import { journalRange } from './JournalEvidence'

export const journalTime = (at: number) => new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
export const journalDuration = (ms: number) => ms <= 0 ? '不足 1 分钟' : ms < 60_000 ? '不足 1 分钟' : ms < 3600_000 ? `${Math.floor(ms / 60_000)} 分钟` : `${Math.floor(ms / 3600_000)} 小时 ${Math.floor(ms / 60_000) % 60} 分钟`
export const kindLabel = { activity: '活动线索', progress: '具体进展', blocker: '待解决', decision: '决定' }

export function JournalTasks({ date, query, revision, onOpen, onOrganize }: { date: string; query: string; revision: number; onOpen(id: string): void; onOrganize(): void }) {
  const [page, setPage] = useState<JournalTaskPage | null>(null)
  const [offset, setOffset] = useState(0)
  const [error, setError] = useState('')
  useEffect(() => { setOffset(0); setPage(null) }, [date, query])
  useEffect(() => {
    let active = true
    const timer = setTimeout(() => {
      void window.electronAPI.journal.tasks({ ...journalRange(date), query, offset }).then(value => {
        if (!active) return
        if (offset && offset >= value.total) { setOffset(Math.max(0, Math.floor((value.total - 1) / 100) * 100)); return }
        setPage(value); setError('')
      }).catch(reason => { if (active) setError(String(reason)) })
    }, 180)
    return () => { active = false; clearTimeout(timer) }
  }, [date, query, offset, revision])
  return <section className="journal-tasks" aria-label="事项视图">
    <div className="journal-task-toolbar"><p>{page ? `${page.total} 项${query ? '匹配结果' : '事项与线索'}` : '正在读取事项…'}</p><button onClick={onOrganize}>整理这一天 <span aria-hidden="true">↗</span></button></div>
    {error && <p role="alert" className="journal-error">{error}</p>}
    {page && !page.organized && page.total > 0 && <p className="journal-task-hint">先查看活动线索，整理后可将跨应用的相关记录归并为事项。</p>}
    {page?.total === 0 && <div className="journal-empty"><h2>{query ? '没有匹配的事项' : '这一天还没有事项'}</h2><p>{query ? '试试事项标题、应用、分类或备注中的文字。' : '活动记录会先显示为线索，积累后可以整理这一天。'}</p></div>}
    <ol key={`${date}:${query}:${offset}`} className="journal-task-list journal-list-scroll" tabIndex={0} aria-label="事项列表">{page?.items.map(task => <li key={task.id}>
      <button className="journal-task-card" onClick={() => onOpen(task.id)} data-kind={task.kind}>
        <div className="journal-task-heading"><span className="journal-task-kind">{task.category || (task.organized ? kindLabel[task.kind] : '待整理线索')}</span><span>{journalTime(task.startedAt)} — {journalTime(task.endedAt)}</span></div>
        <h2>{task.title}</h2>
        {task.text && <p className="journal-task-excerpt">{task.text}</p>}
        {task.note && <p className="journal-task-note">备注 · {task.note}</p>}
        <div className="journal-task-footer"><span>{task.apps.map(app => app.replace(/\.exe$/i, '')).join(' · ')}</span><span>{journalDuration(task.durationMs)} · {task.captureIds.length} 张画面{task.edited ? ' · 已修正' : ''}</span></div>
        <span className="journal-task-open">查看活动与画面 <span aria-hidden="true">→</span></span>
      </button>
    </li>)}</ol>
    {page && page.total > 100 && <nav className="journal-pagination" aria-label="事项分页"><button disabled={!offset} onClick={() => { setOffset(Math.max(0, offset - 100)); setPage(null) }}>上一页</button><span>第 {offset / 100 + 1} / {Math.ceil(page.total / 100)} 页</span><button disabled={offset + 100 >= page.total} onClick={() => { setOffset(offset + 100); setPage(null) }}>下一页</button></nav>}
  </section>
}
