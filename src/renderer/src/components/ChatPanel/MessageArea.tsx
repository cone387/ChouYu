import { useEffect, useRef } from 'react'
import { Message } from '../../shared/types'

interface MessageAreaProps {
  messages: Message[]
  isStreaming: boolean
}

export default function MessageArea({ messages, isStreaming }: MessageAreaProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  if (messages.length === 0) {
    return (
      <div className="message-area message-area-empty">
        <p>你好！有什么我可以帮你的吗？</p>
        <p className="message-hint">输入消息开始对话，/ 打开指令菜单</p>
      </div>
    )
  }

  return (
    <div className="message-area">
      {messages.map((msg) => (
        <div key={msg.id} className={`message message-${msg.role}`}>
          <div className="message-content">{msg.content}</div>
        </div>
      ))}
      {isStreaming && (
        <div className="message message-assistant">
          <div className="message-content typing-indicator">
            <span></span><span></span><span></span>
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  )
}
