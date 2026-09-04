import { useEffect, useState } from 'react'
import type { MemoryCleanupSuggestion, MemoryStats } from '../../../../../shared/memory'
import type { AppConfig } from '../../../shared/types'

interface MemoryLifecycleCardProps {
  config: AppConfig
  stats: MemoryStats
  onSaveConfig: (patch: Partial<AppConfig>) => Promise<void>
  refresh: () => Promise<void>
}

export default function MemoryLifecycleCard({ config, stats, onSaveConfig, refresh }: MemoryLifecycleCardProps) {
  const [lifecycleDraft, setLifecycleDraft] = useState({ memoryMaxItems: config.memoryMaxItems, memoryDefaultTtlDays: config.memoryDefaultTtlDays })
  const [cleanupSuggestions, setCleanupSuggestions] = useState<MemoryCleanupSuggestion[]>([])
  const [cleanupSelected, setCleanupSelected] = useState<Set<string>>(new Set())
  const [showCleanup, setShowCleanup] = useState(false)
  const [confirmCleanup, setConfirmCleanup] = useState(false)
  const [lifecycleBusy, setLifecycleBusy] = useState(false)
  const [lifecycleStatus, setLifecycleStatus] = useState('')

  useEffect(() => {
    setLifecycleDraft({ memoryMaxItems: config.memoryMaxItems, memoryDefaultTtlDays: config.memoryDefaultTtlDays })
  }, [config.memoryDefaultTtlDays, config.memoryMaxItems])

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

  return (
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
  )
}
