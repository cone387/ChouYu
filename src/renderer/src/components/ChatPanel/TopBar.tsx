interface TopBarProps {
  status: string
  onNewTopic: () => void
  onClose: () => void
}

export default function TopBar({ status, onNewTopic, onClose }: TopBarProps) {
  return (
    <div className="chat-topbar">
      <div className="chat-topbar-left">
        <span className="chat-topbar-name">ChouYu</span>
        <span className="chat-topbar-status">{status}</span>
      </div>
      <div className="chat-topbar-actions">
        <button className="topbar-btn" onClick={onNewTopic} title="新话题">+</button>
        <button className="topbar-btn" onClick={onClose} title="关闭">&times;</button>
      </div>
    </div>
  )
}
