import { useCallback, useEffect, useRef, useState } from 'react'
import { extractPersonName } from '../../../../shared/memory'
import type { MemoryConflictAction, MemoryInsights, MemoryRecord, MemoryRevision, MemoryStats, MemoryType } from '../../../../shared/memory'
import type { AppConfig } from '../../shared/types'
import type { CapabilityInfo } from '../../../../shared/capabilities'
import MemoryEngineCard from './memory/MemoryEngineCard'
import MemoryEmbeddingCard from './memory/MemoryEmbeddingCard'
import MemoryLifecycleCard from './memory/MemoryLifecycleCard'
import MemoryClusterCard from './memory/MemoryClusterCard'
import MemoryStatsView from './memory/MemoryStatsView'
import MemoryImportPanel from './memory/MemoryImportPanel'
import { ARCHIVE_LABELS, TYPE_LABELS } from './memory/labels'
import './MemorySettingsTab.css'

interface MemorySettingsTabProps {
  enabled: boolean
  onEnabledChange: (enabled: boolean) => void
  config: AppConfig
  onSaveConfig: (patch: Partial<AppConfig>) => Promise<void>
  focusMemoryId?: string
  workspace?: boolean
}

type MemoryWorkspaceView = 'overview' | 'review' | 'library' | 'organize' | 'connections'
type MemoryReviewScope = 'pending' | 'all'
const MEMORY_REVIEW_SCOPE_STATE_KEY = 'memory-review-scope'

const EMPTY_INSIGHTS: MemoryInsights = { byType: [], createdByWeek: [], archiveReasons: [], helpful: 0, unhelpful: 0, clustered: 0, clusters: 0, savedCharacters: 0 }

export default function MemorySettingsTab({ enabled, onEnabledChange, config, onSaveConfig, focusMemoryId, workspace = false }: MemorySettingsTabProps) {
  const [memories, setMemories] = useState<MemoryRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [identity, setIdentity] = useState<MemoryRecord | null>(null)
  const [identityEditing, setIdentityEditing] = useState(false)
  const [identityDraft, setIdentityDraft] = useState('')
  const [stats, setStats] = useState<MemoryStats>({ active: 0, pending: 0, archived: 0, databaseSize: 0, embeddings: 0, expiringSoon: 0 })
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'all' | 'active' | 'pending' | 'archived'>('active')
  const [type, setType] = useState<'all' | MemoryType>('all')
  const [sortBy, setSortBy] = useState<'updated' | 'importance' | 'usage'>('updated')
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
  const [clusterBusy, setClusterBusy] = useState(false)
  const [clusterStatus, setClusterStatus] = useState('')
  const [clusterReloadSignal, setClusterReloadSignal] = useState(0)
  const [insights, setInsights] = useState<MemoryInsights>(EMPTY_INSIGHTS)
  const [expiryEditingId, setExpiryEditingId] = useState('')
  const [expiryDays, setExpiryDays] = useState(0)
  const [topicMergeMode, setTopicMergeMode] = useState(false)
  const [topicSelection, setTopicSelection] = useState<Set<string>>(new Set())
  const [topicLabel, setTopicLabel] = useState('')
  const [capabilities, setCapabilities] = useState<CapabilityInfo[]>([])
  const [capabilityStatus, setCapabilityStatus] = useState('')
  const [activeView, setActiveView] = useState<MemoryWorkspaceView>(focusMemoryId ? 'library' : 'overview')
  const [reviewScope, setReviewScope] = useState<MemoryReviewScope>('pending')
  const workspaceNavRef = useRef<HTMLElement>(null)
  const isRemoteEngine = config.memoryEngineProvider === 'mem0-platform-engine' || config.memoryEngineProvider === 'mem0-self-hosted-engine'

  const selectView = useCallback((view: MemoryWorkspaceView) => {
    if (isRemoteEngine && !['overview', 'connections'].includes(view)) {
      setActiveView('overview')
      return
    }
    setActiveView(view)
    setQuery('')
    setType('all')
    if (view === 'review') setStatus(reviewScope === 'pending' ? 'pending' : 'all')
    else if (view === 'library') setStatus((current) => current === 'pending' ? 'active' : current)
  }, [isRemoteEngine, reviewScope])

  useEffect(() => {
    if (isRemoteEngine && !['overview', 'connections'].includes(activeView)) setActiveView('overview')
  }, [activeView, isRemoteEngine])

  const handleWorkspaceNavKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const buttons = Array.from(workspaceNavRef.current?.querySelectorAll<HTMLButtonElement>('button') || [])
    const currentIndex = buttons.indexOf(event.currentTarget)
    if (currentIndex < 0 || buttons.length === 0) return
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? buttons.length - 1
        : event.key === 'ArrowRight'
          ? (currentIndex + 1) % buttons.length
          : (currentIndex - 1 + buttons.length) % buttons.length
    buttons[nextIndex]?.focus()
    buttons[nextIndex]?.click()
  }

  useEffect(() => {
    window.electronAPI.db.getState(MEMORY_REVIEW_SCOPE_STATE_KEY).then((value) => {
      if (value === 'all' || value === 'pending') {
        setReviewScope(value)
        if (activeView === 'review') setStatus(value === 'pending' ? 'pending' : 'all')
      }
    }).catch(() => {})
  }, [activeView])

  const handleReviewScopeChange = useCallback((scope: MemoryReviewScope) => {
    setReviewScope(scope)
    setStatus(scope === 'pending' ? 'pending' : 'all')
    void window.electronAPI.db.setState(MEMORY_REVIEW_SCOPE_STATE_KEY, scope)
  }, [])

  useEffect(() => {
    if (!workspace) return
    const frame = requestAnimationFrame(() => workspaceNavRef.current?.querySelector<HTMLButtonElement>('button.active')?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(frame)
  }, [activeView, workspace])

  const refresh = useCallback(async () => {
    setError('')
    try {
      const [items, nextStats, nextInsights, nextIdentity] = await Promise.all([
        window.electronAPI.memory.list({ query, status, type, limit: 500 }),
        window.electronAPI.memory.stats(),
        window.electronAPI.memory.insights(),
        window.electronAPI.memory.identity()
      ])
      setMemories(items)
      setStats(nextStats)
      setInsights(nextInsights)
      setIdentity(nextIdentity)
      if (!identityEditing) setIdentityDraft(nextIdentity ? (extractPersonName(nextIdentity.content) || nextIdentity.content) : '')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '记忆中心加载失败。')
    } finally {
      setLoading(false)
    }
  }, [identityEditing, query, status, type])

  useEffect(() => {
    const timer = setTimeout(() => { void refresh() }, 180)
    return () => clearTimeout(timer)
  }, [refresh])

  useEffect(() => {
    if (!focusMemoryId || memories.length === 0) return
    setActiveView('library')
    const element = document.querySelector(`[data-memory-id="${CSS.escape(focusMemoryId)}"]`)
    element?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' })
  }, [focusMemoryId, memories])

  useEffect(() => {
    void window.electronAPI.capabilities.list().then(setCapabilities).catch(() => setCapabilityStatus('能力插件目录加载失败。'))
  }, [config.embeddingProvider, config.memoryEngineProvider])

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

  const saveIdentity = async () => {
    if (!identity || !identityDraft.trim()) return
    const saved = await run(identity.id, () => window.electronAPI.memory.update(identity.id, {
      type: 'person',
      content: `我的名字是 ${identityDraft.trim().slice(0, 100)}`
    }))
    if (saved) setIdentityEditing(false)
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

  const saveExpiry = async (memory: MemoryRecord) => {
    const expiresAt = expiryDays > 0 ? Date.now() + expiryDays * 86_400_000 : null
    if (await run(memory.id, () => window.electronAPI.memory.update(memory.id, { expiresAt }))) setExpiryEditingId('')
  }

  const createManualTopic = async () => {
    if (topicSelection.size < 2 || !topicLabel.trim()) return
    setClusterBusy(true)
    setClusterStatus('正在创建人工主题…')
    try {
      await window.electronAPI.memory.createTopic(topicLabel, [...topicSelection])
      setClusterReloadSignal((value) => value + 1)
      setTopicMergeMode(false)
      setTopicSelection(new Set())
      setTopicLabel('')
      setActiveView('organize')
      setClusterStatus('人工主题已创建，摘要压缩会优先使用这个分组。')
    } catch (reason) {
      setClusterStatus(reason instanceof Error ? reason.message : '人工主题创建失败。')
    } finally {
      setClusterBusy(false)
    }
  }

  const handleTopicMergeToggle = useCallback(() => {
    if (topicMergeMode) setTopicMergeMode(false)
    else {
      setTopicMergeMode(true)
      setStatus('active')
      setType('all')
      setActiveView('library')
    }
    setTopicSelection(new Set())
    setTopicLabel('')
  }, [topicMergeMode])

  const selectedTopicType = memories.find((memory) => topicSelection.has(memory.id))?.type
  const orderedMemories = [...memories].sort((left, right) => sortBy === 'importance'
    ? right.importance - left.importance || right.updatedAt - left.updatedAt
    : sortBy === 'usage'
      ? right.accessCount - left.accessCount || right.updatedAt - left.updatedAt
      : right.updatedAt - left.updatedAt)
  const memoryTypeCounts = Object.fromEntries((Object.keys(TYPE_LABELS) as MemoryType[]).map((memoryType) => [memoryType, memories.filter((memory) => memory.type === memoryType).length])) as Record<MemoryType, number>
  const memoryEngineCapabilities = capabilities.filter((item) => item.kind === 'memory-engine')
  const embeddingCapabilities = capabilities.filter((item) => item.kind === 'embedding')

  return (
    <div className={`settings-pane memory-settings-pane${workspace ? ' memory-workspace-pane' : ''}`}>
      <div className="settings-pane-heading memory-heading">
        <div>
          <h2>{workspace ? '记忆工作区' : '记忆中心'}</h2>
          <p>查看、校正并控制 ChouYu 可以长期使用的信息。</p>
        </div>
        {activeView === 'library' && <button type="button" className="memory-add-btn" onClick={() => setShowAdd((value) => !value)}>
          {showAdd ? '取消添加' : '添加记忆'}
        </button>}
      </div>

      <nav ref={workspaceNavRef} className="memory-workspace-nav" aria-label="记忆工作区">
        <button type="button" className={activeView === 'overview' ? 'active' : ''} aria-current={activeView === 'overview' ? 'page' : undefined} onKeyDown={handleWorkspaceNavKeyDown} onClick={() => selectView('overview')}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>
          <span>总览</span>
        </button>
        {!isRemoteEngine && <button type="button" className={activeView === 'review' ? 'active' : ''} aria-current={activeView === 'review' ? 'page' : undefined} onKeyDown={handleWorkspaceNavKeyDown} onClick={() => selectView('review')}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M8 2.2a5.8 5.8 0 105.8 5.8"/><path d="M8 4.5V8l2.3 1.4"/></svg>
          <span>待处理</span>{stats.pending > 0 && <b>{stats.pending}</b>}
        </button>}
        {!isRemoteEngine && <button type="button" className={activeView === 'library' ? 'active' : ''} aria-current={activeView === 'library' ? 'page' : undefined} onKeyDown={handleWorkspaceNavKeyDown} onClick={() => selectView('library')}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M3 2.5h8.5A1.5 1.5 0 0113 4v9.5H4.5A1.5 1.5 0 013 12z"/><path d="M3 12a1.5 1.5 0 011.5-1.5H13M6 5h4"/></svg>
          <span>记忆库</span>
        </button>}
        {!isRemoteEngine && <button type="button" className={activeView === 'organize' ? 'active' : ''} aria-current={activeView === 'organize' ? 'page' : undefined} onKeyDown={handleWorkspaceNavKeyDown} onClick={() => selectView('organize')}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M3 4h10M5 8h8M7 12h6"/><circle cx="3" cy="8" r="1"/><circle cx="5" cy="12" r="1"/></svg>
          <span>整理</span>
        </button>}
        <button type="button" className={activeView === 'connections' ? 'active' : ''} aria-current={activeView === 'connections' ? 'page' : undefined} onKeyDown={handleWorkspaceNavKeyDown} onClick={() => selectView('connections')}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M6 5V3M10 5V3M4 6h8v3a4 4 0 01-4 4 4 4 0 01-4-4zM8 13v1"/></svg>
          <span>连接</span>
        </button>
      </nav>

      {!loading && activeView === 'review' && <div className="memory-review-intro" role="note">
        <strong>待处理记忆</strong>
        <span>{reviewScope === 'pending' ? '默认只显示需要你确认或解决冲突的记忆；处理完成后会自动移出。' : '当前显示全部记忆；可在此查看和处理任意状态的记录。'}</span>
      </div>}

      {loading && <div className="memory-loading-state" role="status" aria-live="polite">
        <span>正在加载记忆工作区…</span>
        <i /><i /><i />
      </div>}

      {!loading && activeView === 'overview' && <div className={`memory-view memory-overview-view${isRemoteEngine ? ' is-remote' : ''}`}>

      {isRemoteEngine ? <section className="memory-remote-overview" aria-labelledby="memory-remote-overview-title">
        <div className="memory-remote-overview-icon" aria-hidden="true">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7.5A8 8 0 0112 4a8 8 0 018 3.5M4 7.5V12a8 8 0 0016 0V7.5M8 9.5v4M12 8.5v5M16 9.5v4"/></svg>
        </div>
        <div>
          <h3 id="memory-remote-overview-title">Mem0 正在管理记忆</h3>
          <p>当前使用 Mem0 作为唯一主记忆中心。ChouYu 会在聊天时将相关内容交给 Mem0 处理，不在本地维护记忆索引、聚类或生命周期。</p>
          <span className="memory-remote-overview-note">日常使用无需额外操作；如需修改连接信息，请前往“连接”。</span>
          <div className="memory-remote-toggle"><span>允许在聊天中使用长期记忆</span><label className="settings-switch"><input type="checkbox" checked={enabled} onChange={(event) => onEnabledChange(event.target.checked)} aria-label="允许在聊天中使用长期记忆" /><span className="settings-switch-slider" /></label></div>
        </div>
      </section> : <>

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

      <section className="memory-identity-card" aria-labelledby="memory-identity-title">
        {identityEditing ? (
          <div className="memory-identity-editor">
            <strong id="memory-identity-title">编辑身份档案</strong>
            <input value={identityDraft} autoFocus maxLength={100} onChange={(event) => setIdentityDraft(event.target.value)} aria-label="身份名称" />
            <div className="memory-identity-actions">
              <button type="button" className="settings-secondary-btn" onClick={() => setIdentityEditing(false)}>取消</button>
              <button type="button" className="memory-add-btn" onClick={() => { void saveIdentity() }} disabled={!identityDraft.trim() || busyId === identity?.id}>保存</button>
            </div>
          </div>
        ) : (
          <>
            <div className="memory-identity-copy">
              <strong id="memory-identity-title">你的身份档案</strong>
              <span>{identity ? identity.content : '还没有可靠的姓名记录。可以在聊天中说“我叫……”来建立身份档案。'}</span>
            </div>
            <button type="button" className="settings-secondary-btn" onClick={() => {
              if (identity) setIdentityEditing(true)
              else selectView('library')
              setType('person')
              setStatus('active')
              setQuery('')
              void refresh()
              requestAnimationFrame(() => document.querySelector('.memory-library')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
            }}>
              {identity ? '编辑身份档案' : '查看人物记忆'}
            </button>
          </>
        )}
      </section>

      <section className="memory-write-mode-card" aria-labelledby="memory-write-mode-title">
        <div>
          <strong id="memory-write-mode-title">记忆写入方式</strong>
          <span>
            {config.memoryWriteMode === 'auto'
              ? '自动保存明确表达的偏好和事实；检测到冲突时仍会请求确认。'
              : config.memoryWriteMode === 'confirm'
                ? '每条候选记忆都先等待确认，再写入本地数据库。'
                : '不从聊天内容提取新记忆，但已有记忆仍可检索。'}
          </span>
        </div>
        <div className="memory-write-mode-controls">
          <select
            value={config.memoryWriteMode}
            aria-label="记忆写入方式"
            onChange={(event) => { void onSaveConfig({ memoryWriteMode: event.target.value as AppConfig['memoryWriteMode'] }) }}
          >
            <option value="auto">自动写入（推荐）</option>
            <option value="confirm">每次确认</option>
            <option value="off">关闭写入</option>
          </select>
          {config.memoryWriteMode === 'auto' && (
            <label>
              <span>自动写入严格度</span>
              <select
                value={config.memoryAutoWriteConfidence}
                aria-label="自动写入严格度"
                onChange={(event) => { void onSaveConfig({ memoryAutoWriteConfidence: Number(event.target.value) }) }}
              >
                <option value="0.95">谨慎</option>
                <option value="0.85">平衡（推荐）</option>
                <option value="0.8">宽松</option>
              </select>
            </label>
          )}
        </div>
      </section>

      </>}
      </div>}

      {!loading && activeView === 'connections' && <div className="memory-view memory-connections-view">
        <MemoryEngineCard
          config={config}
          onSaveConfig={onSaveConfig}
          memoryEngineCapabilities={memoryEngineCapabilities}
          capabilityStatus={capabilityStatus}
          onCapabilityStatusChange={setCapabilityStatus}
          isRemoteEngine={isRemoteEngine}
        />
      </div>}

      {!loading && activeView === 'overview' && !isRemoteEngine && <div className="memory-view memory-overview-stats-view">
        <MemoryStatsView stats={stats} insights={insights} />
      </div>}

      {!loading && activeView === 'organize' && !isRemoteEngine && <div className="memory-view memory-organize-view">
        <MemoryLifecycleCard config={config} stats={stats} onSaveConfig={onSaveConfig} refresh={refresh} />
        <MemoryClusterCard
          config={config}
          onSaveConfig={onSaveConfig}
          topicMergeMode={topicMergeMode}
          onTopicMergeToggle={handleTopicMergeToggle}
          topicLabel={topicLabel}
          onTopicLabelChange={setTopicLabel}
          topicSelectionSize={topicSelection.size}
          onCreateManualTopic={createManualTopic}
          clusterBusy={clusterBusy}
          onClusterBusyChange={setClusterBusy}
          clusterStatus={clusterStatus}
          onClusterStatusChange={setClusterStatus}
          reloadSignal={clusterReloadSignal}
        />
      </div>}

      {!loading && activeView === 'connections' && <div className="memory-view memory-connections-view">
        <MemoryEmbeddingCard config={config} onSaveConfig={onSaveConfig} refresh={refresh} embeddingCapabilities={embeddingCapabilities} />
      </div>}

      {!loading && (activeView === 'review' || activeView === 'library') && <div className={`memory-view memory-library-view${activeView === 'review' ? ' is-review' : ''}`}>
      {activeView === 'library' && topicMergeMode && <div className="memory-topic-builder memory-topic-builder-library">
        <div><strong>创建人工主题</strong><span>勾选至少两条同类型的已确认记忆。</span></div>
        <input value={topicLabel} maxLength={60} onChange={(event) => setTopicLabel(event.target.value)} placeholder="主题名称" aria-label="人工主题名称" />
        <span>已选 {topicSelection.size} 条</span>
        <button type="button" className="primary" onClick={() => { void createManualTopic() }} disabled={clusterBusy || topicSelection.size < 2 || !topicLabel.trim()}>创建主题</button>
        <button type="button" onClick={() => { setTopicMergeMode(false); setTopicSelection(new Set()); setTopicLabel('') }}>取消</button>
      </div>}
      {activeView === 'library' && showAdd && (
        <div className="memory-add-form">
          <select value={newType} onChange={(event) => setNewType(event.target.value as MemoryType)} aria-label="记忆类型">
            {Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <textarea autoFocus value={newContent} onChange={(event) => setNewContent(event.target.value)} maxLength={500} placeholder="输入需要长期记住的内容…" aria-label="新记忆内容" />
          <button type="button" onClick={() => { void addMemory() }} disabled={!newContent.trim() || busyId === 'new'}>保存记忆</button>
        </div>
      )}

      <div className={`memory-toolbar memory-library${activeView === 'review' ? ' is-review' : ''}`}>
        <label>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索记忆…" aria-label="搜索记忆" />
        </label>
        {activeView === 'library' ? <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} aria-label="记忆状态">
          <option value="all">全部状态</option><option value="active">已确认</option><option value="pending">待确认</option><option value="archived">已归档</option>
        </select> : <label className="memory-review-scope"><span>显示范围</span><select value={reviewScope} onChange={(event) => handleReviewScopeChange(event.target.value as MemoryReviewScope)} aria-label="待处理显示范围"><option value="pending">仅待确认与冲突</option><option value="all">全部记忆</option></select></label>}
        <select value={type} onChange={(event) => setType(event.target.value as typeof type)} aria-label="记忆类型筛选">
          <option value="all">全部类型</option>
          {Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select value={sortBy} onChange={(event) => setSortBy(event.target.value as typeof sortBy)} aria-label="记忆排序"><option value="updated">最近更新</option><option value="importance">重要度</option><option value="usage">使用次数</option></select>
      </div>

      <div className="memory-library-summary"><span>显示 <strong>{orderedMemories.length}</strong> 条记忆</span><div className="memory-type-chips"><button type="button" className={type === 'all' ? 'active' : ''} onClick={() => setType('all')}>全部</button>{(Object.keys(TYPE_LABELS) as MemoryType[]).map((memoryType) => <button type="button" key={memoryType} className={type === memoryType ? 'active' : ''} onClick={() => setType(memoryType)}>{TYPE_LABELS[memoryType]} <b>{memoryTypeCounts[memoryType] || 0}</b></button>)}</div></div>

      <div className="memory-list">
        {orderedMemories.map((memory) => {
          const conflicts = memory.conflicts?.filter((conflict) => conflict.status === 'pending') || []
          return <article key={memory.id} data-memory-id={memory.id} className={`memory-card status-${memory.status}${conflicts.length ? ' has-conflict' : ''}${focusMemoryId === memory.id ? ' is-focused' : ''}`}>
            <div className="memory-card-header">
              <div>
                {topicMergeMode && memory.status === 'active' && <label className="memory-topic-select"><input type="checkbox" checked={topicSelection.has(memory.id)} disabled={Boolean(selectedTopicType && selectedTopicType !== memory.type)} onChange={(event) => setTopicSelection((previous) => { const next = new Set(previous); if (event.target.checked) next.add(memory.id); else next.delete(memory.id); return next })} aria-label={`选择记忆：${memory.content}`} /></label>}
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
            <details className="memory-source-details">
              <summary>来源与依据</summary>
              <div className="memory-source-grid">
                <span>来源</span>
                <strong>{memory.sourceSessionId ? '从对话中提取' : '手动添加或导入'}</strong>
                {memory.sourceSessionId && <code title={memory.sourceSessionId}>会话 {memory.sourceSessionId.slice(0, 12)}…</code>}
                {memory.sourceMessageId && <code title={memory.sourceMessageId}>消息 {memory.sourceMessageId.slice(0, 12)}…</code>}
                <span>保存依据</span>
                <p>{memory.status === 'pending'
                  ? '这是一条等待确认的候选记忆，确认后才会参与后续对话。'
                  : memory.confidence >= 0.85
                    ? '来自较明确的用户表达，当前置信度较高。'
                    : '当前置信度较低，建议结合原始对话内容复核。'}</p>
                <span>远程边界</span>
                <p>{isRemoteEngine
                  ? '当前使用 Mem0 作为唯一主记忆引擎，内容会发送到所配置的 Mem0 服务。'
                  : '当前使用 SQLite 作为唯一主记忆引擎，内容仅保存在本机。'}</p>
              </div>
            </details>
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
              {memory.status === 'active' && <button type="button" onClick={() => { setExpiryEditingId(expiryEditingId === memory.id ? '' : memory.id); setExpiryDays(memory.expiresAt ? Math.max(1, Math.ceil((memory.expiresAt - Date.now()) / 86_400_000)) : 0) }} disabled={Boolean(busyId)} aria-expanded={expiryEditingId === memory.id}>有效期</button>}
              {memory.status !== 'pending' && <button type="button" onClick={() => { void toggleHistory(memory.id) }} disabled={Boolean(busyId)} aria-expanded={historyId === memory.id}>{historyId === memory.id ? '收起历史' : '版本历史'}</button>}
              {deleteConfirmId === memory.id ? <>
                <span className="memory-delete-label">确认永久删除？</span>
                <button type="button" onClick={() => setDeleteConfirmId('')}>取消</button>
                <button type="button" className="danger solid" onClick={() => { void run(memory.id, () => window.electronAPI.memory.delete(memory.id)).then((deleted) => { if (deleted) setDeleteConfirmId('') }) }} disabled={busyId === memory.id}>确认删除</button>
              </> : <button type="button" className="danger" onClick={() => setDeleteConfirmId(memory.id)} disabled={Boolean(busyId)}>删除</button>}
            </div>
            {expiryEditingId === memory.id && <div className="memory-expiry-editor"><label><span>这条记忆保留</span><select value={expiryDays} onChange={(event) => setExpiryDays(Number(event.target.value))}><option value="0">永久</option><option value="7">7 天</option><option value="30">30 天</option><option value="90">90 天</option><option value="180">180 天</option><option value="365">1 年</option></select></label><span>{memory.expiresAt ? `当前到期：${new Date(memory.expiresAt).toLocaleDateString('zh-CN')}` : '当前永久保留'}</span><button type="button" onClick={() => setExpiryEditingId('')}>取消</button><button type="button" className="primary" onClick={() => { void saveExpiry(memory) }} disabled={busyId === memory.id}>保存</button></div>}
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
        {memories.length === 0 && <div className="memory-empty">{activeView === 'review' ? '没有待处理的记忆，当前收件箱已经清空。' : '没有匹配的记忆。明确说“请记住……”可以创建候选。'}</div>}
      </div>

      {activeView === 'library' && <MemoryImportPanel run={run} refresh={refresh} onConfirmClear={() => setConfirmClear(true)} />}
      </div>}

      {confirmClear && (
        <div className="memory-clear-confirm" role="alertdialog" aria-modal="true" aria-labelledby="memory-clear-title">
          <div>
            <strong id="memory-clear-title">删除全部长期记忆？</strong>
            <p>此操作不会删除聊天记录，但无法撤销。</p>
            <div><button type="button" autoFocus onClick={() => setConfirmClear(false)}>取消</button><button type="button" className="danger" onClick={() => { void run('clear', () => window.electronAPI.memory.clear()).then((cleared) => { if (cleared) setConfirmClear(false) }) }}>确认删除</button></div>
          </div>
        </div>
      )}
      {error && <div className="memory-settings-error" role="alert"><span>{error}</span><button type="button" onClick={() => { setLoading(true); void refresh() }}>重试</button></div>}
    </div>
  )
}
