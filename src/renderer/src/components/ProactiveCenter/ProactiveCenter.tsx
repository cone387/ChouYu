import type { ProactiveMessage } from '../../core/proactive'
import './ProactiveCenter.css'

interface ProactiveCenterProps {
  messages: ProactiveMessage[]
  position: { left: number; top: number }
  onClose(): void
  onSnooze(id: string): void
  onRemove(id: string): void
  onClear(): void
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  const today = new Date()
  const sameDay = date.toDateString() === today.toDateString()
  return new Intl.DateTimeFormat('zh-CN', sameDay
    ? { hour: '2-digit', minute: '2-digit' }
    : { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }
  ).format(date)
}

export default function ProactiveCenter({ messages, position, onClose, onSnooze, onRemove, onClear }: ProactiveCenterProps) {
  return (
    <aside data-interactive className="proactive-center" style={position} aria-label="助手消息" aria-live="polite">
      <header>
        <div>
          <h2>助手消息</h2>
          <p>{messages.length ? `已保存 ${messages.length} 条` : '主动提醒会保存在这里'}</p>
        </div>
        <button className="proactive-center-close" onClick={onClose} aria-label="关闭助手消息">×</button>
      </header>

      <div className="proactive-center-list">
        {messages.length === 0 ? (
          <div className="proactive-center-empty">
            <span aria-hidden="true">◌</span>
            <p>还没有助手消息</p>
            <small>问候、休息提醒和工作恢复提示都会留在这里。</small>
          </div>
        ) : messages.map(item => (
          <article key={item.id} className="proactive-center-item">
            <time dateTime={new Date(item.createdAt).toISOString()}>{formatTime(item.createdAt)}</time>
            <p>{item.message}</p>
            {item.snoozedUntil && item.snoozedUntil > Date.now() && (
              <small>将在 {formatTime(item.snoozedUntil)} 再提醒</small>
            )}
            <div className="proactive-center-actions">
              <button onClick={() => onSnooze(item.id)}>10 分钟后提醒</button>
              <button onClick={() => onRemove(item.id)}>删除</button>
            </div>
          </article>
        ))}
      </div>

      {messages.length > 0 && <footer><button onClick={onClear}>清空全部消息</button></footer>}
    </aside>
  )
}
