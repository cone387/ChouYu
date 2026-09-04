import { useEffect, useState } from 'react'
import type { MemoryCluster } from '../../../../../shared/memory'
import type { AppConfig } from '../../../shared/types'
import { TYPE_LABELS } from './labels'

interface MemoryClusterCardProps {
  config: AppConfig
  onSaveConfig: (patch: Partial<AppConfig>) => Promise<void>
  topicMergeMode: boolean
  onTopicMergeToggle: () => void
  topicLabel: string
  onTopicLabelChange: (label: string) => void
  topicSelectionSize: number
  onCreateManualTopic: () => Promise<void>
  clusterBusy: boolean
  onClusterBusyChange: (busy: boolean) => void
  clusterStatus: string
  onClusterStatusChange: (status: string) => void
  /** Increment to make the card reload clusters from the main process. */
  reloadSignal: number
}

export default function MemoryClusterCard({
  config,
  onSaveConfig,
  topicMergeMode,
  onTopicMergeToggle,
  topicLabel,
  onTopicLabelChange,
  topicSelectionSize,
  onCreateManualTopic,
  clusterBusy,
  onClusterBusyChange,
  clusterStatus,
  onClusterStatusChange,
  reloadSignal
}: MemoryClusterCardProps) {
  const [clusters, setClusters] = useState<MemoryCluster[]>([])
  const [showClusters, setShowClusters] = useState(false)
  const [expandedClusterIds, setExpandedClusterIds] = useState<Set<string>>(new Set())
  const [splitConfirmId, setSplitConfirmId] = useState('')

  useEffect(() => {
    if (reloadSignal === 0) return
    void window.electronAPI.memory.clusters().then((nextClusters) => {
      setClusters(nextClusters)
      setShowClusters(true)
    }).catch(() => {})
  }, [reloadSignal])

  const loadClusters = async () => {
    if (showClusters) {
      setShowClusters(false)
      return
    }
    onClusterBusyChange(true)
    onClusterStatusChange('正在分析记忆主题…')
    try {
      const nextClusters = await window.electronAPI.memory.clusters()
      setClusters(nextClusters)
      setShowClusters(true)
      setExpandedClusterIds(new Set())
      onClusterStatusChange(nextClusters.length > 0 ? `已识别 ${nextClusters.length} 个主题。` : '当前还没有可聚合的相似记忆。')
    } catch (reason) {
      onClusterStatusChange(reason instanceof Error ? reason.message : '记忆主题加载失败。')
    } finally {
      onClusterBusyChange(false)
    }
  }

  const toggleCompression = async (enabled: boolean) => {
    onClusterBusyChange(true)
    onClusterStatusChange('正在保存摘要压缩设置…')
    try {
      await onSaveConfig({ memoryCompressionEnabled: enabled })
      onClusterStatusChange(enabled ? '检索时会把同主题记忆压缩为一个可追溯摘要。' : '已关闭摘要压缩，检索将使用原始记忆条目。')
    } catch (reason) {
      onClusterStatusChange(reason instanceof Error ? reason.message : '摘要压缩设置保存失败。')
    } finally {
      onClusterBusyChange(false)
    }
  }

  const splitCluster = async (cluster: MemoryCluster) => {
    onClusterBusyChange(true)
    onClusterStatusChange('正在拆分主题…')
    try {
      await window.electronAPI.memory.splitCluster(cluster.id, cluster.memoryIds, cluster.manual === true)
      setClusters(await window.electronAPI.memory.clusters())
      setSplitConfirmId('')
      onClusterStatusChange('主题已拆分；这些记忆将保持为独立条目，直到你重新人工合并。')
    } catch (reason) {
      onClusterStatusChange(reason instanceof Error ? reason.message : '主题拆分失败。')
    } finally {
      onClusterBusyChange(false)
    }
  }

  const clusteredMemoryCount = clusters.reduce((total, cluster) => total + cluster.memoryIds.length, 0)
  const clusterSavedCharacters = clusters.reduce((total, cluster) => total + cluster.savedCharacters, 0)

  return (
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
          <button type="button" onClick={onTopicMergeToggle} disabled={clusterBusy} aria-pressed={topicMergeMode}>{topicMergeMode ? '取消合并' : '人工合并'}</button>
        </div>
      </div>
      {topicMergeMode && <div className="memory-topic-builder">
        <div><strong>创建人工主题</strong><span>请在下方记忆列表中勾选至少两条同类型的已确认记忆。</span></div>
        <input value={topicLabel} maxLength={60} onChange={(event) => onTopicLabelChange(event.target.value)} placeholder="主题名称" aria-label="人工主题名称" />
        <span>已选 {topicSelectionSize} 条</span>
        <button type="button" className="primary" onClick={() => { void onCreateManualTopic() }} disabled={clusterBusy || topicSelectionSize < 2 || !topicLabel.trim()}>创建主题</button>
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
  )
}
