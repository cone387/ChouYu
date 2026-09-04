import { useEffect, useState } from 'react'
import type { AppConfig } from '../../../shared/types'
import type { CapabilityInfo } from '../../../../../shared/capabilities'

interface MemoryEngineCardProps {
  config: AppConfig
  onSaveConfig: (patch: Partial<AppConfig>) => Promise<void>
  memoryEngineCapabilities: CapabilityInfo[]
  capabilityStatus: string
  onCapabilityStatusChange: (status: string) => void
  isRemoteEngine: boolean
}

export default function MemoryEngineCard({ config, onSaveConfig, memoryEngineCapabilities, capabilityStatus, onCapabilityStatusChange, isRemoteEngine }: MemoryEngineCardProps) {
  const [showSyncKey, setShowSyncKey] = useState(false)
  const [syncDraft, setSyncDraft] = useState({
    memorySyncBaseUrl: config.memorySyncBaseUrl,
    memorySyncApiKey: config.memorySyncApiKey,
    memorySyncUserId: config.memorySyncUserId
  })
  const [syncBusy, setSyncBusy] = useState<'test' | 'pull' | 'push' | ''>('')
  const [syncStatus, setSyncStatus] = useState('')

  useEffect(() => {
    setSyncDraft({ memorySyncBaseUrl: config.memorySyncBaseUrl, memorySyncApiKey: config.memorySyncApiKey, memorySyncUserId: config.memorySyncUserId })
  }, [config.memorySyncApiKey, config.memorySyncBaseUrl, config.memorySyncUserId])

  const saveSyncDraft = async () => {
    await onSaveConfig(syncDraft)
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

  return (
    <section className="memory-capability-card">
      <div><strong>记忆引擎插件</strong><span>负责本地记忆的存储、检索、冲突和历史。切换引擎需要重启应用。</span></div>
      <select value={config.memoryEngineProvider} onChange={(event) => {
        const engine = event.target.value
        const remote = engine === 'mem0-self-hosted-engine' || engine === 'mem0-platform-engine'
        const suggestedBaseUrl = engine === 'mem0-self-hosted-engine' ? 'http://localhost:8888/api' : engine === 'mem0-platform-engine' ? 'https://api.mem0.ai/v1' : syncDraft.memorySyncBaseUrl
        const defaultBaseUrl = remote && syncDraft.memorySyncBaseUrl.trim() ? syncDraft.memorySyncBaseUrl : suggestedBaseUrl
        setSyncDraft((previous) => ({ ...previous, memorySyncBaseUrl: defaultBaseUrl }))
        void onSaveConfig({ memoryEngineProvider: engine, ...(remote ? { memorySyncBaseUrl: defaultBaseUrl, memoryWriteMode: 'auto' } : {}) })
        onCapabilityStatusChange('主记忆引擎选择已保存，重启 ChouYu 后生效。')
      }} aria-label="主记忆引擎">{memoryEngineCapabilities.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <div className="memory-capability-meta">{memoryEngineCapabilities.filter((item) => item.id === config.memoryEngineProvider).map((item) => <span key={item.id}><b>当前主引擎</b>{item.networkAccess ? '需要网络' : '完全本地'} · {item.description}</span>)}</div>
      {capabilityStatus && <div className="memory-capability-status" role="status">{capabilityStatus}</div>}
      {isRemoteEngine && (
        <div className="memory-engine-connection-card" aria-labelledby="memory-engine-connection-title">
          <div><strong id="memory-engine-connection-title">Mem0 主记忆引擎连接</strong><span>当前主记忆引擎为 Mem0，SQLite 仅作缓存。</span></div>
          <div className="memory-engine-fields">
            <label><span>Base URL（必填）</span><input value={syncDraft.memorySyncBaseUrl} onChange={(event) => setSyncDraft((previous) => ({ ...previous, memorySyncBaseUrl: event.target.value }))} onBlur={() => { void saveSyncDraft() }} placeholder={config.memoryEngineProvider === 'mem0-self-hosted-engine' ? 'http://localhost:8888/api' : 'https://api.mem0.ai/v1'} /></label>
            <label><span>User ID（必填）</span><input value={syncDraft.memorySyncUserId} onChange={(event) => setSyncDraft((previous) => ({ ...previous, memorySyncUserId: event.target.value }))} onBlur={() => { void saveSyncDraft() }} placeholder="用于隔离远程记忆" /></label>
            <label className="memory-engine-key-field"><span>API Key</span><div><input type={showSyncKey ? 'text' : 'password'} value={syncDraft.memorySyncApiKey} onChange={(event) => setSyncDraft((previous) => ({ ...previous, memorySyncApiKey: event.target.value }))} onBlur={() => { void saveSyncDraft() }} placeholder="Mem0 API Key" /><button type="button" onClick={() => setShowSyncKey((value) => !value)}>{showSyncKey ? '隐藏' : '显示'}</button></div></label>
          </div>
          <div className="memory-engine-actions"><button type="button" onClick={() => { void testMemoryEngineConnection() }} disabled={Boolean(syncBusy)}>{syncBusy === 'test' ? '测试中…' : '测试主记忆引擎'}</button></div>
          {syncStatus && <div className="memory-engine-status" role="status">{syncStatus}</div>}
        </div>
      )}
    </section>
  )
}
