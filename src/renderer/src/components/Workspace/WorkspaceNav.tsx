import type { KeyboardEvent } from 'react'
import { PET_ICON_SVG } from '../../../../shared/pet-icon'
import './Workspace.css'

export type WorkspacePage = 'chat' | 'journal' | 'memory' | 'settings'
const petIconUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(PET_ICON_SVG)}`

const pages: { id: WorkspacePage; label: string; path: string }[] = [
  { id: 'chat', label: '会话', path: 'M4 4h16v12H9l-5 4V4zM8 8h8M8 12h5' },
  { id: 'journal', label: '活动', path: 'M12 3a9 9 0 1 1-9 9 9 9 0 0 1 9-9zM12 7v5l3 2' },
  { id: 'memory', label: '记忆', path: 'M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1zM12 5v15M6 8h3M6 12h3M15 8h3M15 12h3' },
  { id: 'settings', label: '设置', path: 'M10 2h4l.6 2.2 1.4.6 2-1.1 2.3 2.3-1.1 2 .6 1.4L22 10v4l-2.2.6-.6 1.4 1.1 2-2.3 2.3-2-1.1-1.4.6L14 22h-4l-.6-2.2-1.4-.6-2 1.1L3.7 18l1.1-2-.6-1.4L2 14v-4l2.2-.6.6-1.4-1.1-2L6 3.7l2 1.1 1.4-.6L10 2zM15.5 12a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0z' }
]

export default function WorkspaceNav({ activePage, onNavigate, status }: { activePage: WorkspacePage; onNavigate: (page: WorkspacePage) => void; status: string }) {
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
      <img width="36" height="36" src={petIconUrl} alt="" />
      <i className={`workspace-brand-status${status !== '在线' ? ' is-busy' : ''}`} aria-hidden="true" />
    </div>
    {pages.map(page => <button key={page.id} type="button" className={`workspace-nav-item${page.id === 'settings' ? ' workspace-nav-bottom' : ''}`}
      data-workspace-nav={page.id} aria-label={page.label} title={page.label}
      aria-current={activePage === page.id ? 'page' : undefined} onClick={() => onNavigate(page.id)}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={page.path}/></svg>
    </button>)}
  </nav>
}
