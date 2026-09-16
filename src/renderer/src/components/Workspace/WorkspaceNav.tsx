import { useEffect, useState, type KeyboardEvent } from 'react'
import './Workspace.css'

export type WorkspacePage = 'chat' | 'contacts' | 'tasks' | 'journal' | 'memory' | 'settings'

const pages: { id: WorkspacePage; label: string; path: string }[] = [
  { id: 'chat', label: '会话', path: 'M4 4h16v12H9l-5 4V4zM8 8h8M8 12h5' },
  { id: 'contacts', label: '通讯录', path: 'M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 20v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75' },
  { id: 'tasks', label: '任务', path: 'M9 4h6l1 2h4v15H4V6h4l1-2zM8 12l2 2 5-5' },
  { id: 'journal', label: '活动', path: 'M12 3a9 9 0 1 1-9 9 9 9 0 0 1 9-9zM12 7v5l3 2' },
  { id: 'memory', label: '记忆', path: 'M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1zM12 5v15M6 8h3M6 12h3M15 8h3M15 12h3' },
  { id: 'settings', label: '设置', path: 'M10 2h4l.6 2.2 1.4.6 2-1.1 2.3 2.3-1.1 2 .6 1.4L22 10v4l-2.2.6-.6 1.4 1.1 2-2.3 2.3-2-1.1-1.4.6L14 22h-4l-.6-2.2-1.4-.6-2 1.1L3.7 18l1.1-2-.6-1.4L2 14v-4l2.2-.6.6-1.4-1.1-2L6 3.7l2 1.1 1.4-.6L10 2zM15.5 12a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0z' }
]

export default function WorkspaceNav({ activePage, onNavigate, status }: { activePage: WorkspacePage; onNavigate: (page: WorkspacePage) => void; status: string }) {
  const [openTaskCount, setOpenTaskCount] = useState(0)
  useEffect(() => {
    const refresh = () => { void window.electronAPI.tasks.list().then(result => setOpenTaskCount(result.open.length)).catch(() => {}) }
    refresh()
    window.addEventListener('chouyu:tasks-changed', refresh)
    return () => window.removeEventListener('chouyu:tasks-changed', refresh)
  }, [])
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')]
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
    buttons[next]?.focus()
  }

  return <nav className="workspace-nav" aria-label="全局导航" onKeyDown={handleKeyDown}>
    <div className="workspace-brand" title={`ChouYu · ${status}`} aria-label={`ChouYu · ${status}`} role="status">
      <svg width="36" height="36" viewBox="0 0 80 80" aria-hidden="true">
        <circle cx="40" cy="44" r="28" fill="var(--accent)" />
        <ellipse cx="30" cy="38" rx="4" ry="5" fill="white" />
        <ellipse cx="50" cy="38" rx="4" ry="5" fill="white" />
        <circle cx="30" cy="39" r="2.5" fill="#2d2d2d" />
        <circle cx="50" cy="39" r="2.5" fill="#2d2d2d" />
        <path d="M 32 52 Q 40 58 48 52" stroke="#2d2d2d" fill="none" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </div>
    {pages.map(page => <button key={page.id} type="button" className={`workspace-nav-item${page.id === 'settings' ? ' workspace-nav-bottom' : ''}`}
      data-workspace-nav={page.id} aria-label={page.label} title={page.label}
      aria-current={activePage === page.id ? 'page' : undefined} onClick={() => onNavigate(page.id)}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={page.path}/></svg>
      {page.id === 'tasks' && openTaskCount > 0 && <span className="workspace-nav-badge" aria-label={`${openTaskCount} 个未完成任务`}>{openTaskCount > 99 ? '99+' : openTaskCount}</span>}
    </button>)}
  </nav>
}
