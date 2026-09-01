import { useCallback, useEffect, useState } from 'react'
import { extractPersonName } from '../../../../shared/memory'
import type { MemoryCleanupSuggestion, MemoryCluster, MemoryConflictAction, MemoryImportAction, MemoryImportPreview, MemoryInsights, MemoryRecord, MemoryRevision, MemoryStats, MemoryType } from '../../../../shared/memory'
import type { AppConfig } from '../../shared/types'
import type { CapabilityInfo } from '../../../../shared/capabilities'
import './MemorySettingsTab.css'

interface MemorySettingsTabProps {
  enabled: boolean
  onEnabledChange: (enabled: boolean) => void
  config: AppConfig
  onSaveConfig: (patch: Partial<AppConfig>) => Promise<void>
  focusMemoryId?: string
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

const EMPTY_INSIGHTS: MemoryInsights = { byType: [], createdByWeek: [], archiveReasons: [], helpful: 0, unhelpful: 0, clustered: 0, clusters: 0, savedCharacters: 0 }

export default function MemorySettingsTab({ enabled, onEnabledChange, config, onSaveConfig, focusMemoryId }: MemorySettingsTabProps) {
  const [memories, setMemories] = useState<MemoryRecord[]>([])
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
  const [insights, setInsights] = useState<MemoryInsights>(EMPTY_INSIGHTS)
  const [expiryEditingId, setExpiryEditingId] = useState('')
  const [expiryDays, setExpiryDays] = useState(0)
  const [topicMergeMode, setTopicMergeMode] = useState(false)
  const [topicSelection, setTopicSelection] = useState<Set<string>>(new Set())
  const [topicLabel, setTopicLabel] = useState('')
  const [splitConfirmId, setSplitConfirmId] = useState('')
  const [importPreview, setImportPreview] = useState<MemoryImportPreview | null>(null)
  const [importActions, setImportActions] = useState<Record<string, MemoryImportAction>>({})
  const [importBusy, setImportBusy] = useState(false)
  const [importStatus, setImportStatus] = useState('')
  const [confirmImport, setConfirmImport] = useState(false)
  const [showSyncKey, setShowSyncKey] = useState(false)
  const [syncDraft, setSyncDraft] = useState({
    memorySyncBaseUrl: config.memorySyncBaseUrl,
    memorySyncApiKey: config.memorySyncApiKey,
    memorySyncUserId: config.memorySyncUserId
  })
  const [syncBusy, setSyncBusy] = useState<'test' | 'pull' | 'push' | ''>('')
  const [syncStatus, setSyncStatus] = useState('')
  const [confirmSyncPush, setConfirmSyncPush] = useState(false)
  const [capabilities, setCapabilities] = useState<CapabilityInfo[]>([])
  const [capabilityStatus, setCapabilityStatus] = useState('')

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
    }
  }, [identityEditing, query, status, type])

  useEffect(() => {
    const timer = setTimeout(() => { void refresh() }, 180)
    return () => clearTimeout(timer)
  }, [refresh])

  useEffect(() => {
    if (!focusMemoryId || memories.length === 0) return
    const element = document.querySelector(`[data-memory-id="${CSS.escape(focusMemoryId)}"]`)
    element?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' })
  }, [focusMemoryId, memories])

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

  useEffect(() => {
    setSyncDraft({ memorySyncBaseUrl: config.memorySyncBaseUrl, memorySyncApiKey: config.memorySyncApiKey, memorySyncUserId: config.memorySyncUserId })
  }, [config.memorySyncApiKey, config.memorySyncBaseUrl, config.memorySyncUserId])

  useEffect(() => {
    void window.electronAPI.capabilities.list().then(setCapabilities).catch(() => setCapabilityStatus('能力插件目录加载失败。'))
  }, [config.embeddingProvider, config.memoryEngineProvider, config.memorySyncProvider])

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
      setClusters(await window.electronAPI.memory.clusters())
      setTopicMergeMode(false)
      setTopicSelection(new Set())
      setTopicLabel('')
      setShowClusters(true)
      setClusterStatus('人工主题已创建，摘要压缩会优先使用这个分组。')
    } catch (reason) {
      setClusterStatus(reason instanceof Error ? reason.message : '人工主题创建失败。')
    } finally {
      setClusterBusy(false)
    }
  }

  const splitCluster = async (cluster: MemoryCluster) => {
    setClusterBusy(true)
    setClusterStatus('正在拆分主题…')
    try {
      await window.electronAPI.memory.splitCluster(cluster.id, cluster.memoryIds, cluster.manual === true)
      setClusters(await window.electronAPI.memory.clusters())
      setSplitConfirmId('')
      setClusterStatus('主题已拆分；这些记忆将保持为独立条目，直到你重新人工合并。')
    } catch (reason) {
      setClusterStatus(reason instanceof Error ? reason.message : '主题拆分失败。')
    } finally {
      setClusterBusy(false)
    }
  }

  const previewImport = async () => {
    setImportBusy(true)
    setImportStatus('正在读取并检查导入文件…')
    try {
      const preview = await window.electronAPI.memory.importPreview()
      if (preview.canceled) {
        setImportStatus('已取消导入。')
        return
      }
      setImportPreview(preview)
      setImportActions(Object.fromEntries(preview.items.map((item) => [item.id, item.suggestedAction])))
      setConfirmImport(false)
      setImportStatus(`已检查 ${preview.items.length} 条可导入记忆；忽略无效 ${preview.invalid} 条，阻止敏感内容 ${preview.blockedSecrets} 条。`)
    } catch (reason) {
      setImportStatus(reason instanceof Error ? reason.message : '记忆导入预览失败。')
    } finally {
      setImportBusy(false)
    }
  }

  const commitImport = async () => {
    if (!importPreview) return
    setImportBusy(true)
    setImportStatus('正在导入记忆…')
    try {
      const result = await window.electronAPI.memory.importCommit(importPreview.items.map((item) => ({ item, action: importActions[item.id] || 'skip' })))
      setImportStatus(`导入完成：新增 ${result.added}，并存 ${result.kept}，替换 ${result.replaced}，跳过 ${result.skipped}，失败 ${result.failed}。`)
      setImportPreview(null)
      setImportActions({})
      setConfirmImport(false)
      await refresh()
    } catch (reason) {
      setImportStatus(reason instanceof Error ? reason.message : '记忆导入失败。')
    } finally {
      setImportBusy(false)
    }
  }

  const saveSyncDraft = async () => {
    await onSaveConfig(syncDraft)
  }

  const testSyncConnection = async () => {
    setSyncBusy('test')
    setSyncStatus('正在连接 Mem0…')
    try {
      await saveSyncDraft()
      const result = await window.electronAPI.memory.syncTest()
      setSyncStatus(result.message)
    } catch (reason) {
      setSyncStatus(reason instanceof Error ? reason.message : 'Mem0 连接测试失败。')
    } finally {
      setSyncBusy('')
    }
  }

  const testMemoryEngineConnection = async () => {
    setSyncBusy('test')
    setSyncStatus('正在连接主记忆引擎…')
    try {
      await saveSyncDraft()
      const result = await window.electronAPI.memory.engineTest()
      setSyncStatus(result.message)
    } catch (reason) {
      setSyncStatus(reason instanceof Error ? reason.message : '主记忆引擎连接测试失败。')
    } finally {
      setSyncBusy('')
    }
  }

  const pullSyncPreview = async () => {
    setSyncBusy('pull')
    setSyncStatus('正在从 Mem0 拉取并检查冲突…')
    try {
      await saveSyncDraft()
      const preview = await window.electronAPI.memory.syncPullPreview()
      setImportPreview(preview)
      setImportActions(Object.fromEntries(preview.items.map((item) => [item.id, item.suggestedAction])))
      setConfirmImport(false)
      setSyncStatus(`已从 Mem0 读取 ${preview.remoteCount} 条记忆；其中 ${preview.items.length} 条可进入导入预览。`)
    } catch (reason) {
      setSyncStatus(reason instanceof Error ? reason.message : 'Mem0 拉取失败。')
    } finally {
      setSyncBusy('')
    }
  }

  const pushToSync = async () => {
    setSyncBusy('push')
    setSyncStatus('正在向 Mem0 上传已确认记忆…')
    try {
      await saveSyncDraft()
      const result = await window.electronAPI.memory.syncPush()
      setSyncStatus(`上传完成：成功 ${result.succeeded}，已存在 ${result.skipped}，失败 ${result.failed}，共检查 ${result.attempted} 条。`)
      setConfirmSyncPush(false)
    } catch (reason) {
      setSyncStatus(reason instanceof Error ? reason.message : 'Mem0 上传失败。')
    } finally {
      setSyncBusy('')
    }
  }

  const clusteredMemoryCount = clusters.reduce((total, cluster) => total + cluster.memoryIds.length, 0)
  const clusterSavedCharacters = clusters.reduce((total, cluster) => total + cluster.savedCharacters, 0)
  const maxTypeCount = Math.max(1, ...insights.byType.map((item) => item.count))
  const maxWeeklyCount = Math.max(1, ...insights.createdByWeek.map((item) => item.count))
  const selectedTopicType = memories.find((memory) => topicSelection.has(memory.id))?.type
  const orderedMemories = [...memories].sort((left, right) => sortBy === 'importance'
    ? right.importance - left.importance || right.updatedAt - left.updatedAt
    : sortBy === 'usage'
      ? right.accessCount - left.accessCount || right.updatedAt - left.updatedAt
      : right.updatedAt - left.updatedAt)
  const memoryTypeCounts = Object.fromEntries((Object.keys(TYPE_LABELS) as MemoryType[]).map((memoryType) => [memoryType, memories.filter((memory) => memory.type === memoryType).length])) as Record<MemoryType, number>
  const memoryEngineCapabilities = capabilities.filter((item) => item.kind === 'memory-engine')
  const embeddingCapabilities = capabilities.filter((item) => item.kind === 'embedding')
  const syncCapabilities = capabilities.filter((item) => item.kind === 'memory-sync')
  const mem0EngineSelected = config.memoryEngineProvider === 'mem0-platform-engine' || config.memoryEngineProvider === 'mem0-self-hosted-engine'

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

      <section className="memory-capability-card">
        <div><strong>记忆引擎插件</strong><span>负责本地记忆的存储、检索、冲突和历史。切换引擎需要重启应用。</span></div>
        <select value={config.memoryEngineProvider} onChange={(event) => {
          const engine = event.target.value
          const remote = engine === 'mem0-self-hosted-engine' || engine === 'mem0-platform-engine'
          const suggestedBaseUrl = engine === 'mem0-self-hosted-engine' ? 'http://localhost:8888/api' : engine === 'mem0-platform-engine' ? 'https://api.mem0.ai/v1' : syncDraft.memorySyncBaseUrl
          const defaultBaseUrl = remote && syncDraft.memorySyncBaseUrl.trim() ? syncDraft.memorySyncBaseUrl : suggestedBaseUrl
          setSyncDraft((previous) => ({ ...previous, memorySyncBaseUrl: defaultBaseUrl }))
          void onSaveConfig({ memoryEngineProvider: engine, ...(remote ? { memorySyncProvider: 'none', memorySyncBaseUrl: defaultBaseUrl } : {}) })
          setCapabilityStatus('主记忆引擎选择已保存，重启 ChouYu 后生效。')
        }} aria-label="主记忆引擎">{memoryEngineCapabilities.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <div className="memory-capability-meta">{memoryEngineCapabilities.filter((item) => item.id === config.memoryEngineProvider).map((item) => <span key={item.id}><b>当前主引擎</b>{item.networkAccess ? '需要网络' : '完全本地'} · {item.description}</span>)}</div>
        {capabilityStatus && <div className="memory-capability-status" role="status">{capabilityStatus}</div>}
        {mem0EngineSelected && (
          <div className="memory-engine-connection-card" aria-labelledby="memory-engine-connection-title">
            <div><strong id="memory-engine-connection-title">Mem0 主记忆引擎连接</strong><span>当前主记忆引擎为 Mem0，SQLite 仅作缓存。</span></div>
            <div className="memory-sync-fields">
              <label><span>Base URL（必填）</span><input value={syncDraft.memorySyncBaseUrl} onChange={(event) => setSyncDraft((previous) => ({ ...previous, memorySyncBaseUrl: event.target.value }))} onBlur={() => { void saveSyncDraft() }} placeholder={config.memoryEngineProvider === 'mem0-self-hosted-engine' ? 'http://localhost:8888/api' : 'https://api.mem0.ai/v1'} /></label>
              <label><span>User ID（必填）</span><input value={syncDraft.memorySyncUserId} onChange={(event) => setSyncDraft((previous) => ({ ...previous, memorySyncUserId: event.target.value }))} onBlur={() => { void saveSyncDraft() }} placeholder="用于隔离远程记忆" /></label>
              <label className="memory-sync-key-field"><span>API Key</span><div><input type={showSyncKey ? 'text' : 'password'} value={syncDraft.memorySyncApiKey} onChange={(event) => setSyncDraft((previous) => ({ ...previous, memorySyncApiKey: event.target.value }))} onBlur={() => { void saveSyncDraft() }} placeholder="Mem0 API Key" /><button type="button" onClick={() => setShowSyncKey((value) => !value)}>{showSyncKey ? '隐藏' : '显示'}</button></div></label>
            </div>
            <div className="memory-sync-actions"><button type="button" onClick={() => { void testMemoryEngineConnection() }} disabled={Boolean(syncBusy)}>{syncBusy === 'test' ? '测试中…' : '测试主记忆引擎'}</button></div>
            {syncStatus && <div className="memory-sync-status" role="status">{syncStatus}</div>}
          </div>
        )}
      </section>

      <div className="memory-stats" aria-label="记忆统计">
        <div><strong>{stats.active}</strong><span>已确认</span></div>
        <div><strong>{stats.pending}</strong><span>待确认</span></div>
        <div><strong>{stats.expiringSoon}</strong><span>7 天内过期</span></div>
        <div><strong>{(stats.databaseSize / 1024).toFixed(1)} KB</strong><span>本地数据库</span></div>
        <div><strong>{stats.embeddings}</strong><span>向量索引</span></div>
      </div>

      <details className="memory-insights-card">
        <summary>记忆统计概览</summary>
        <div className="memory-insights-content">
          <div className="memory-insight-kpis">
            <span><strong>{insights.clusters}</strong>主题</span><span><strong>{insights.clustered}</strong>已聚类</span><span><strong>{insights.savedCharacters}</strong>可压缩字符</span><span><strong>+{insights.helpful} / -{insights.unhelpful}</strong>来源反馈</span>
          </div>
          <div className="memory-insight-grid">
            <div><strong>类型分布</strong><ul>{insights.byType.map((item) => <li key={item.type}><span>{TYPE_LABELS[item.type]}</span><i><b style={{ width: `${item.count / maxTypeCount * 100}%` }} /></i><em>{item.count}</em></li>)}</ul></div>
            <div><strong>近 8 周新增</strong><div className="memory-week-chart" role="img" aria-label={`近 8 周新增记忆：${insights.createdByWeek.map((item) => `${item.label} ${item.count} 条`).join('，')}`}>{insights.createdByWeek.map((item) => <span key={item.label}><i style={{ height: `${Math.max(4, item.count / maxWeeklyCount * 100)}%` }} /><small>{item.label}</small><em>{item.count}</em></span>)}</div></div>
          </div>
          <div className="memory-archive-breakdown"><strong>归档构成</strong>{insights.archiveReasons.filter((item) => item.count > 0).map((item) => <span key={item.reason}>{ARCHIVE_LABELS[item.reason] || item.reason} {item.count}</span>)}{insights.archiveReasons.every((item) => item.count === 0) && <span>暂无归档记忆</span>}</div>
        </div>
      </details>

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
            <button type="button" onClick={() => { setTopicMergeMode((value) => !value); setTopicSelection(new Set()); setTopicLabel('') }} disabled={clusterBusy} aria-pressed={topicMergeMode}>{topicMergeMode ? '取消合并' : '人工合并'}</button>
          </div>
        </div>
        {topicMergeMode && <div className="memory-topic-builder">
          <div><strong>创建人工主题</strong><span>请在下方记忆列表中勾选至少两条同类型的已确认记忆。</span></div>
          <input value={topicLabel} maxLength={60} onChange={(event) => setTopicLabel(event.target.value)} placeholder="主题名称" aria-label="人工主题名称" />
          <span>已选 {topicSelection.size} 条</span>
          <button type="button" className="primary" onClick={() => { void createManualTopic() }} disabled={clusterBusy || topicSelection.size < 2 || !topicLabel.trim()}>创建主题</button>
        </div>}
        {clusterStatus && <div className="memory-cluster-status" role="status">{clusterStatus}</div>}
        {showClusters && (
          <div className="memory-cluster-view">
            {clusters.length > 0 && <div className="memory-cluster-summary"><span><strong>{clusters.length}</strong> 个主题</span><span><strong>{clusteredMemoryCount}</strong> 条原始记忆</span><span><strong>{clusterSavedCharacters}</strong> 字符可压缩</span></div>}
            {clusters.map((cluster) => {
              const expanded = expandedClusterIds.has(cluster.id)
              return <article className="memory-topic" key={cluster.id}>
                <div className="memory-topic-heading">
                  <div><span>{TYPE_LABELS[cluster.type]}</span><strong>{cluster.label}</strong><small>{cluster.memoryIds.length} 条 · 节省 {cluster.savedCharacters} 字符 · {cluster.manual ? '人工主题' : '自动主题'}</small></div>
                  <div><button type="button" onClick={() => setExpandedClusterIds((previous) => { const next = new Set(previous); if (expanded) next.delete(cluster.id); else next.add(cluster.id); return next })} aria-expanded={expanded}>{expanded ? '收起来源' : '查看来源'}</button><button type="button" className="warning" onClick={() => setSplitConfirmId(cluster.id)} disabled={clusterBusy}>拆分主题</button></div>
                </div>
                <p>{cluster.summary}</p>
                {expanded && <ul>{cluster.memories.map((memory) => <li key={memory.id}><time>{new Date(memory.updatedAt).toLocaleDateString('zh-CN')}</time><span>{memory.content}</span></li>)}</ul>}
                {splitConfirmId === cluster.id && <div className="memory-topic-split-confirm"><span>拆分后这些记忆会保持独立，直到人工重新合并。</span><button type="button" onClick={() => setSplitConfirmId('')}>取消</button><button type="button" className="warning" onClick={() => { void splitCluster(cluster) }}>确认拆分</button></div>}
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
            <select value={config.embeddingEnabled ? config.embeddingProvider : 'none'} onChange={(event) => { const provider = event.target.value; const enabled = provider !== 'none'; setShowEmbedding(enabled); void onSaveConfig({ embeddingProvider: provider, embeddingEnabled: enabled }) }} aria-label="Embedding 能力插件"><option value="none">不启用 · 关键词检索</option>{embeddingCapabilities.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
            <button type="button" className="memory-embedding-expand" onClick={() => setShowEmbedding((value) => !value)} aria-expanded={showEmbedding}>
              {showEmbedding ? '收起' : '配置'}
            </button>
          </div>
        </div>
        {showEmbedding && (
          <div className="memory-embedding-fields">
            <div className="memory-embedding-privacy" role="note">当前插件会把记忆文本和搜索查询发送到配置的 Embedding 服务。留空 Base URL 或 API Key 时复用当前 AI Provider，但只有它实现 `/embeddings` 才能使用。</div>
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

      {!mem0EngineSelected && <section className="memory-sync-card">
        <div className="memory-sync-header">
          <div><strong>记忆备份与迁移</strong><span>主记忆引擎始终只有一个；这里仅用于显式备份或迁移，不参与日常记忆读写。</span></div>
          <select value={config.memorySyncProvider} disabled={Boolean(syncBusy) || mem0EngineSelected} onChange={(event) => { const provider = event.target.value; const defaultBaseUrl = provider === 'mem0-self-hosted' ? 'http://localhost:8888/api' : provider === 'mem0-platform' ? 'https://api.mem0.ai/v1' : syncDraft.memorySyncBaseUrl; setSyncDraft((previous) => ({ ...previous, memorySyncBaseUrl: defaultBaseUrl })); void onSaveConfig({ memorySyncProvider: provider, memorySyncBaseUrl: defaultBaseUrl }); setSyncStatus(provider !== 'none' ? '备份迁移能力已选择，请完成连接配置。' : '远程备份已关闭。'); setConfirmSyncPush(false) }} aria-label="记忆备份与迁移"><option value="none">不启用备份</option>{syncCapabilities.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        </div>
        {config.memorySyncProvider !== 'none' && !mem0EngineSelected && <div className="memory-sync-content">
          <div className="memory-sync-privacy" role="note">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="2"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2"/></svg>
            <span>{mem0EngineSelected ? '当前 Mem0 作为唯一主记忆引擎，SQLite 仅作为本地缓存。' : '只有点击“确认上传”才会把已确认记忆发送到 Mem0。拉取内容会先进入本地冲突预览，不会直接覆盖。'}</span>
          </div>
          <div className="memory-sync-fields">
            <label><span>Base URL（必填）</span><input value={syncDraft.memorySyncBaseUrl} onChange={(event) => setSyncDraft((previous) => ({ ...previous, memorySyncBaseUrl: event.target.value }))} onBlur={() => { void saveSyncDraft() }} placeholder={config.memorySyncProvider === 'mem0-self-hosted' ? 'http://localhost:8888' : 'https://api.mem0.ai/v1'} /></label>
            <label><span>User ID（必填）</span><input value={syncDraft.memorySyncUserId} onChange={(event) => setSyncDraft((previous) => ({ ...previous, memorySyncUserId: event.target.value }))} onBlur={() => { void saveSyncDraft() }} placeholder="用于隔离你的远程记忆" /></label>
            <label className="memory-sync-key-field"><span>API Key{config.memorySyncProvider === 'mem0-platform' ? '（必填）' : '（自托管关闭鉴权时可留空）'}</span><div><input type={showSyncKey ? 'text' : 'password'} value={syncDraft.memorySyncApiKey} onChange={(event) => setSyncDraft((previous) => ({ ...previous, memorySyncApiKey: event.target.value }))} onBlur={() => { void saveSyncDraft() }} placeholder="Mem0 API Key" /><button type="button" onClick={() => setShowSyncKey((value) => !value)}>{showSyncKey ? '隐藏' : '显示'}</button></div><small>使用系统 safeStorage 加密后保存在本机。</small></label>
          </div>
          <div className="memory-sync-actions">
            {mem0EngineSelected ? <button type="button" onClick={() => { void testSyncConnection() }} disabled={Boolean(syncBusy)}>{syncBusy === 'test' ? '测试中…' : '测试 Mem0 主引擎'}</button> : <>
            <button type="button" onClick={() => { void testSyncConnection() }} disabled={Boolean(syncBusy)}>{syncBusy === 'test' ? '测试中…' : '测试连接'}</button>
            <button type="button" onClick={() => { void pullSyncPreview() }} disabled={Boolean(syncBusy)}>{syncBusy === 'pull' ? '拉取中…' : '拉取并预览'}</button>
            {confirmSyncPush ? <div className="memory-sync-confirm"><span>确认把全部已确认记忆发送到 Mem0？敏感候选也可能包含个人信息。</span><button type="button" onClick={() => setConfirmSyncPush(false)}>取消</button><button type="button" className="warning" onClick={() => { void pushToSync() }} disabled={Boolean(syncBusy)}>确认上传</button></div> : <button type="button" className="warning" onClick={() => setConfirmSyncPush(true)} disabled={Boolean(syncBusy)}>上传本地记忆</button>}
            </>}
          </div>
          {syncStatus && <div className="memory-sync-status" role="status">{syncStatus}</div>}
        </div>}
      </section>}

      {showAdd && (
        <div className="memory-add-form">
          <select value={newType} onChange={(event) => setNewType(event.target.value as MemoryType)} aria-label="记忆类型">
            {Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <textarea autoFocus value={newContent} onChange={(event) => setNewContent(event.target.value)} maxLength={500} placeholder="输入需要长期记住的内容…" aria-label="新记忆内容" />
          <button type="button" onClick={() => { void addMemory() }} disabled={!newContent.trim() || busyId === 'new'}>保存记忆</button>
        </div>
      )}

      <div className="memory-toolbar memory-library">
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
        {memories.length === 0 && <div className="memory-empty">没有匹配的记忆。明确说“请记住……”可以创建候选。</div>}
      </div>

      {importPreview && <section className="memory-import-panel" aria-label="记忆导入预览">
        <div className="memory-import-heading"><div><strong>导入预览 · {importPreview.fileName}</strong><span>逐条确认处理方式，提交前不会写入数据库。</span></div><button type="button" onClick={() => { setImportPreview(null); setConfirmImport(false) }}>关闭</button></div>
        <div className="memory-import-list">
          {importPreview.items.map((item) => <article key={item.id} className={`status-${item.status}`}>
            <div><span>{item.status === 'new' ? '新增' : item.status === 'duplicate' ? '重复' : item.conflictKind === 'contradiction' ? '冲突' : '更新'}</span><strong>{TYPE_LABELS[item.candidate.type]}</strong><select value={importActions[item.id] || item.suggestedAction} disabled={item.status === 'duplicate'} onChange={(event) => setImportActions((previous) => ({ ...previous, [item.id]: event.target.value as MemoryImportAction }))} aria-label={`“${item.candidate.content}”的导入方式`}>{item.status === 'new' && <option value="add">新增</option>}{item.status === 'conflict' && <><option value="keep">与已有记忆并存</option><option value="replace">替换已有记忆</option></>}<option value="skip">跳过</option></select></div>
            <p>{item.candidate.content}</p>
            {item.existingContent && <div className="memory-import-existing"><span>已有</span><p>{item.existingContent}</p><small>{item.reason}</small></div>}
          </article>)}
        </div>
        <div className="memory-import-actions">{confirmImport ? <><span>确认按当前选择导入？替换操作会归档旧记忆。</span><button type="button" onClick={() => setConfirmImport(false)}>取消</button><button type="button" className="primary" onClick={() => { void commitImport() }} disabled={importBusy}>确认导入</button></> : <button type="button" className="primary" onClick={() => setConfirmImport(true)} disabled={importBusy || importPreview.items.length === 0}>提交导入</button>}</div>
      </section>}

      <div className="memory-footer-actions">
        <button type="button" onClick={() => { void previewImport() }} disabled={importBusy}>{importBusy ? '处理中…' : '导入 JSON'}</button>
        <button type="button" onClick={() => { void run('export', () => window.electronAPI.memory.export()) }}>导出 JSON</button>
        <button type="button" className="danger" onClick={() => setConfirmClear(true)}>忘记全部</button>
      </div>
      {importStatus && <div className="memory-import-status" role="status">{importStatus}</div>}

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
