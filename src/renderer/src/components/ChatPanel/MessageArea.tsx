import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Message } from '../../shared/types'
import PluginMessageCard from './PluginMessageCard'
import { getConversationForRetry } from '../../core/conversation-actions'

interface MessageAreaProps {
  messages: Message[]
  isStreaming: boolean
  onRetry?: (messageId: string) => void
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
    <button className="copy-btn" onClick={handleCopy} title="复制" aria-label={copied ? '已复制' : '复制内容'}>
      {copied ? '✓' : (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <rect x="5" y="5" width="8" height="8" rx="1"/><path d="M3 11H2.5A1.5 1.5 0 011 9.5v-7A1.5 1.5 0 012.5 1h7A1.5 1.5 0 0111 2.5V3"/>
        </svg>
      )}
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
    <div className="image-preview-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="图片预览">
      <img src={src} className="image-preview-img" alt="对话附件预览" onClick={(e) => e.stopPropagation()} />
      <button className="image-preview-close" onClick={onClose} aria-label="关闭图片预览">×</button>
    </div>
  )
}

export default function MessageArea({ messages, isStreaming, onRetry }: MessageAreaProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const [previewImage, setPreviewImage] = useState<string | null>(null)

  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    bottomRef.current?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' })
  }, [messages])

  if (messages.length === 0 && !isStreaming) {
    return null
  }

  return (
    <div className="message-area" aria-live="polite" aria-busy={isStreaming}>
      {messages.map((msg) => {
        const canRetry = !isStreaming && getConversationForRetry(messages, msg.id) !== null
        return (
        <div key={msg.id} className={`message message-${msg.role}${msg.responseStatus ? ` message-${msg.responseStatus}` : ''}`}>
          {msg.role === 'assistant' && (
            <div className="message-avatar" aria-hidden="true">
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
              {msg.pluginData ? (
                <PluginMessageCard data={msg.pluginData} />
              ) : msg.role === 'assistant' ? (
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
              {msg.responseStatus === 'stopped' && <span className="message-state">已停止</span>}
              {msg.role === 'assistant' && msg.content && (
                <CopyButton text={msg.content} />
              )}
              {canRetry && (
                <button
                  className="message-retry-btn"
                  onClick={() => onRetry?.(msg.id)}
                  aria-label={msg.responseStatus === 'error' ? '重试失败的回复' : '重新生成回复'}
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M13 5V2l-2 2A5.5 5.5 0 1013.5 8"/>
                  </svg>
                  {msg.responseStatus === 'error' ? '重试' : '重新生成'}
                </button>
              )}
            </div>
          </div>
        </div>
        )
      })}
      {isStreaming && messages[messages.length - 1]?.role !== 'assistant' && (
        <div className="message message-assistant">
          <div className="message-avatar" aria-hidden="true">
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
            <div className="message-bubble typing-indicator" role="status" aria-label="AI 正在回复">
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
