interface TopBarProps {
  status: string
  onNewTopic: () => void
  onClose: () => void
}

export default function TopBar({ status, onNewTopic, onClose }: TopBarProps) {
  return (
    <div className="chat-topbar">
      <div className="chat-topbar-left">
        <div className="chat-topbar-avatar">
          <svg width="24" height="24" viewBox="0 0 80 80">
            <circle cx="40" cy="44" r="28" fill="#6C5CE7" />
            <ellipse cx="30" cy="38" rx="3" ry="4" fill="white" />
            <ellipse cx="50" cy="38" rx="3" ry="4" fill="white" />
            <circle cx="30" cy="39" r="2" fill="#2d2d2d" />
            <circle cx="50" cy="39" r="2" fill="#2d2d2d" />
          </svg>
        </div>
        <div className="chat-topbar-info">
          <span className="chat-topbar-name">ChouYu</span>
          <span className="chat-topbar-status">{status}</span>
        </div>
      </div>
      <div className="chat-topbar-actions">
        <button className="topbar-btn" onClick={onNewTopic} title="新话题">+</button>
        <button className="topbar-btn" onClick={onClose} title="关闭">&times;</button>
      </div>
    </div>
  )
}
