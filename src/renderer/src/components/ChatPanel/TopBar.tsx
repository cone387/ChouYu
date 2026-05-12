interface TopBarProps {
  status: string
  showHistory: boolean
  onToggleHistory: () => void
  onNewTopic: () => void
  onSettings: () => void
  onClose: () => void
}

export default function TopBar({ status, showHistory, onToggleHistory, onNewTopic, onSettings, onClose }: TopBarProps) {
  return (
    <div className="chat-topbar">
      <div className="chat-topbar-left">
        <div className="topbar-avatar">
          <svg width="20" height="20" viewBox="0 0 80 80">
            <circle cx="40" cy="44" r="28" fill="#6C5CE7"/>
            <ellipse cx="30" cy="38" rx="4" ry="5" fill="white"/>
            <ellipse cx="50" cy="38" rx="4" ry="5" fill="white"/>
            <circle cx="30" cy="39" r="2.5" fill="#2d2d2d"/>
            <circle cx="50" cy="39" r="2.5" fill="#2d2d2d"/>
            <path d="M 32 52 Q 40 58 48 52" stroke="#2d2d2d" fill="none" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </div>
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
        <button className="topbar-btn" onClick={onSettings} title="设置">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        </button>
        <button className="topbar-btn" onClick={onNewTopic} title="清空对话，开始新话题">
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
