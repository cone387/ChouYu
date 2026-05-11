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
        <span className="chat-topbar-status">{status}</span>
      </div>
      <div className="chat-topbar-actions">
        <button
          className={`topbar-btn${showHistory ? ' topbar-btn-active' : ''}`}
          onClick={onToggleHistory}
          title={showHistory ? '隐藏消息' : '显示消息'}
        >
          {showHistory ? '▼' : '▲'}
        </button>
        <button className="topbar-btn" onClick={onNewTopic} title="新话题">+</button>
        <button className="topbar-btn" onClick={onClose} title="关闭">&times;</button>
      </div>
    </div>
  )
}
