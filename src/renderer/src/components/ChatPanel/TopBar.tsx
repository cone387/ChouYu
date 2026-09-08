interface TopBarProps {
  status: string
  showSessions: boolean
  onToggleSessions: () => void
  onNewTopic: () => void
  onSearch: () => void
  searchOpen: boolean
}

export default function TopBar({ status, showSessions, onToggleSessions, onNewTopic, onSearch, searchOpen }: TopBarProps) {
  return (
    <div className="chat-topbar">
      <div className="chat-topbar-left">
        <span className="chat-topbar-name">ChouYu</span>
        <span className="chat-topbar-dot">·</span>
        <span className="chat-topbar-status">{status}</span>
      </div>
      <div className="chat-topbar-actions">
        <button type="button" className={`topbar-btn${searchOpen ? ' topbar-btn-active' : ''}`} onClick={onSearch} title={searchOpen ? '关闭搜索（Esc）' : '搜索当前对话（Ctrl+F）'} aria-label="搜索当前对话" aria-pressed={searchOpen}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>
        </button>
        <button
          className={`topbar-btn${showSessions ? ' topbar-btn-active' : ''}`}
          onClick={onToggleSessions}
          title={showSessions ? '隐藏对话列表' : '显示对话列表'}
          aria-label={showSessions ? '隐藏对话列表' : '显示对话列表'}
          aria-pressed={showSessions}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2.5 3h11v9h-7l-3 2v-2h-1zM5 6h6M5 9h4"/>
          </svg>
        </button>
        <button className="topbar-btn" onClick={onNewTopic} title="新建对话" aria-label="新建对话">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M7 2v10M2 7h10"/>
          </svg>
        </button>
      </div>
    </div>
  )
}
