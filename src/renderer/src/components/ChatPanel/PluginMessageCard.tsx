import { useState } from 'react'
import { PluginMessageData } from '../../shared/types'

interface PluginMessageCardProps {
  data: PluginMessageData
}

export default function PluginMessageCard({ data }: PluginMessageCardProps) {
  const [showDetail, setShowDetail] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleAction = (action: string, payload?: string) => {
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
        // TODO: implement retry
        break
    }
  }

  const truncatedInput = data.inputContent
    ? data.inputContent.length > 80
      ? data.inputContent.slice(0, 80) + '…'
      : data.inputContent
    : ''

  return (
    <div className={`plugin-card ${data.ok ? 'plugin-card-ok' : 'plugin-card-error'}`}>
      <div className="plugin-card-header">
        <span className="plugin-card-icon">{data.pluginIcon || '🔌'}</span>
        <span className="plugin-card-name">{data.pluginName}</span>
        <span className="plugin-card-dot">·</span>
        <span className={`plugin-card-status ${data.ok ? '' : 'plugin-card-status-error'}`}>
          {data.message}
        </span>
      </div>

      {truncatedInput && (
        <div className="plugin-card-summary">
          {truncatedInput}
        </div>
      )}

      {data.detail && (
        <>
          <button
            className="plugin-card-detail-toggle"
            onClick={() => setShowDetail(!showDetail)}
          >
            {showDetail ? '收起详情 ▴' : '查看详情 ▾'}
          </button>
          {showDetail && (
            <pre className="plugin-card-detail">{data.detail}</pre>
          )}
        </>
      )}

      {data.actions && data.actions.length > 0 && (
        <div className="plugin-card-actions">
          {data.actions.map((act, i) => (
            <button
              key={i}
              className="plugin-card-action-btn"
              onClick={() => handleAction(act.action, act.payload)}
            >
              {act.action === 'copy' && copied ? '✓ 已复制' : act.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
