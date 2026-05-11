interface TopBarProps {
  status: string
  showHistory: boolean
  onToggleHistory: () => void
  onNewTopic: () => void
  onClose: () => void
}

export default function TopBar({ status, showHistory, onToggleHistory, onNewTopic, onClose }: TopBarProps) {
  return (
    <div className="chat-topbar">
      <div className="chat-topbar-left">
        <span className="chat-topbar-name">ChouYu</span>
        <span className="chat-topbar-dot">·</span>
        <span className="chat-topbar-status">{status}</span>
      </div>
      <div className="chat-topbar-actions">
        <button
          className={`topbar-btn${showHistory ? ' topbar-btn-active' : ''}`}
          onClick={onToggleHistory}
          title={showHistory ? '隐藏消息' : '显示消息'}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M2 5h10M2 9h6"/>
          </svg>
        </button>
        <button className="topbar-btn" onClick={onNewTopic} title="新话题">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M7 2v10M2 7h10"/>
          </svg>
        </button>
        <button className="topbar-btn" onClick={onClose} title="关闭">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M3 3l8 8M11 3l-8 8"/>
          </svg>
        </button>
      </div>
    </div>
  )
}
