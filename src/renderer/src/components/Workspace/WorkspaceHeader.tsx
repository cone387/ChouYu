import { useEffect, useRef, useState, type HTMLAttributes } from 'react'
import type { WorkspaceMode } from '../../core/workspace-state'

const modes: { id: WorkspaceMode; label: string; detail: string }[] = [
  { id: 'chat', label: '仅聊天', detail: '只显示聊天内容' },
  { id: 'sessions', label: '会话与聊天', detail: '会话列表＋聊天内容' },
  { id: 'workspace', label: '完整工作区', detail: '全局导航与所有页面' }
]

export default function WorkspaceHeader({ onHide, onClose, dragHandleProps, maximized, onMaximize, mode, onModeChange, onSearch }: {
  onSearch: () => void
  onHide: () => void
  onClose: () => void
  dragHandleProps: HTMLAttributes<HTMLDivElement>
  maximized: boolean
  onMaximize: () => void
  mode: WorkspaceMode
  onModeChange: (mode: WorkspaceMode) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!menuOpen) return
    menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus()
    const outside = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false) }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setMenuOpen(false); triggerRef.current?.focus() }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape, true)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true) }
  }, [menuOpen])
  return <div className="workspace-header chat-panel-drag-handle" {...dragHandleProps}
    onDoubleClick={event => { if (!(event.target as HTMLElement).closest('button, [role="menu"]')) onMaximize() }}>
    <button type="button" className="workspace-search-trigger" onClick={onSearch} aria-label="全局搜索" title="全局搜索（⌘K / Ctrl+K）">
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>
      <span>搜索会话、日志、记忆…</span><kbd>{navigator.platform.includes('Mac') ? '⌘ K' : 'Ctrl K'}</kbd>
    </button>
    <div className="workspace-mode-control" ref={menuRef}>
      <button ref={triggerRef} type="button" className="topbar-btn" aria-label="窗口模式" title="窗口模式" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(value => !value)}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M5 2.5v11M8 2.5v11"/></svg>
      </button>
      {menuOpen && <div className="workspace-mode-menu" role="menu" aria-label="选择窗口模式"
        onKeyDown={event => {
          if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')]
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
          buttons[next]?.focus()
        }}>
        {modes.map(item => <button type="button" key={item.id} role="menuitemradio" aria-checked={mode === item.id} data-workspace-mode-option={item.id}
          onClick={() => { onModeChange(item.id); setMenuOpen(false); triggerRef.current?.focus() }}>
          <span>{item.label}</span><small>{item.detail}</small>
        </button>)}
      </div>}
    </div>
    <div className="chat-topbar-actions">
      <button type="button" className="topbar-btn" aria-label="隐藏面板" title="隐藏面板" onClick={onHide}><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 7h8"/></svg></button>
      <button type="button" className="topbar-btn" aria-label={maximized ? '还原窗口' : '最大化窗口'} title={maximized ? '还原窗口' : '最大化窗口'} onClick={onMaximize}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">{maximized ? <path d="M6 5V2h8v8h-3M2 6h8v8H2z"/> : <rect x="3" y="3" width="10" height="10" rx=".5"/>}</svg>
      </button>
      <button type="button" className="topbar-btn" aria-label="关闭面板" title="关闭面板" onClick={onClose}><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m3 3 8 8M11 3l-8 8"/></svg></button>
    </div>
  </div>
}
