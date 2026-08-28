import { useCallback, useEffect, useState } from 'react'
import type { MemoryRecord, MemoryStats, MemoryType } from '../../../../shared/memory'
import type { AppConfig } from '../../shared/types'
import './MemorySettingsTab.css'

interface MemorySettingsTabProps {
  enabled: boolean
  onEnabledChange: (enabled: boolean) => void
  config: AppConfig
  onSaveEmbedding: (patch: Partial<AppConfig>) => Promise<void>
}

const TYPE_LABELS: Record<MemoryType, string> = {
  fact: '事实',
  preference: '偏好',
  person: '人物',
  project: '项目',
  workflow: '工作方式'
}

export default function MemorySettingsTab({ enabled, onEnabledChange, config, onSaveEmbedding }: MemorySettingsTabProps) {
  const [memories, setMemories] = useState<MemoryRecord[]>([])
  const [stats, setStats] = useState<MemoryStats>({ active: 0, pending: 0, archived: 0, databaseSize: 0, embeddings: 0 })
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'all' | 'active' | 'pending'>('all')
  const [type, setType] = useState<'all' | MemoryType>('all')
  const [editingId, setEditingId] = useState('')
  const [editingContent, setEditingContent] = useState('')
  const [newContent, setNewContent] = useState('')
  const [newType, setNewType] = useState<MemoryType>('fact')
  const [showAdd, setShowAdd] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const [showEmbedding, setShowEmbedding] = useState(config.embeddingEnabled)
  const [showEmbeddingKey, setShowEmbeddingKey] = useState(false)
  const [embeddingDraft, setEmbeddingDraft] = useState({
    embeddingBaseUrl: config.embeddingBaseUrl,
    embeddingApiKey: config.embeddingApiKey,
    embeddingModel: config.embeddingModel
  })
  const [embeddingBusy, setEmbeddingBusy] = useState<'test' | 'rebuild' | ''>('')
  const [embeddingStatus, setEmbeddingStatus] = useState('')

  const refresh = useCallback(async () => {
    setError('')
    try {
      const [items, nextStats] = await Promise.all([
        window.electronAPI.memory.list({ query, status, type, limit: 500 }),
        window.electronAPI.memory.stats()
      ])
      setMemories(items)
      setStats(nextStats)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '记忆中心加载失败。')
    }
  }, [query, status, type])

  useEffect(() => {
    const timer = setTimeout(() => { void refresh() }, 180)
    return () => clearTimeout(timer)
  }, [refresh])

  useEffect(() => {
    setEmbeddingDraft({
      embeddingBaseUrl: config.embeddingBaseUrl,
      embeddingApiKey: config.embeddingApiKey,
      embeddingModel: config.embeddingModel
    })
  }, [config.embeddingApiKey, config.embeddingBaseUrl, config.embeddingModel])

  const run = async (id: string, action: () => Promise<unknown>): Promise<boolean> => {
    setBusyId(id)
    setError('')
    try {
      await action()
      await refresh()
      return true
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '记忆操作失败。')
      return false
    } finally {
      setBusyId('')
    }
  }

  const saveEdit = async (memory: MemoryRecord) => {
    if (!editingContent.trim()) return
    if (await run(memory.id, () => window.electronAPI.memory.update(memory.id, { content: editingContent }))) setEditingId('')
  }

  const addMemory = async () => {
    if (!newContent.trim()) return
    const saved = await run('new', () => window.electronAPI.memory.create({
      type: newType,
      content: newContent,
      importance: 0.7,
      confidence: 1,
      sensitivity: 'normal'
    }))
    if (saved) {
      setNewContent('')
      setShowAdd(false)
    }
  }

  const saveEmbeddingDraft = async () => {
    await onSaveEmbedding(embeddingDraft)
  }

  const testEmbeddingConnection = async () => {
    setEmbeddingBusy('test')
    setEmbeddingStatus('正在测试 Embedding 连接…')
    try {
      await saveEmbeddingDraft()
      const result = await window.electronAPI.memory.testEmbedding()
      setEmbeddingStatus(result.message)
    } catch (reason) {
      setEmbeddingStatus(reason instanceof Error ? reason.message : 'Embedding 测试失败。')
    } finally {
      setEmbeddingBusy('')
    }
  }

  const rebuildEmbeddingIndex = async () => {
    setEmbeddingBusy('rebuild')
    setEmbeddingStatus('正在重建向量索引…')
    try {
      await saveEmbeddingDraft()
      const result = await window.electronAPI.memory.rebuildEmbeddings()
      setEmbeddingStatus(`索引完成：成功 ${result.indexed} 条，失败 ${result.failed} 条，模型 ${result.model}。`)
      await refresh()
    } catch (reason) {
      setEmbeddingStatus(reason instanceof Error ? reason.message : '向量索引重建失败。')
    } finally {
      setEmbeddingBusy('')
    }
  }

  return (
    <div className="settings-pane memory-settings-pane">
      <div className="settings-pane-heading memory-heading">
        <div>
          <h2>记忆中心</h2>
          <p>查看和控制 ChouYu 可以长期使用的信息。</p>
        </div>
        <button type="button" className="memory-add-btn" onClick={() => setShowAdd((value) => !value)}>
          {showAdd ? '取消添加' : '添加记忆'}
        </button>
      </div>

      <div className="memory-master-card">
        <div>
          <strong>启用长期记忆</strong>
          <span>关闭后不会提取、检索或向 Prompt 注入记忆，已有数据不会删除。</span>
        </div>
        <label className="settings-switch">
          <input type="checkbox" checked={enabled} onChange={(event) => onEnabledChange(event.target.checked)} aria-label="启用长期记忆" />
          <span className="settings-switch-slider" />
        </label>
      </div>

      <div className="memory-stats" aria-label="记忆统计">
        <div><strong>{stats.active}</strong><span>已确认</span></div>
        <div><strong>{stats.pending}</strong><span>待确认</span></div>
        <div><strong>{(stats.databaseSize / 1024).toFixed(1)} KB</strong><span>本地数据库</span></div>
        <div><strong>{stats.embeddings}</strong><span>向量索引</span></div>
      </div>

      <section className="memory-embedding-card">
        <div className="memory-embedding-header">
          <div>
            <strong>语义向量检索</strong>
            <span>可选功能。失败时自动退回关键词检索。</span>
          </div>
          <div>
            <label className="settings-switch">
              <input
                type="checkbox"
                checked={config.embeddingEnabled}
                onChange={(event) => {
                  setShowEmbedding(event.target.checked)
                  void onSaveEmbedding({ embeddingEnabled: event.target.checked })
                }}
                aria-label="启用语义向量检索"
              />
              <span className="settings-switch-slider" />
            </label>
            <button type="button" className="memory-embedding-expand" onClick={() => setShowEmbedding((value) => !value)} aria-expanded={showEmbedding}>
              {showEmbedding ? '收起' : '配置'}
            </button>
          </div>
        </div>
        {showEmbedding && (
          <div className="memory-embedding-fields">
            <label>
              <span>Base URL</span>
              <input
                value={embeddingDraft.embeddingBaseUrl}
                onChange={(event) => setEmbeddingDraft((previous) => ({ ...previous, embeddingBaseUrl: event.target.value }))}
                onBlur={() => { void saveEmbeddingDraft() }}
                placeholder={`留空则使用 ${config.baseUrl || 'AI Provider Base URL'}`}
              />
            </label>
            <label>
              <span>API Key</span>
              <div className="memory-embedding-key">
                <input
                  type={showEmbeddingKey ? 'text' : 'password'}
                  value={embeddingDraft.embeddingApiKey}
                  onChange={(event) => setEmbeddingDraft((previous) => ({ ...previous, embeddingApiKey: event.target.value }))}
                  onBlur={() => { void saveEmbeddingDraft() }}
                  placeholder="留空则使用 AI Provider API Key"
                />
                <button type="button" onClick={() => setShowEmbeddingKey((value) => !value)}>{showEmbeddingKey ? '隐藏' : '显示'}</button>
              </div>
            </label>
            <label>
              <span>Embedding 模型</span>
              <input
                value={embeddingDraft.embeddingModel}
                onChange={(event) => setEmbeddingDraft((previous) => ({ ...previous, embeddingModel: event.target.value }))}
                onBlur={() => { void saveEmbeddingDraft() }}
                placeholder="text-embedding-v3"
              />
            </label>
            <div className="memory-embedding-actions">
              <button type="button" onClick={() => { void testEmbeddingConnection() }} disabled={Boolean(embeddingBusy)}>{embeddingBusy === 'test' ? '测试中…' : '测试连接'}</button>
              <button type="button" className="primary" onClick={() => { void rebuildEmbeddingIndex() }} disabled={Boolean(embeddingBusy)}>{embeddingBusy === 'rebuild' ? '重建中…' : '重建全部索引'}</button>
            </div>
            {embeddingStatus && <div className="memory-embedding-status" role="status">{embeddingStatus}</div>}
          </div>
        )}
      </section>

      {showAdd && (
        <div className="memory-add-form">
          <select value={newType} onChange={(event) => setNewType(event.target.value as MemoryType)} aria-label="记忆类型">
            {Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <textarea autoFocus value={newContent} onChange={(event) => setNewContent(event.target.value)} maxLength={500} placeholder="输入需要长期记住的内容…" aria-label="新记忆内容" />
          <button type="button" onClick={() => { void addMemory() }} disabled={!newContent.trim() || busyId === 'new'}>保存记忆</button>
        </div>
      )}

      <div className="memory-toolbar">
        <label>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索记忆…" aria-label="搜索记忆" />
        </label>
        <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} aria-label="记忆状态">
          <option value="all">全部状态</option><option value="active">已确认</option><option value="pending">待确认</option>
        </select>
        <select value={type} onChange={(event) => setType(event.target.value as typeof type)} aria-label="记忆类型筛选">
          <option value="all">全部类型</option>
          {Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>

      <div className="memory-list">
        {memories.map((memory) => (
          <article key={memory.id} className={`memory-card status-${memory.status}`}>
            <div className="memory-card-header">
              <div>
                <span className="memory-type">{TYPE_LABELS[memory.type]}</span>
                <span className={`memory-status status-${memory.status}`}>{memory.status === 'pending' ? '待确认' : memory.status === 'active' ? '已确认' : '已归档'}</span>
                {memory.sensitivity === 'sensitive' && <span className="memory-sensitive">敏感</span>}
              </div>
              <time>{new Date(memory.updatedAt).toLocaleDateString('zh-CN')}</time>
            </div>
            {editingId === memory.id ? (
              <textarea
                autoFocus
                value={editingContent}
                maxLength={500}
                onChange={(event) => setEditingContent(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setEditingId('')
                  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void saveEdit(memory)
                }}
                aria-label="编辑记忆"
              />
            ) : <p>{memory.content}</p>}
            <div className="memory-card-meta">
              <span>重要度 {Math.round(memory.importance * 100)}%</span>
              <span>可信度 {Math.round(memory.confidence * 100)}%</span>
              <span>使用 {memory.accessCount} 次</span>
            </div>
            <div className="memory-card-actions">
              {memory.status === 'pending' && <>
                <button type="button" onClick={() => { void run(memory.id, () => window.electronAPI.memory.reject(memory.id)) }}>拒绝</button>
                <button type="button" className="primary" onClick={() => { void run(memory.id, () => window.electronAPI.memory.approve(memory.id)) }}>确认</button>
              </>}
              {editingId === memory.id ? <>
                <button type="button" onClick={() => setEditingId('')}>取消</button>
                <button type="button" className="primary" onClick={() => { void saveEdit(memory) }}>保存</button>
              </> : <button type="button" onClick={() => { setEditingId(memory.id); setEditingContent(memory.content) }}>编辑</button>}
              <button type="button" className="danger" onClick={() => { void run(memory.id, () => window.electronAPI.memory.delete(memory.id)) }}>删除</button>
            </div>
          </article>
        ))}
        {memories.length === 0 && <div className="memory-empty">没有匹配的记忆。明确说“请记住……”可以创建候选。</div>}
      </div>

      <div className="memory-footer-actions">
        <button type="button" onClick={() => { void run('export', () => window.electronAPI.memory.export()) }}>导出 JSON</button>
        <button type="button" className="danger" onClick={() => setConfirmClear(true)}>忘记全部</button>
      </div>

      {confirmClear && (
        <div className="memory-clear-confirm" role="alertdialog" aria-modal="true" aria-labelledby="memory-clear-title">
          <div>
            <strong id="memory-clear-title">删除全部长期记忆？</strong>
            <p>此操作不会删除聊天记录，但无法撤销。</p>
            <div><button type="button" autoFocus onClick={() => setConfirmClear(false)}>取消</button><button type="button" className="danger" onClick={() => { void run('clear', () => window.electronAPI.memory.clear()).then((cleared) => { if (cleared) setConfirmClear(false) }) }}>确认删除</button></div>
          </div>
        </div>
      )}
      {error && <div className="memory-settings-error" role="alert">{error}</div>}
    </div>
  )
}
