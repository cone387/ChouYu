import type { KeyboardEvent } from 'react'
import { PET_ICON_SVG } from '../../../../shared/pet-icon'
import './Workspace.css'

export type WorkspacePage = 'chat' | 'journal' | 'memory' | 'settings'
const petIconUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(PET_ICON_SVG)}`

const pages: { id: WorkspacePage; label: string; path: string }[] = [
  { id: 'chat', label: '会话', path: 'M4 4h16v12H9l-5 4V4zM8 8h8M8 12h5' },
  { id: 'journal', label: '活动', path: 'M12 3a9 9 0 1 1-9 9 9 9 0 0 1 9-9zM12 7v5l3 2' },
  { id: 'memory', label: '记忆', path: 'M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1zM12 5v15M6 8h3M6 12h3M15 8h3M15 12h3' },
  { id: 'settings', label: '设置', path: 'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1 1-3zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z' }
]

export default function WorkspaceNav({ activePage, onNavigate }: { activePage: WorkspacePage; onNavigate: (page: WorkspacePage) => void }) {
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
    <div className="workspace-brand" title="ChouYu" aria-label="ChouYu">
      <img width="36" height="36" src={petIconUrl} alt="" />
    </div>
    {pages.map(page => <button key={page.id} type="button" className={`workspace-nav-item${page.id === 'settings' ? ' workspace-nav-bottom' : ''}`}
      data-workspace-nav={page.id} aria-label={page.label} title={page.label}
      aria-current={activePage === page.id ? 'page' : undefined} onClick={() => onNavigate(page.id)}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={page.path}/></svg>
    </button>)}
  </nav>
}
