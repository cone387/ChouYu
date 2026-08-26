import { useState } from 'react'
import { PluginMessageData } from '../../shared/types'

interface PluginMessageCardProps {
  data: PluginMessageData
}

export default function PluginMessageCard({ data }: PluginMessageCardProps) {
  const [showDetail, setShowDetail] = useState(false)
  const [copied, setCopied] = useState(false)
  const [current, setCurrent] = useState(data)
  const [retrying, setRetrying] = useState(false)

  const handleAction = async (action: string, payload?: string) => {
    switch (action) {
      case 'copy':
        if (payload) {
          navigator.clipboard.writeText(payload)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }
        break
      case 'open-url':
        if (payload) window.open(payload, '_blank')
        break
      case 'retry':
        if (retrying) break
        setRetrying(true)
        try {
          setCurrent(await window.electronAPI.plugin.execute(current.pluginId, current.inputContent))
        } finally {
          setRetrying(false)
        }
        break
    }
  }

  const truncatedInput = current.inputContent
    ? current.inputContent.length > 80
      ? current.inputContent.slice(0, 80) + '…'
      : current.inputContent
    : ''

  return (
    <div className={`plugin-card ${current.ok ? 'plugin-card-ok' : 'plugin-card-error'}`} aria-busy={retrying}>
      <div className="plugin-card-header">
        <span className="plugin-card-icon" aria-hidden="true">{current.pluginIcon || '◇'}</span>
        <span className="plugin-card-name">{current.pluginName}</span>
        <span className="plugin-card-dot">·</span>
        <span className={`plugin-card-status ${current.ok ? '' : 'plugin-card-status-error'}`} role="status">
          {retrying ? '正在重试…' : current.message}
        </span>
      </div>

      {truncatedInput && (
        <div className="plugin-card-summary">
          {truncatedInput}
        </div>
      )}

      {current.detail && (
        <>
          <button
            className="plugin-card-detail-toggle"
            onClick={() => setShowDetail(!showDetail)}
          >
            {showDetail ? '收起详情 ▴' : '查看详情 ▾'}
          </button>
          {showDetail && (
            <pre className="plugin-card-detail">{current.detail}</pre>
          )}
        </>
      )}

      {current.actions && current.actions.length > 0 && (
        <div className="plugin-card-actions">
          {current.actions.map((act, i) => (
            <button
              key={i}
              className="plugin-card-action-btn"
              onClick={() => { void handleAction(act.action, act.payload) }}
              disabled={retrying}
            >
              {act.action === 'copy' && copied ? '✓ 已复制' : act.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
