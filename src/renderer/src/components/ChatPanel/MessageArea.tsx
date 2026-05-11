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

  if (messages.length === 0 && !isStreaming) {
    return null
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
