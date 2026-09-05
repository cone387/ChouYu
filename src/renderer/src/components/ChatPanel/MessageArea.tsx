import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Message } from '../../shared/types'
import type { MemoryFeedbackValue } from '../../../../shared/memory'
import PluginMessageCard from './PluginMessageCard'
import ToolActivityCard from './ToolActivityCard'
import { getConversationForRetry } from '../../core/conversation-actions'
import { highlightCode, isSupportedLanguage } from '../../core/highlight'
import { useMessageWindow } from './useMessageWindow'

interface MessageAreaProps {
  messages: Message[]
  isStreaming: boolean
  onRetry?: (messageId: string) => void
  onEditMessage?: (messageId: string, newContent: string) => void
  onContinueMessage?: (messageId: string) => void
  contextLimit?: number
  onMemoryFeedback?: (messageId: string, memoryId: string, sourceIds: string[] | undefined, value: MemoryFeedbackValue) => Promise<void>
  onCorrectMemory?: (memoryId: string) => void
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
  const raw = children.replace(/\n$/, '')
  // Highlighting loads lazily: plain text shows immediately, colors arrive once
  // the highlighter chunk is ready (first code block in a session pays the cost).
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null)
  useEffect(() => {
    // Unsupported languages render plain text; also clear stale colors when
    // the block's language changes to one we cannot highlight.
    if (!isSupportedLanguage(lang)) {
      setHighlightedHtml(null)
      return
    }
    let cancelled = false
    void highlightCode(raw, lang).then((html) => {
      if (!cancelled) setHighlightedHtml(html)
    })
    return () => { cancelled = true }
  }, [raw, lang])
  return (
    <div className="code-block">
      <div className="code-block-header">
        <span className="code-block-dots" aria-hidden="true">
          <i /><i /><i />
        </span>
        <span className="code-block-lang">{lang}</span>
        <CopyButton text={raw} />
      </div>
      {highlightedHtml !== null ? (
        <pre><code className="hljs" dangerouslySetInnerHTML={{ __html: highlightedHtml }} /></pre>
      ) : (
        <pre><code>{children}</code></pre>
      )}
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

export default function MessageArea({ messages, isStreaming, onRetry, onEditMessage, onContinueMessage, contextLimit, onMemoryFeedback, onCorrectMemory }: MessageAreaProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [feedbackBusy, setFeedbackBusy] = useState('')
  const [feedbackError, setFeedbackError] = useState('')
  const [editingId, setEditingId] = useState('')
  const [editDraft, setEditDraft] = useState('')
  const commitEdit = (messageId: string) => {
    if (isStreaming) return
    const draft = editDraft
    setEditingId('')
    if (!draft.trim()) return
    onEditMessage?.(messageId, draft)
  }
  // Identify the session by its earliest message id: switching sessions resets
  // the window, while streaming (appending) must not.
  const sessionKey = messages.length > 0 ? messages[0].id : ''
  const windowed = useMessageWindow(scrollRef, messages.length, [sessionKey])

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

  // Short lists render directly: windowing only pays off with many messages.
  const useWindowing = messages.length > 40
  const start = useWindowing ? windowed.start : 0
  const end = useWindowing ? windowed.end : messages.length
  const visibleMessages = messages.slice(start, end)

  return (
    <div className="message-area" ref={scrollRef} aria-live="polite" aria-busy={isStreaming}>
      {contextLimit && messages.length > contextLimit && (
        <div className="context-limit-notice" role="status">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
            <circle cx="8" cy="8" r="6"/><path d="M8 7v4M8 4.5v.5"/>
          </svg>
          会话已保存 {messages.length} 条消息；发送给模型时仅使用最近 {contextLimit} 条。
        </div>
      )}
      {useWindowing && start > 0 && (
        <div style={{ height: windowed.startOffset }} aria-hidden="true" />
      )}
      {visibleMessages.map((msg, offset) => {
        const index = start + offset
        const canRetry = !isStreaming && getConversationForRetry(messages, msg.id) !== null
        const memorySourceCount = msg.memoryRefs?.reduce((total, memory) => total + (memory.compressedCount || 1), 0) || 0
        return (
        <div
          key={msg.id}
          ref={(node) => {
            if (node && useWindowing) windowed.measureRow(index, node.offsetHeight)
          }}
          className={`message message-${msg.role}${msg.responseStatus ? ` message-${msg.responseStatus}` : ''}`}
        >
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
                    },
                    // react-markdown keeps its own <pre> around fenced code; the card
                    // renders its own pre, so unwrap to avoid nesting card-in-pre.
                    pre({ children }) {
                      return <>{children}</>
                    }
                  }}
                >{msg.content}</ReactMarkdown>
              ) : msg.id === editingId ? (
                <div className="message-edit">
                  <textarea
                    className="message-edit-textarea"
                    value={editDraft}
                    autoFocus
                    aria-label="编辑消息内容"
                    onChange={(e) => setEditDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        e.preventDefault()
                        setEditingId('')
                      } else if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        commitEdit(msg.id)
                      }
                    }}
                  />
                  {index < messages.length - 1 && (
                    <div className="message-edit-warning" role="status">
                      保存将删除之后的 {messages.length - 1 - index} 条消息
                    </div>
                  )}
                  <div className="message-edit-actions">
                    <button type="button" onClick={() => setEditingId('')}>取消</button>
                    <button type="button" className="primary" onClick={() => commitEdit(msg.id)} disabled={!editDraft.trim() || isStreaming}>保存并重发</button>
                  </div>
                </div>
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
              {msg.role === 'user' && !isStreaming && !msg.toolData && !msg.pluginData && onEditMessage && msg.id !== editingId && (
                <button
                  className="message-edit-btn"
                  onClick={() => { setEditingId(msg.id); setEditDraft(msg.content) }}
                  aria-label="编辑这条消息"
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M11.3 2.7l2 2L6 12l-3 1 1-3z"/>
                  </svg>
                  编辑
                </button>
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
              {!isStreaming && index === messages.length - 1 && msg.role === 'assistant' && msg.responseStatus === 'stopped' && !msg.toolData && !msg.pluginData && onContinueMessage && (
                <button
                  className="message-continue-btn"
                  onClick={() => onContinueMessage(msg.id)}
                  aria-label="继续生成这条回复"
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M4 2.5v11l9-5.5z"/>
                  </svg>
                  继续生成
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
                        {memory.feedback === 'unhelpful' && <button type="button" className="correct" onClick={() => onCorrectMemory?.(memory.sourceIds?.[0] || memory.id)}>去修正</button>}
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
      {useWindowing && end < messages.length && (
        <div style={{ height: windowed.endOffset }} aria-hidden="true" />
      )}
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
