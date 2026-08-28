import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Message } from '../../shared/types'
import type { MemoryFeedbackValue } from '../../../../shared/memory'
import PluginMessageCard from './PluginMessageCard'
import ToolActivityCard from './ToolActivityCard'
import { getConversationForRetry } from '../../core/conversation-actions'

interface MessageAreaProps {
  messages: Message[]
  isStreaming: boolean
  onRetry?: (messageId: string) => void
  contextLimit?: number
  onMemoryFeedback?: (messageId: string, memoryId: string, sourceIds: string[] | undefined, value: MemoryFeedbackValue) => Promise<void>
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

export default function MessageArea({ messages, isStreaming, onRetry, contextLimit, onMemoryFeedback }: MessageAreaProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [feedbackBusy, setFeedbackBusy] = useState('')
  const [feedbackError, setFeedbackError] = useState('')

  const submitMemoryFeedback = async (messageId: string, memoryId: string, sourceIds: string[] | undefined, value: MemoryFeedbackValue) => {
    if (!onMemoryFeedback) return
    const key = `${messageId}:${memoryId}`
    setFeedbackBusy(key)
    setFeedbackError('')
    try {
      await onMemoryFeedback(messageId, memoryId, sourceIds, value)
    } catch (error) {
      setFeedbackError(error instanceof Error ? error.message : '记忆反馈保存失败。')
    } finally {
      setFeedbackBusy('')
    }
  }

  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    bottomRef.current?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' })
  }, [messages])

  if (messages.length === 0 && !isStreaming) {
    return null
  }

  return (
    <div className="message-area" aria-live="polite" aria-busy={isStreaming}>
      {contextLimit && messages.length > contextLimit && (
        <div className="context-limit-notice" role="status">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
            <circle cx="8" cy="8" r="6"/><path d="M8 7v4M8 4.5v.5"/>
          </svg>
          会话已保存 {messages.length} 条消息；发送给模型时仅使用最近 {contextLimit} 条。
        </div>
      )}
      {messages.map((msg) => {
        const canRetry = !isStreaming && getConversationForRetry(messages, msg.id) !== null
        const memorySourceCount = msg.memoryRefs?.reduce((total, memory) => total + (memory.compressedCount || 1), 0) || 0
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
              {msg.toolData ? (
                <ToolActivityCard data={msg.toolData} />
              ) : msg.pluginData ? (
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
              {msg.role === 'assistant' && msg.content && !msg.toolData && (
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
            {msg.role === 'assistant' && msg.memoryRefs && msg.memoryRefs.length > 0 && (
              <details className="message-memory-refs">
                <summary>使用了 {memorySourceCount} 条长期记忆{memorySourceCount > msg.memoryRefs.length ? ` · 压缩为 ${msg.memoryRefs.length} 个主题` : ''}</summary>
                <ul>
                  {msg.memoryRefs.map((memory) => {
                    const key = `${msg.id}:${memory.id}`
                    return <li key={memory.id}>
                      <div><span>{memory.type}</span><p>{memory.content}</p>{memory.compressedCount && <em>合并 {memory.compressedCount} 条</em>}</div>
                      <div className="memory-ref-feedback" aria-label="评价这条记忆来源">
                        <button type="button" className={memory.feedback === 'helpful' ? 'selected' : ''} disabled={feedbackBusy === key || memory.feedback === 'helpful'} onClick={() => { void submitMemoryFeedback(msg.id, memory.id, memory.sourceIds, 'helpful') }} aria-label="这条记忆有帮助" title="有帮助">
                          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5.5 7L8 2.5c.5-.8 1.7-.4 1.6.6L9.3 6h3.1a1.4 1.4 0 011.3 1.8l-1.4 4.3a1.5 1.5 0 01-1.4 1H5.5M2 6.5h3.5v7H2z"/></svg>
                          有帮助
                        </button>
                        <button type="button" className={memory.feedback === 'unhelpful' ? 'selected negative' : ''} disabled={feedbackBusy === key || memory.feedback === 'unhelpful'} onClick={() => { void submitMemoryFeedback(msg.id, memory.id, memory.sourceIds, 'unhelpful') }} aria-label="这条记忆不准确" title="不准确">
                          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5.5 9L8 13.5c.5.8 1.7.4 1.6-.6L9.3 10h3.1a1.4 1.4 0 001.3-1.8l-1.4-4.3a1.5 1.5 0 00-1.4-1H5.5M2 2.5h3.5v7H2z"/></svg>
                          不准确
                        </button>
                      </div>
                    </li>
                  })}
                </ul>
                {feedbackError && <div className="memory-ref-feedback-error" role="alert">{feedbackError}</div>}
              </details>
            )}
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
