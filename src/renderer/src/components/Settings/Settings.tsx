import { useState, useEffect } from 'react'
import { AppConfig } from '../../shared/types'
import { DEFAULT_CONFIG } from '../../shared/constants'
import './Settings.css'

interface SettingsProps {
  onClose: () => void
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>
}

const NAV_ITEMS = [
  { key: 'ai', label: 'AI 提供者', icon: 'M4 7a4 4 0 018 0v1a2 2 0 012 2v4a2 2 0 01-2 2H2a2 2 0 01-2-2v-4a2 2 0 012-2V7z' },
  { key: 'general', label: '通用', icon: 'M7 1.5v2M7 10.5v2M1.5 7h2M10.5 7h2M3 3l1.4 1.4M9.6 9.6l1.4 1.4M11 3l-1.4 1.4M4.4 9.6L3 11' },
  { key: 'about', label: '关于', icon: 'M7 4v3M7 9.5v.5' }
] as const

type NavKey = typeof NAV_ITEMS[number]['key']

export default function Settings({ onClose, dragHandleProps }: SettingsProps) {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG)
  const [showKey, setShowKey] = useState(false)
  const [activeNav, setActiveNav] = useState<NavKey>('ai')

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

      <div className="settings-body">
        <nav className="settings-nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              className={`settings-nav-item${activeNav === item.key ? ' active' : ''}`}
              onClick={() => setActiveNav(item.key)}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                {item.key === 'ai' && <><rect x="2" y="3" width="10" height="9" rx="2"/><circle cx="5" cy="7.5" r="1"/><circle cx="9" cy="7.5" r="1"/><path d="M5 3V1.5M9 3V1.5"/></>}
                {item.key === 'general' && <><circle cx="7" cy="7" r="2"/><path d={item.icon}/></>}
                {item.key === 'about' && <><circle cx="7" cy="7" r="5.5"/><path d={item.icon}/></>}
              </svg>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="settings-content">
          {activeNav === 'ai' && (
            <div className="settings-pane">
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
                  <button className="settings-key-toggle" onClick={() => setShowKey(!showKey)}>
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
            </div>
          )}

          {activeNav === 'general' && (
            <div className="settings-pane">
              <div className="settings-field settings-field-row">
                <label>开机自启</label>
                <label className="settings-switch">
                  <input
                    type="checkbox"
                    checked={config.autoStart}
                    onChange={(e) => save({ autoStart: e.target.checked })}
                  />
                  <span className="settings-switch-slider" />
                </label>
              </div>
              <div className="settings-field">
                <label>宠物大小 <span className="settings-field-value">{config.petSize}px</span></label>
                <input
                  type="range"
                  min="40"
                  max="160"
                  step="8"
                  value={config.petSize}
                  onChange={(e) => save({ petSize: Number(e.target.value) })}
                />
              </div>
              <div className="settings-field settings-field-row">
                <label>唤出面板</label>
                <kbd className="settings-kbd">{config.hotkey}</kbd>
              </div>
            </div>
          )}

          {activeNav === 'about' && (
            <div className="settings-pane settings-about-pane">
              <div className="settings-about-logo">
                <svg width="48" height="48" viewBox="0 0 80 80">
                  <circle cx="40" cy="44" r="28" fill="#6C5CE7"/>
                  <ellipse cx="30" cy="38" rx="4" ry="5" fill="white"/>
                  <ellipse cx="50" cy="38" rx="4" ry="5" fill="white"/>
                  <circle cx="30" cy="39" r="2.5" fill="#2d2d2d"/>
                  <circle cx="50" cy="39" r="2.5" fill="#2d2d2d"/>
                  <path d="M 32 52 Q 40 58 48 52" stroke="#2d2d2d" fill="none" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </div>
              <div className="settings-about-name">ChouYu</div>
              <div className="settings-about-version">v1.0.0</div>
              <div className="settings-about-desc">你的桌面 AI 宠物助手</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
