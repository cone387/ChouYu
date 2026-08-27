import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChatSessionSummary } from '../../shared/types'
import { filterSessionSummaries } from '../../../../shared/sessions'
import './ConversationSidebar.css'

interface ConversationSidebarProps {
  sessions: ChatSessionSummary[]
  activeSessionId: string
  onClose: () => void
  onCreate: () => Promise<void>
  onSelect: (id: string) => Promise<void>
  onRename: (id: string, title: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onExport: (id: string) => Promise<boolean>
}

function formatSessionTime(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

export default function ConversationSidebar({
  sessions,
  activeSessionId,
  onClose,
  onCreate,
  onSelect,
  onRename,
  onDelete,
  onExport
}: ConversationSidebarProps) {
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState('')
  const [feedbackType, setFeedbackType] = useState<'success' | 'error'>('error')
  const renameInputRef = useRef<HTMLInputElement>(null)
  const cancelRenameRef = useRef(false)
  const filteredSessions = useMemo(() => filterSessionSummaries(sessions, query), [sessions, query])
  const deletingSession = sessions.find((session) => session.id === deletingId)

  useEffect(() => {
    if (!deletingId) return
    const cancelDelete = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopImmediatePropagation()
        setDeletingId(null)
      }
    }
    window.addEventListener('keydown', cancelDelete, true)
    return () => window.removeEventListener('keydown', cancelDelete, true)
  }, [deletingId])

  const run = async (id: string, action: () => Promise<void>) => {
    setBusyId(id)
    setFeedback('')
    try {
      await action()
    } catch (error) {
      setFeedbackType('error')
      setFeedback(error instanceof Error ? error.message : '操作失败，请重试。')
    } finally {
      setBusyId(null)
    }
  }

  const startRename = (session: ChatSessionSummary) => {
    cancelRenameRef.current = false
    setEditingId(session.id)
    setEditingTitle(session.title)
    requestAnimationFrame(() => {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    })
  }

  const commitRename = async () => {
    if (!editingId) return
    if (!editingTitle.trim()) {
      setEditingId(null)
      return
    }
    const id = editingId
    await run(id, async () => {
      await onRename(id, editingTitle)
      setEditingId(null)
    })
  }

  return (
    <aside className="conversation-sidebar" aria-label="对话历史">
      <div className="conversation-sidebar-header">
        <div>
          <h2>对话</h2>
          <span>{sessions.length} 个会话</span>
        </div>
        <div className="conversation-sidebar-header-actions">
          <button
            type="button"
            className="conversation-icon-btn primary"
            onClick={() => { void run('new', onCreate) }}
            disabled={busyId === 'new'}
            aria-label="新建对话"
            title="新建对话"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <path d="M8 3v10M3 8h10"/>
            </svg>
          </button>
          <button type="button" className="conversation-icon-btn" onClick={onClose} aria-label="关闭对话列表" title="关闭">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
              <path d="M3 3l8 8M11 3l-8 8"/>
            </svg>
          </button>
        </div>
      </div>

      <label className="conversation-search">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
          <circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/>
        </svg>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题或内容…" aria-label="搜索对话" />
        {query && <button type="button" onClick={() => setQuery('')} aria-label="清空对话搜索">×</button>}
      </label>

      <div className="conversation-list" role="listbox" aria-label="会话列表">
        {filteredSessions.map((session) => {
          const active = session.id === activeSessionId
          const editing = editingId === session.id
          return (
            <div key={session.id} className={`conversation-item${active ? ' active' : ''}`}>
              {editing ? (
                <div className="conversation-rename-row">
                  <input
                    ref={renameInputRef}
                    value={editingTitle}
                    maxLength={80}
                    onChange={(event) => setEditingTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() }
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        cancelRenameRef.current = true
                        setEditingId(null)
                      }
                    }}
                    onBlur={() => {
                      if (cancelRenameRef.current) {
                        cancelRenameRef.current = false
                        return
                      }
                      void commitRename()
                    }}
                    aria-label="会话标题"
                  />
                </div>
              ) : (
                <button
                  type="button"
                  className="conversation-item-main"
                  onClick={() => { if (!active) void run(session.id, () => onSelect(session.id)) }}
                  role="option"
                  aria-selected={active}
                  disabled={busyId === session.id}
                >
                  <span className="conversation-item-title">{session.title}</span>
                  <span className="conversation-item-preview">{session.preview}</span>
                  <span className="conversation-item-meta">
                    <span>{session.messageCount} 条</span>
                    <time dateTime={new Date(session.updatedAt).toISOString()}>{formatSessionTime(session.updatedAt)}</time>
                  </span>
                </button>
              )}

              {!editing && (
                <div className="conversation-item-actions">
                  <button type="button" onClick={() => startRename(session)} aria-label={`重命名 ${session.title}`} title="重命名">
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M3 13l1-4L11.5 1.5a1.4 1.4 0 012 2L6 11l-3 2z"/>
                    </svg>
                  </button>
                  <button type="button" onClick={() => {
                    void run(session.id, async () => {
                      if (await onExport(session.id)) {
                        setFeedbackType('success')
                        setFeedback('已导出为 Markdown。')
                      }
                    })
                  }} aria-label={`导出 ${session.title}`} title="导出 Markdown">
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M8 2v8M5 7l3 3 3-3M3 13h10"/>
                    </svg>
                  </button>
                  <button type="button" className="danger" onClick={() => setDeletingId(session.id)} aria-label={`删除 ${session.title}`} title="删除">
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M3 4h10M6 4V2.5h4V4M5 6.5v6M8 6.5v6M11 6.5v6M4 4l.7 10h6.6L12 4"/>
                    </svg>
                  </button>
                </div>
              )}
            </div>
          )
        })}

        {filteredSessions.length === 0 && (
          <div className="conversation-empty">
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
              <path d="M6 8h20v14H13l-5 4v-4H6V8zM11 13h10M11 17h7"/>
            </svg>
            <strong>没有匹配的对话</strong>
            <span>换个关键词，或新建一个对话。</span>
          </div>
        )}
      </div>

      {feedback && <div className={`conversation-feedback ${feedbackType}`} role={feedbackType === 'error' ? 'alert' : 'status'}>{feedback}</div>}

      {deletingSession && (
        <div className="conversation-confirm-backdrop">
          <div className="conversation-confirm" role="alertdialog" aria-modal="true" aria-labelledby="conversation-delete-title">
            <strong id="conversation-delete-title">删除“{deletingSession.title}”？</strong>
            <p>该会话及其消息将被永久删除。</p>
            <div>
              <button type="button" autoFocus onClick={() => setDeletingId(null)}>取消</button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  const id = deletingSession.id
                  void run(id, async () => { await onDelete(id); setDeletingId(null) })
                }}
              >确认删除</button>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}
