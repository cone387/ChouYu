import { useEffect, useRef, useState } from 'react'
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

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <button className="copy-btn" onClick={handleCopy} title="复制">
      {copied ? '✓' : '📋'}
    </button>
  )
}

function CodeBlock({ className, children }: { className?: string; children: string }) {
  const lang = className?.replace('language-', '') || ''
  return (
    <div className="code-block">
      <div className="code-block-header">
        <span className="code-block-lang">{lang}</span>
        <CopyButton text={children.replace(/\n$/, '')} />
      </div>
      <pre><code>{children}</code></pre>
    </div>
  )
}

function ImagePreview({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  return (
    <div className="image-preview-overlay" onClick={onClose}>
      <img src={src} className="image-preview-img" onClick={(e) => e.stopPropagation()} />
    </div>
  )
}

export default function MessageArea({ messages, isStreaming }: MessageAreaProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const [previewImage, setPreviewImage] = useState<string | null>(null)

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
              {msg.imageUrl && (
                <img src={msg.imageUrl} className="message-image" alt="截图" onClick={() => setPreviewImage(msg.imageUrl!)} />
              )}
              {msg.role === 'assistant' ? (
                <ReactMarkdown
                  components={{
                    code({ className, children }) {
                      const isBlock = className || String(children).includes('\n')
                      if (isBlock) {
                        return <CodeBlock className={className}>{String(children)}</CodeBlock>
                      }
                      return <code>{children}</code>
                    }
                  }}
                >{msg.content}</ReactMarkdown>
              ) : (
                msg.content && <span>{msg.content}</span>
              )}
            </div>
            <div className="message-meta">
              <span className="message-time">{formatTime(msg.timestamp)}</span>
              {msg.role === 'assistant' && msg.content && (
                <CopyButton text={msg.content} />
              )}
            </div>
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
      {previewImage && <ImagePreview src={previewImage} onClose={() => setPreviewImage(null)} />}
    </div>
  )
}
