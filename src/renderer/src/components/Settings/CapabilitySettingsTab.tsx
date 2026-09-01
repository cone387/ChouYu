import { useEffect, useState } from 'react'
import type { CapabilityInfo } from '../../../../shared/capabilities'
import type { AppConfig } from '../../shared/types'
import './CapabilitySettingsTab.css'

interface CapabilitySettingsTabProps {
  config: AppConfig
  onSave: (patch: Partial<AppConfig>) => Promise<void>
  onNavigate: (section: 'memory') => void
}

const GROUPS: Array<{ kind: CapabilityInfo['kind']; title: string; description: string }> = [
  { kind: 'memory-engine', title: '记忆引擎', description: '负责记忆存储、检索、冲突和生命周期。' },
  { kind: 'embedding', title: 'Embedding', description: '为记忆生成语义向量；关闭时使用关键词检索。' },
  { kind: 'memory-sync', title: '记忆备份与迁移', description: '连接远程服务用于显式备份或迁移，不参与日常记忆读写。' }
]

function capabilityState(capability: CapabilityInfo): string {
  if (capability.kind === 'memory-sync' && capability.active) return '已配置'
  if (capability.active) return '已启用'
  if (!capability.installed) return '未安装'
  return '可选'
}

export default function CapabilitySettingsTab({ config, onSave, onNavigate }: CapabilitySettingsTabProps) {
  const [capabilities, setCapabilities] = useState<CapabilityInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true
    setLoading(true)
    window.electronAPI.capabilities.list().then((items) => {
      if (mounted) setCapabilities(items)
    }).catch((reason) => {
      if (mounted) setError(reason instanceof Error ? reason.message : '能力目录加载失败。')
    }).finally(() => {
      if (mounted) setLoading(false)
    })
    return () => { mounted = false }
  }, [config.embeddingEnabled, config.embeddingProvider, config.memoryEngineProvider, config.memorySyncProvider])

  const selectCapability = (capability: CapabilityInfo) => {
    if (capability.kind === 'memory-engine') {
      void onSave({ memoryEngineProvider: capability.id })
    } else if (capability.kind === 'embedding') {
      void onSave({ embeddingProvider: capability.id, embeddingEnabled: true })
    } else {
      void onSave({ memorySyncProvider: capability.id })
    }
  }

  return (
    <div className="settings-pane capability-settings-pane">
      <div className="settings-pane-heading">
        <h2>能力中心</h2>
        <p>主记忆引擎只能选择一个；Embedding 和备份迁移是独立的可选能力。</p>
      </div>
      <div className="capability-privacy-note" role="note">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="2"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2"/></svg>
        <span>能力插件只在 Main Process 运行。标记“发送记忆数据”的能力不会在后台自动上传。</span>
      </div>
      {loading && <div className="capability-loading" role="status">正在加载能力目录…</div>}
      {error && <div className="capability-error" role="alert">{error}</div>}
      {!loading && GROUPS.map((group) => {
        const items = capabilities.filter((capability) => capability.kind === group.kind)
        return <section className="capability-group" key={group.kind}>
          <div className="capability-group-heading"><div><strong>{group.title}</strong><span>{group.description}</span></div><button type="button" onClick={() => onNavigate('memory')}>在记忆中心配置</button></div>
          <div className="capability-list">
            {group.kind === 'embedding' && <article className={`capability-card${config.embeddingEnabled ? ' active' : ''}`}>
              <div className="capability-card-main"><span className="capability-state">{config.embeddingEnabled ? '已启用' : '未启用'}</span><strong>关键词检索</strong><p>不调用向量服务，记忆内容留在本机。</p></div><div className="capability-badges"><span className="local">完全本地</span><span>不发送数据</span></div>
            </article>}
            {group.kind === 'memory-sync' && <article className={`capability-card${config.memorySyncProvider === 'none' ? ' active' : ''}`}>
              <div className="capability-card-main"><span className="capability-state">{config.memorySyncProvider === 'none' ? '已启用' : '可选'}</span><strong>不启用备份</strong><p>只使用当前主记忆引擎，不连接远程备份服务。</p></div><div className="capability-badges"><span className="local">不发送数据</span></div>
            </article>}
            {items.map((capability) => {
              const isPrimaryActive = capability.kind === 'memory-engine' && capability.active
              return <article key={capability.id} className={`capability-card${isPrimaryActive ? ' active' : ''}`}>
              <div className="capability-card-main"><span className={`capability-state${isPrimaryActive ? ' on' : ''}`}>{capabilityState(capability)}</span><strong>{capability.name}</strong><p>{capability.description}</p></div>
              <div className="capability-card-side"><div className="capability-badges"><span className={capability.networkAccess ? 'network' : 'local'}>{capability.networkAccess ? '需要网络' : '完全本地'}</span><span>{capability.sendsMemoryData ? '会发送记忆数据' : '不发送数据'}</span></div><button type="button" className={isPrimaryActive ? 'selected' : ''} onClick={() => { selectCapability(capability) }} disabled={isPrimaryActive}>{isPrimaryActive ? '当前使用' : capability.kind === 'memory-sync' && capability.active ? '已配置' : '选择此能力'}</button></div>
            </article>
            })}
          </div>
        </section>
      })}
    </div>
  )
}
