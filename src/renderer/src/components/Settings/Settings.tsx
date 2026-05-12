import { useState, useEffect } from 'react'
import { AppConfig } from '../../shared/types'
import { DEFAULT_CONFIG } from '../../shared/constants'
import './Settings.css'

interface SettingsProps {
  onClose: () => void
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>
}

export default function Settings({ onClose, dragHandleProps }: SettingsProps) {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG)
  const [showKey, setShowKey] = useState(false)

  useEffect(() => {
    window.electronAPI.db.getConfig().then(setConfig)
  }, [])

  const save = (patch: Partial<AppConfig>) => {
    const updated = { ...config, ...patch }
    setConfig(updated)
    window.electronAPI.db.saveConfig(patch)
  }

  return (
    <div className="settings-panel">
      <div className="settings-header chat-panel-drag-handle" {...dragHandleProps}>
        <span className="settings-title">设置</span>
        <button className="settings-close" onClick={onClose}>&times;</button>
      </div>

      <div className="settings-content">
        <section className="settings-section">
          <h3>AI 提供者</h3>
          <div className="settings-field">
            <label>Provider</label>
            <select
              value={config.provider}
              onChange={(e) => save({ provider: e.target.value as 'openai' | 'claude' })}
            >
              <option value="openai">OpenAI 兼容</option>
              <option value="claude">Claude</option>
            </select>
          </div>
          <div className="settings-field">
            <label>Base URL</label>
            <input
              type="text"
              value={config.baseUrl}
              onChange={(e) => save({ baseUrl: e.target.value })}
              placeholder="https://api.openai.com/v1"
            />
          </div>
          <div className="settings-field">
            <label>API Key</label>
            <div className="settings-key-row">
              <input
                type={showKey ? 'text' : 'password'}
                value={config.apiKey}
                onChange={(e) => save({ apiKey: e.target.value })}
                placeholder="sk-..."
              />
              <button onClick={() => setShowKey(!showKey)}>
                {showKey ? '隐藏' : '显示'}
              </button>
            </div>
          </div>
          <div className="settings-field">
            <label>模型</label>
            <input
              type="text"
              value={config.model}
              onChange={(e) => save({ model: e.target.value })}
              placeholder="gpt-4o"
            />
          </div>
        </section>

        <section className="settings-section">
          <h3>快捷键</h3>
          <div className="settings-field">
            <label>唤出面板</label>
            <input type="text" value={config.hotkey} disabled />
          </div>
        </section>
      </div>
    </div>
  )
}
