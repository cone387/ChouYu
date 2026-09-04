import { useEffect, useState } from 'react'
import type { AppConfig } from '../../../shared/types'
import type { CapabilityInfo } from '../../../../../shared/capabilities'

interface MemoryEmbeddingCardProps {
  config: AppConfig
  onSaveConfig: (patch: Partial<AppConfig>) => Promise<void>
  refresh: () => Promise<void>
  embeddingCapabilities: CapabilityInfo[]
}

export default function MemoryEmbeddingCard({ config, onSaveConfig, refresh, embeddingCapabilities }: MemoryEmbeddingCardProps) {
  const [showEmbedding, setShowEmbedding] = useState(config.embeddingEnabled)
  const [showEmbeddingKey, setShowEmbeddingKey] = useState(false)
  const [embeddingDraft, setEmbeddingDraft] = useState({
    embeddingBaseUrl: config.embeddingBaseUrl,
    embeddingApiKey: config.embeddingApiKey,
    embeddingModel: config.embeddingModel
  })
  const [embeddingBusy, setEmbeddingBusy] = useState<'test' | 'rebuild' | ''>('')
  const [embeddingStatus, setEmbeddingStatus] = useState('')

  useEffect(() => {
    setEmbeddingDraft({
      embeddingBaseUrl: config.embeddingBaseUrl,
      embeddingApiKey: config.embeddingApiKey,
      embeddingModel: config.embeddingModel
    })
  }, [config.embeddingApiKey, config.embeddingBaseUrl, config.embeddingModel])

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

  return (
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
  )
}
