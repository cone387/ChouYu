import { useCallback, useEffect, useState } from 'react'
import type { MemoryCleanupSuggestion, MemoryCluster, MemoryConflictAction, MemoryRecord, MemoryRevision, MemoryStats, MemoryType } from '../../../../shared/memory'
import type { AppConfig } from '../../shared/types'
import './MemorySettingsTab.css'

interface MemorySettingsTabProps {
  enabled: boolean
  onEnabledChange: (enabled: boolean) => void
  config: AppConfig
  onSaveConfig: (patch: Partial<AppConfig>) => Promise<void>
}

const TYPE_LABELS: Record<MemoryType, string> = {
  fact: '事实',
  preference: '偏好',
  person: '人物',
  project: '项目',
  workflow: '工作方式'
}

const ARCHIVE_LABELS: Record<string, string> = {
  expired: '到期归档',
  capacity: '容量整理',
  cleanup: '手动整理',
  manual: '手动归档',
  replace: '被新记忆替换'
}

export default function MemorySettingsTab({ enabled, onEnabledChange, config, onSaveConfig }: MemorySettingsTabProps) {
  const [memories, setMemories] = useState<MemoryRecord[]>([])
  const [stats, setStats] = useState<MemoryStats>({ active: 0, pending: 0, archived: 0, databaseSize: 0, embeddings: 0, expiringSoon: 0 })
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'all' | 'active' | 'pending' | 'archived'>('all')
  const [type, setType] = useState<'all' | MemoryType>('all')
  const [editingId, setEditingId] = useState('')
  const [editingContent, setEditingContent] = useState('')
  const [newContent, setNewContent] = useState('')
  const [newType, setNewType] = useState<MemoryType>('fact')
  const [showAdd, setShowAdd] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [historyId, setHistoryId] = useState('')
  const [revisions, setRevisions] = useState<MemoryRevision[]>([])
  const [restoreConfirmId, setRestoreConfirmId] = useState('')
  const [deleteConfirmId, setDeleteConfirmId] = useState('')
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
  const [lifecycleDraft, setLifecycleDraft] = useState({ memoryMaxItems: config.memoryMaxItems, memoryDefaultTtlDays: config.memoryDefaultTtlDays })
  const [cleanupSuggestions, setCleanupSuggestions] = useState<MemoryCleanupSuggestion[]>([])
  const [cleanupSelected, setCleanupSelected] = useState<Set<string>>(new Set())
  const [showCleanup, setShowCleanup] = useState(false)
  const [confirmCleanup, setConfirmCleanup] = useState(false)
  const [lifecycleBusy, setLifecycleBusy] = useState(false)
  const [lifecycleStatus, setLifecycleStatus] = useState('')
  const [clusters, setClusters] = useState<MemoryCluster[]>([])
  const [showClusters, setShowClusters] = useState(false)
  const [expandedClusterIds, setExpandedClusterIds] = useState<Set<string>>(new Set())
  const [clusterBusy, setClusterBusy] = useState(false)
  const [clusterStatus, setClusterStatus] = useState('')

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

  useEffect(() => {
    setLifecycleDraft({ memoryMaxItems: config.memoryMaxItems, memoryDefaultTtlDays: config.memoryDefaultTtlDays })
  }, [config.memoryDefaultTtlDays, config.memoryMaxItems])

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

  const toggleHistory = async (memoryId: string) => {
    if (historyId === memoryId) {
      setHistoryId('')
      setRevisions([])
      setRestoreConfirmId('')
      return
    }
    setBusyId(`history:${memoryId}`)
    setError('')
    try {
      setRevisions(await window.electronAPI.memory.history(memoryId))
      setHistoryId(memoryId)
      setRestoreConfirmId('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '版本历史加载失败。')
    } finally {
      setBusyId('')
    }
  }

  const resolveConflict = async (memory: MemoryRecord, action: MemoryConflictAction) => {
    await run(memory.id, () => window.electronAPI.memory.resolveConflict(memory.id, action))
  }

  const restoreRevision = async (memory: MemoryRecord, revision: MemoryRevision) => {
    const restored = await run(memory.id, () => window.electronAPI.memory.restoreRevision(memory.id, revision.id))
    if (restored) {
      setRevisions(await window.electronAPI.memory.history(memory.id))
      setRestoreConfirmId('')
    }
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
    await onSaveConfig(embeddingDraft)
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

  const saveLifecyclePolicy = async () => {
    setLifecycleBusy(true)
    setLifecycleStatus('正在保存生命周期策略…')
    try {
      await onSaveConfig(lifecycleDraft)
      const result = await window.electronAPI.memory.maintenance()
      setLifecycleStatus(`策略已保存。本次归档：过期 ${result.expired} 条，超出容量 ${result.capacityArchived} 条。`)
      await refresh()
    } catch (reason) {
      setLifecycleStatus(reason instanceof Error ? reason.message : '生命周期策略保存失败。')
    } finally {
      setLifecycleBusy(false)
    }
  }

  const saveDefaultTtl = async (value: number) => {
    setLifecycleDraft((previous) => ({ ...previous, memoryDefaultTtlDays: value }))
    setLifecycleBusy(true)
    setLifecycleStatus('正在保存默认有效期…')
    try {
      await onSaveConfig({ memoryDefaultTtlDays: value })
      setLifecycleStatus(value > 0 ? `之后创建的记忆默认保留 ${value} 天。` : '之后创建的记忆将默认永久保留。')
    } catch (reason) {
      setLifecycleStatus(reason instanceof Error ? reason.message : '默认有效期保存失败。')
    } finally {
      setLifecycleBusy(false)
    }
  }

  const loadCleanupSuggestions = async () => {
    setLifecycleBusy(true)
    setLifecycleStatus('正在分析低价值记忆…')
    try {
      const suggestions = await window.electronAPI.memory.cleanupPreview(50)
      setCleanupSuggestions(suggestions)
      setCleanupSelected(new Set(suggestions.map((memory) => memory.id)))
      setShowCleanup(true)
      setConfirmCleanup(false)
      setLifecycleStatus(suggestions.length > 0 ? `找到 ${suggestions.length} 条整理建议。` : '暂时没有需要整理的低价值记忆。')
    } catch (reason) {
      setLifecycleStatus(reason instanceof Error ? reason.message : '整理建议加载失败。')
    } finally {
      setLifecycleBusy(false)
    }
  }

  const archiveCleanupSelection = async () => {
    setLifecycleBusy(true)
    try {
      const archived = await window.electronAPI.memory.archiveMany([...cleanupSelected])
      setLifecycleStatus(`已归档 ${archived.length} 条记忆，可在“已归档”筛选中查看。`)
      setCleanupSuggestions((previous) => previous.filter((memory) => !archived.includes(memory.id)))
      setCleanupSelected(new Set())
      setConfirmCleanup(false)
      await refresh()
    } catch (reason) {
      setLifecycleStatus(reason instanceof Error ? reason.message : '批量归档失败。')
    } finally {
      setLifecycleBusy(false)
    }
  }

  const loadClusters = async () => {
    if (showClusters) {
      setShowClusters(false)
      return
    }
    setClusterBusy(true)
    setClusterStatus('正在分析记忆主题…')
    try {
      const nextClusters = await window.electronAPI.memory.clusters()
      setClusters(nextClusters)
      setShowClusters(true)
      setExpandedClusterIds(new Set())
      setClusterStatus(nextClusters.length > 0 ? `已识别 ${nextClusters.length} 个主题。` : '当前还没有可聚合的相似记忆。')
    } catch (reason) {
      setClusterStatus(reason instanceof Error ? reason.message : '记忆主题加载失败。')
    } finally {
      setClusterBusy(false)
    }
  }

  const toggleCompression = async (enabled: boolean) => {
    setClusterBusy(true)
    setClusterStatus('正在保存摘要压缩设置…')
    try {
      await onSaveConfig({ memoryCompressionEnabled: enabled })
      setClusterStatus(enabled ? '检索时会把同主题记忆压缩为一个可追溯摘要。' : '已关闭摘要压缩，检索将使用原始记忆条目。')
    } catch (reason) {
      setClusterStatus(reason instanceof Error ? reason.message : '摘要压缩设置保存失败。')
    } finally {
      setClusterBusy(false)
    }
  }

  const clusteredMemoryCount = clusters.reduce((total, cluster) => total + cluster.memoryIds.length, 0)
  const clusterSavedCharacters = clusters.reduce((total, cluster) => total + cluster.savedCharacters, 0)

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
        <div><strong>{stats.expiringSoon}</strong><span>7 天内过期</span></div>
        <div><strong>{(stats.databaseSize / 1024).toFixed(1)} KB</strong><span>本地数据库</span></div>
        <div><strong>{stats.embeddings}</strong><span>向量索引</span></div>
      </div>

      <section className="memory-lifecycle-card">
        <div className="memory-lifecycle-heading">
          <div><strong>记忆生命周期</strong><span>过期和超出容量的记忆只会归档，不会永久删除。</span></div>
          <div className="memory-capacity-meter" aria-label={`已使用 ${stats.active} / ${config.memoryMaxItems} 条`}>
            <span>{stats.active} / {config.memoryMaxItems}</span>
            <i><b style={{ width: `${Math.min(100, stats.active / Math.max(1, config.memoryMaxItems) * 100)}%` }} /></i>
          </div>
        </div>
        <div className="memory-lifecycle-fields">
          <label><span>容量上限</span><input type="number" min="50" max="2000" step="50" value={lifecycleDraft.memoryMaxItems} disabled={lifecycleBusy} onChange={(event) => setLifecycleDraft((previous) => ({ ...previous, memoryMaxItems: Number(event.target.value) }))} onBlur={() => { void saveLifecyclePolicy() }} /><small>50–2000 条，超出后优先归档低价值记忆。</small></label>
          <label><span>新记忆默认有效期</span><select value={lifecycleDraft.memoryDefaultTtlDays} disabled={lifecycleBusy} onChange={(event) => { void saveDefaultTtl(Number(event.target.value)) }}><option value="0">永久保留</option><option value="30">30 天</option><option value="90">90 天</option><option value="180">180 天</option><option value="365">1 年</option></select><small>只影响之后创建的记忆。</small></label>
        </div>
        <div className="memory-lifecycle-actions">
          <button type="button" onClick={() => { void saveLifecyclePolicy() }} disabled={lifecycleBusy}>{lifecycleBusy ? '处理中…' : '立即维护'}</button>
          <button type="button" className="primary" onClick={() => { void loadCleanupSuggestions() }} disabled={lifecycleBusy}>{showCleanup ? '重新分析' : '查看整理建议'}</button>
        </div>
        {lifecycleStatus && <div className="memory-lifecycle-status" role="status">{lifecycleStatus}</div>}
        {showCleanup && cleanupSuggestions.length > 0 && (
          <div className="memory-cleanup-panel">
            <div className="memory-cleanup-toolbar">
              <div><strong>低价值记忆建议</strong><span>根据重要度、使用时间和来源反馈生成。</span></div>
              <label><input type="checkbox" checked={cleanupSelected.size === cleanupSuggestions.length} onChange={(event) => setCleanupSelected(event.target.checked ? new Set(cleanupSuggestions.map((memory) => memory.id)) : new Set())} />全选</label>
            </div>
            <div className="memory-cleanup-list">
              {cleanupSuggestions.map((memory) => <label key={memory.id}>
                <input type="checkbox" checked={cleanupSelected.has(memory.id)} onChange={(event) => setCleanupSelected((previous) => { const next = new Set(previous); if (event.target.checked) next.add(memory.id); else next.delete(memory.id); return next })} />
                <span><strong>{memory.content}</strong><small>{memory.reasons.join(' · ')} · 保留分 {Math.round(memory.cleanupScore * 100)}</small></span>
              </label>)}
            </div>
            <div className="memory-cleanup-actions">
              {confirmCleanup ? <><span>确认归档选中的 {cleanupSelected.size} 条记忆？</span><button type="button" onClick={() => setConfirmCleanup(false)}>取消</button><button type="button" className="warning" onClick={() => { void archiveCleanupSelection() }} disabled={lifecycleBusy}>确认归档</button></> : <button type="button" className="warning" onClick={() => setConfirmCleanup(true)} disabled={cleanupSelected.size === 0 || lifecycleBusy}>归档选中项</button>}
            </div>
          </div>
        )}
      </section>

      <section className="memory-cluster-card">
        <div className="memory-cluster-header">
          <div>
            <strong>主题聚类与摘要压缩</strong>
            <span>本地归纳相似记忆，原始内容和来源始终保留。</span>
          </div>
          <div>
            <label className="settings-switch">
              <input type="checkbox" checked={config.memoryCompressionEnabled} disabled={clusterBusy} onChange={(event) => { void toggleCompression(event.target.checked) }} aria-label="启用记忆摘要压缩" />
              <span className="settings-switch-slider" />
            </label>
            <button type="button" onClick={() => { void loadClusters() }} disabled={clusterBusy} aria-expanded={showClusters}>{clusterBusy ? '分析中…' : showClusters ? '收起主题' : '查看主题'}</button>
          </div>
        </div>
        {clusterStatus && <div className="memory-cluster-status" role="status">{clusterStatus}</div>}
        {showClusters && (
          <div className="memory-cluster-view">
            {clusters.length > 0 && <div className="memory-cluster-summary"><span><strong>{clusters.length}</strong> 个主题</span><span><strong>{clusteredMemoryCount}</strong> 条原始记忆</span><span><strong>{clusterSavedCharacters}</strong> 字符可压缩</span></div>}
            {clusters.map((cluster) => {
              const expanded = expandedClusterIds.has(cluster.id)
              return <article className="memory-topic" key={cluster.id}>
                <div className="memory-topic-heading">
                  <div><span>{TYPE_LABELS[cluster.type]}</span><strong>{cluster.label}</strong><small>{cluster.memoryIds.length} 条 · 节省 {cluster.savedCharacters} 字符</small></div>
                  <button type="button" onClick={() => setExpandedClusterIds((previous) => { const next = new Set(previous); if (expanded) next.delete(cluster.id); else next.add(cluster.id); return next })} aria-expanded={expanded}>{expanded ? '收起来源' : '查看来源'}</button>
                </div>
                <p>{cluster.summary}</p>
                {expanded && <ul>{cluster.memories.map((memory) => <li key={memory.id}><time>{new Date(memory.updatedAt).toLocaleDateString('zh-CN')}</time><span>{memory.content}</span></li>)}</ul>}
              </article>
            })}
            {clusters.length === 0 && <div className="memory-cluster-empty">至少需要两条同类型且主题相近的已确认记忆，才会形成主题。</div>}
          </div>
        )}
      </section>

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
                  void onSaveConfig({ embeddingEnabled: event.target.checked })
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
          <option value="all">全部状态</option><option value="active">已确认</option><option value="pending">待确认</option><option value="archived">已归档</option>
        </select>
        <select value={type} onChange={(event) => setType(event.target.value as typeof type)} aria-label="记忆类型筛选">
          <option value="all">全部类型</option>
          {Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>

      <div className="memory-list">
        {memories.map((memory) => {
          const conflicts = memory.conflicts?.filter((conflict) => conflict.status === 'pending') || []
          return <article key={memory.id} className={`memory-card status-${memory.status}${conflicts.length ? ' has-conflict' : ''}`}>
            <div className="memory-card-header">
              <div>
                <span className="memory-type">{TYPE_LABELS[memory.type]}</span>
                <span className={`memory-status status-${memory.status}`}>{memory.status === 'pending' ? '待确认' : memory.status === 'active' ? '已确认' : '已归档'}</span>
                {conflicts.length > 0 && <span className="memory-conflict-badge">{conflicts.length} 个冲突</span>}
                {memory.sensitivity === 'sensitive' && <span className="memory-sensitive">敏感</span>}
                {memory.status === 'archived' && memory.archivedReason && <span className="memory-archive-reason">{ARCHIVE_LABELS[memory.archivedReason] || memory.archivedReason}</span>}
                {memory.status === 'active' && memory.expiresAt && <span className="memory-expiry">{memory.expiresAt <= Date.now() + 7 * 86_400_000 ? '即将过期' : `${Math.ceil((memory.expiresAt - Date.now()) / 86_400_000)} 天后过期`}</span>}
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
            {conflicts.length > 0 && (
              <div className="memory-conflict-panel">
                <div className="memory-conflict-heading">
                  <strong>{conflicts[0].kind === 'contradiction' ? '发现矛盾信息' : '发现可能的更新'}</strong>
                  <span>{conflicts[0].reason}</span>
                </div>
                <div className="memory-conflict-compare">
                  <div><span>已有记忆</span><p>{conflicts[0].existingContent}</p></div>
                  <div><span>新候选</span><p>{memory.content}</p></div>
                </div>
                {conflicts.length > 1 && <small>另有 {conflicts.length - 1} 条相关记忆会一起处理。</small>}
                <div className="memory-conflict-actions">
                  <button type="button" onClick={() => { void resolveConflict(memory, 'reject') }} disabled={busyId === memory.id}>拒绝新记忆</button>
                  <button type="button" onClick={() => { void resolveConflict(memory, 'keep') }} disabled={busyId === memory.id}>两条都保留</button>
                  <button type="button" className="replace" onClick={() => { void resolveConflict(memory, 'replace') }} disabled={busyId === memory.id}>用新记忆替换</button>
                </div>
              </div>
            )}
            <div className="memory-card-meta">
              <span>重要度 {Math.round(memory.importance * 100)}%</span>
              <span>可信度 {Math.round(memory.confidence * 100)}%</span>
              <span>使用 {memory.accessCount} 次</span>
              <span>反馈 +{memory.helpfulCount} / -{memory.unhelpfulCount}</span>
            </div>
            <div className="memory-card-actions">
              {memory.status === 'pending' && conflicts.length === 0 && <>
                <button type="button" onClick={() => { void run(memory.id, () => window.electronAPI.memory.reject(memory.id)) }} disabled={busyId === memory.id}>拒绝</button>
                <button type="button" className="primary" onClick={() => { void run(memory.id, () => window.electronAPI.memory.approve(memory.id)) }} disabled={busyId === memory.id}>确认</button>
              </>}
              {editingId === memory.id ? <>
                <button type="button" onClick={() => setEditingId('')}>取消</button>
                <button type="button" className="primary" onClick={() => { void saveEdit(memory) }}>保存</button>
              </> : memory.status !== 'archived' && <button type="button" onClick={() => { setEditingId(memory.id); setEditingContent(memory.content) }} disabled={Boolean(busyId)}>编辑</button>}
              {memory.status === 'archived' && <button type="button" className="primary" onClick={() => { void run(memory.id, () => window.electronAPI.memory.reactivate(memory.id)) }} disabled={Boolean(busyId)}>恢复使用</button>}
              {memory.status !== 'pending' && <button type="button" onClick={() => { void toggleHistory(memory.id) }} disabled={Boolean(busyId)} aria-expanded={historyId === memory.id}>{historyId === memory.id ? '收起历史' : '版本历史'}</button>}
              {deleteConfirmId === memory.id ? <>
                <span className="memory-delete-label">确认永久删除？</span>
                <button type="button" onClick={() => setDeleteConfirmId('')}>取消</button>
                <button type="button" className="danger solid" onClick={() => { void run(memory.id, () => window.electronAPI.memory.delete(memory.id)).then((deleted) => { if (deleted) setDeleteConfirmId('') }) }} disabled={busyId === memory.id}>确认删除</button>
              </> : <button type="button" className="danger" onClick={() => setDeleteConfirmId(memory.id)} disabled={Boolean(busyId)}>删除</button>}
            </div>
            {historyId === memory.id && (
              <div className="memory-history" aria-label="记忆版本历史">
                <div className="memory-history-title"><strong>版本历史</strong><span>恢复前会自动保存当前版本</span></div>
                {revisions.length === 0 ? <div className="memory-history-empty">这条记忆还没有历史版本。</div> : revisions.map((revision) => (
                  <div className="memory-revision" key={revision.id}>
                    <div><span>{revision.reason === 'edit' ? '编辑前' : revision.reason === 'replace' ? '替换前' : '恢复前'}</span><time>{new Date(revision.createdAt).toLocaleString('zh-CN')}</time></div>
                    <p>{revision.content}</p>
                    {memory.status === 'archived' ? <span className="memory-revision-readonly">归档版本，仅供查看</span> : restoreConfirmId === revision.id ? <div className="memory-revision-confirm">
                      <span>恢复为这个版本？当前内容会进入历史。</span>
                      <button type="button" onClick={() => setRestoreConfirmId('')}>取消</button>
                      <button type="button" className="primary" onClick={() => { void restoreRevision(memory, revision) }} disabled={busyId === memory.id}>确认恢复</button>
                    </div> : <button type="button" onClick={() => setRestoreConfirmId(revision.id)} disabled={Boolean(busyId)}>恢复此版本</button>}
                  </div>
                ))}
              </div>
            )}
          </article>
        })}
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
