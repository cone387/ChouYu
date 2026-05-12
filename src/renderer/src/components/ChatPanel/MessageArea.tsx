import { useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import { Message } from '../../shared/types'

interface MessageAreaProps {
  messages: Message[]
  isStreaming: boolean
}

function formatTime(ts: number) {
  const d = new Date(ts)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
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
          {msg.role === 'assistant' && (
            <div className="message-avatar">
              <svg width="28" height="28" viewBox="0 0 80 80">
                <circle cx="40" cy="44" r="28" fill="#6C5CE7"/>
                <ellipse cx="30" cy="38" rx="4" ry="5" fill="white"/>
                <ellipse cx="50" cy="38" rx="4" ry="5" fill="white"/>
                <circle cx="30" cy="39" r="2.5" fill="#2d2d2d"/>
                <circle cx="50" cy="39" r="2.5" fill="#2d2d2d"/>
                <path d="M 32 52 Q 40 58 48 52" stroke="#2d2d2d" fill="none" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </div>
          )}
          <div className="message-body">
            <div className="message-bubble">
              {msg.role === 'assistant' ? (
                <ReactMarkdown>{msg.content}</ReactMarkdown>
              ) : (
                <span>{msg.content}</span>
              )}
            </div>
            <span className="message-time">{formatTime(msg.timestamp)}</span>
          </div>
        </div>
      ))}
      {isStreaming && messages[messages.length - 1]?.role !== 'assistant' && (
        <div className="message message-assistant">
          <div className="message-avatar">
            <svg width="28" height="28" viewBox="0 0 80 80">
              <circle cx="40" cy="44" r="28" fill="#6C5CE7"/>
              <ellipse cx="30" cy="38" rx="4" ry="5" fill="white"/>
              <ellipse cx="50" cy="38" rx="4" ry="5" fill="white"/>
              <circle cx="30" cy="39" r="2.5" fill="#2d2d2d"/>
              <circle cx="50" cy="39" r="2.5" fill="#2d2d2d"/>
              <path d="M 32 52 Q 40 58 48 52" stroke="#2d2d2d" fill="none" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </div>
          <div className="message-body">
            <div className="message-bubble typing-indicator">
              <span></span><span></span><span></span>
            </div>
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  )
}
