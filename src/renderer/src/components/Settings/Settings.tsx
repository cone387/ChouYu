import { useState, useEffect, useCallback } from 'react'
import { AppConfig, PluginInfo } from '../../shared/types'
import { DEFAULT_CONFIG } from '../../shared/constants'
import { DEFAULT_SOUL_MD } from '../../../../shared/config'
import type { AIModelListResult } from '../../../../shared/ai'
import PluginSettingsTab from './PluginSettingsTab'
import ModelPicker from '../ModelPicker/ModelPicker'
import ToolsSettingsTab from './ToolsSettingsTab'
import MemorySettingsTab from './MemorySettingsTab'
import './Settings.css'

interface SettingsProps {
  onClose: () => void
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>
  initialNav?: string
  focusMemoryId?: string
}

const NAV_ITEMS = [
  { key: 'ai', label: 'AI 提供者', icon: 'M4 7a4 4 0 018 0v1a2 2 0 012 2v4a2 2 0 01-2 2H2a2 2 0 01-2-2v-4a2 2 0 012-2V7z' },
  { key: 'tools', label: 'AI 工具', icon: 'tools' },
  { key: 'memory', label: '记忆中心', icon: 'memory' },
  { key: 'persona', label: '角色人格', icon: 'M7 1.5a3 3 0 013 3c0 2-3 4-3 4s-3-2-3-4a3 3 0 013-3z' },
  { key: 'general', label: '通用', icon: 'M7 1.5v2M7 10.5v2M1.5 7h2M10.5 7h2M3 3l1.4 1.4M9.6 9.6l1.4 1.4M11 3l-1.4 1.4M4.4 9.6L3 11' },
  { key: 'about', label: '关于', icon: 'M7 4v3M7 9.5v.5' }
]

export default function Settings({ onClose, dragHandleProps, initialNav, focusMemoryId }: SettingsProps) {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG)
  const [showKey, setShowKey] = useState(false)
  const [activeNav, setActiveNav] = useState<string>(initialNav || 'ai')
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const [appVersion, setAppVersion] = useState<string>('')
  const [updateStatus, setUpdateStatus] = useState<string>('')
  const [hotkeyDraft, setHotkeyDraft] = useState(DEFAULT_CONFIG.hotkey)
  const [saveError, setSaveError] = useState('')
  const [saveStatus, setSaveStatus] = useState('')
  const [modelOptions, setModelOptions] = useState<string[]>([])
  const [modelFetchStatus, setModelFetchStatus] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle')
  const [providerCheck, setProviderCheck] = useState<AIModelListResult | null>(null)
  const [manualModelEntry, setManualModelEntry] = useState(false)

  const fetchAvailableModels = useCallback(async () => {
    setModelFetchStatus('loading')
    setSaveError('')
    setSaveStatus('正在保存 AI 配置…')
    try {
      const saved = await window.electronAPI.db.saveConfig({
        provider: config.provider,
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.model
      })
      setConfig(saved)
      setSaveStatus('配置已保存，将用于下一次对话。')
      const result = await window.electronAPI.fetchModels()
      setProviderCheck(result)
      if (result.baseUrlAdjusted) {
        setConfig((previous) => ({ ...previous, baseUrl: result.baseUrl }))
      }
      const availableModels = result.models
      setModelOptions(availableModels)
      setModelFetchStatus(result.ok ? 'ready' : 'unavailable')
      if (result.ok) setManualModelEntry(false)
    } catch (error) {
      setModelOptions([])
      setModelFetchStatus('unavailable')
      setSaveStatus('')
      setSaveError(error instanceof Error ? error.message : 'AI 配置保存失败')
    }
  }, [config.provider, config.baseUrl, config.apiKey, config.model])

  useEffect(() => {
    window.electronAPI.db.getConfig().then((loaded) => {
      setConfig(loaded)
      setHotkeyDraft(loaded.hotkey)
    })
    window.electronAPI.plugin.getPlugins().then(setPlugins)
    window.electronAPI.getAppVersion().then(setAppVersion)

    const cleanups = [
      window.electronAPI.update.onAvailable((info) => setUpdateStatus(`发现新版本 v${info.version}`)),
      window.electronAPI.update.onNotAvailable(() => setUpdateStatus('已是最新版本')),
      window.electronAPI.update.onDownloading(() => setUpdateStatus('正在下载更新…')),
      window.electronAPI.update.onProgress((progress) => setUpdateStatus(`下载中 ${Math.round(progress.percent)}%`)),
      window.electronAPI.update.onDownloaded((info) => setUpdateStatus(`v${info.version} 已下载，退出时安装`)),
      window.electronAPI.update.onError((msg) => setUpdateStatus(`检查失败: ${msg}`)),
    ]
    // If no event fires within 10s, assume up-to-date
    const timer = setTimeout(() => {
      setUpdateStatus((prev) => prev === '检查中...' ? '已是最新版本' : prev)
    }, 10000)
    return () => { cleanups.forEach((fn) => fn()); clearTimeout(timer) }
  }, [])

  const pluginNavItems = plugins
    .filter((p) => p.hasAuth)
    .map((p) => ({
      key: `plugin-${p.id}`,
      label: p.name,
      icon: p.icon || '🔌'
    }))

  const allNavItems = [
    ...NAV_ITEMS.filter(item => item.key !== 'about'),
    ...pluginNavItems,
    ...NAV_ITEMS.filter(item => item.key === 'about')
  ]

  const save = async (patch: Partial<AppConfig>) => {
    const updated = { ...config, ...patch }
    setConfig(updated)
    setSaveError('')
    setSaveStatus('正在保存…')
    if (patch.provider || patch.baseUrl !== undefined || patch.apiKey !== undefined) {
      setModelOptions([])
      setModelFetchStatus('idle')
      setProviderCheck(null)
      setManualModelEntry(false)
    }
    try {
      const saved = await window.electronAPI.db.saveConfig(patch)
      setConfig(saved)
      setHotkeyDraft(saved.hotkey)
      setSaveStatus('配置已保存，将用于下一次对话。')
    } catch (error) {
      const current = await window.electronAPI.db.getConfig()
      setConfig(current)
      setHotkeyDraft(current.hotkey)
      setSaveStatus('')
      setSaveError(error instanceof Error ? error.message : '设置保存失败')
    }
  }

  const configuredModelValid = providerCheck?.ok
    ? providerCheck.models.includes(config.model)
    : null

  return (
    <div className="settings-panel">
      <div className="settings-header chat-panel-drag-handle" {...dragHandleProps}>
        <span className="settings-title">设置</span>
        <button className="settings-close" onClick={onClose} aria-label="关闭设置">&times;</button>
      </div>

      <div className="settings-body">
        <nav className="settings-nav" aria-label="设置分类">
          {allNavItems.map((item) => (
            <button
              key={item.key}
              className={`settings-nav-item${activeNav === item.key ? ' active' : ''}`}
              onClick={() => setActiveNav(item.key)}
              aria-current={activeNav === item.key ? 'page' : undefined}
            >
              {item.key.startsWith('plugin-') ? (
                <span className="settings-nav-icon-emoji">{item.icon}</span>
              ) : (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                  {item.key === 'ai' && <><rect x="2" y="3" width="10" height="9" rx="2"/><circle cx="5" cy="7.5" r="1"/><circle cx="9" cy="7.5" r="1"/><path d="M5 3V1.5M9 3V1.5"/></>}
                  {item.key === 'tools' && <><path d="M3 3.5h8v7H3z"/><path d="M5 1.5v2M9 1.5v2M5 10.5v2M9 10.5v2M1.5 5h1.5M11 5h1.5M1.5 9h1.5M11 9h1.5"/></>}
                  {item.key === 'memory' && <><path d="M4 3.5a3 3 0 016 0v7a3 3 0 01-6 0z"/><path d="M5.5 6h3M5.5 8.5h3"/></>}
                  {item.key === 'persona' && <><circle cx="7" cy="5" r="2.5"/><path d="M2.5 12c.7-2.3 2.2-3.5 4.5-3.5s3.8 1.2 4.5 3.5"/></>}
                  {item.key === 'general' && <><circle cx="7" cy="7" r="2"/><path d={item.icon}/></>}
                  {item.key === 'about' && <><circle cx="7" cy="7" r="5.5"/><path d={item.icon}/></>}
                </svg>
              )}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="settings-content">
          {activeNav === 'ai' && (
            <div className="settings-pane">
              <div className="settings-pane-heading">
                <h2>AI 提供者</h2>
                <p>配置用于对话的服务地址、凭据和默认模型。</p>
              </div>
              <div className="settings-card">
                <div className="settings-field">
                <label htmlFor="settings-provider">服务类型</label>
                <select
                  id="settings-provider"
                  value={config.provider}
                  onChange={(e) => save({ provider: e.target.value as 'openai' | 'claude' })}
                >
                  <option value="openai">OpenAI 兼容</option>
                  <option value="claude">Claude</option>
                </select>
              </div>
              <div className="settings-field">
                <label htmlFor="settings-base-url">Base URL</label>
                <input
                  id="settings-base-url"
                  type="text"
                  value={config.baseUrl}
                  onChange={(e) => { setConfig((prev) => ({ ...prev, baseUrl: e.target.value })); setSaveStatus('修改后移出输入框即可保存。') }}
                  onBlur={() => { void save({ baseUrl: config.baseUrl }) }}
                  placeholder="https://api.openai.com/v1"
                />
              </div>
              <div className="settings-field">
                <label htmlFor="settings-api-key">API Key</label>
                <div className="settings-key-row">
                  <input
                    id="settings-api-key"
                    type={showKey ? 'text' : 'password'}
                    value={config.apiKey}
                    onChange={(e) => { setConfig((prev) => ({ ...prev, apiKey: e.target.value })); setSaveStatus('修改后移出输入框即可保存。') }}
                    onBlur={() => { void save({ apiKey: config.apiKey }) }}
                    placeholder="sk-..."
                  />
                  <button className="settings-key-toggle" onClick={() => setShowKey(!showKey)} aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}>
                    {showKey ? '隐藏' : '显示'}
                  </button>
                </div>
              </div>
              <div className="settings-field">
                <label htmlFor="settings-model">默认模型</label>
                <div className="settings-model-row">
                  {modelOptions.length > 0 && !manualModelEntry ? (
                    <ModelPicker
                      id="settings-model"
                      value={config.model}
                      models={modelOptions}
                      status={modelFetchStatus === 'idle' ? 'unavailable' : modelFetchStatus}
                      statusMessage={providerCheck?.message}
                      onChange={(model) => { void save({ model }) }}
                      onRefresh={() => { void fetchAvailableModels() }}
                      onManualRequest={() => setManualModelEntry(true)}
                      variant="field"
                      placement="top"
                      invalid={configuredModelValid === false}
                      describedBy="settings-model-help"
                    />
                  ) : (
                    <div className="settings-model-manual">
                      <input
                        id="settings-model"
                        type="text"
                        autoFocus
                        value={config.model}
                        onChange={(e) => { setConfig((prev) => ({ ...prev, model: e.target.value })); setSaveStatus('修改后移出输入框即可保存。') }}
                        onBlur={() => { void save({ model: config.model }) }}
                        placeholder="手动输入模型名"
                        aria-describedby="settings-model-help"
                        aria-invalid={configuredModelValid === false}
                      />
                      {modelOptions.length > 0 && (
                        <button
                          type="button"
                          className="settings-model-mode-btn"
                          onClick={() => setManualModelEntry(false)}
                        >返回列表</button>
                      )}
                    </div>
                  )}
                  <button
                    type="button"
                    className="settings-fetch-btn"
                    onClick={() => { void fetchAvailableModels() }}
                    disabled={modelFetchStatus === 'loading'}
                  >
                    {modelFetchStatus === 'loading' ? '检测中…' : '测试连接'}
                  </button>
                </div>
                <div id="settings-model-help" className="settings-model-status" role="status">
                  {modelFetchStatus === 'idle' && '配置好 Provider、Base URL 和 API Key 后，点击测试连接。'}
                  {modelFetchStatus === 'ready' && `已获取 ${modelOptions.length} 个可用模型。`}
                  {modelFetchStatus === 'unavailable' && (providerCheck?.message || '未获取到模型，请检查配置。')}
                </div>
                {providerCheck && (
                  <div
                    className={`settings-provider-check ${providerCheck.ok ? (configuredModelValid ? 'success' : 'warning') : 'error'}`}
                    role={providerCheck.ok ? 'status' : 'alert'}
                    aria-live="polite"
                  >
                    <span className="settings-provider-check-icon" aria-hidden="true">
                      {providerCheck.ok ? (configuredModelValid ? '✓' : '!') : '×'}
                    </span>
                    <span>
                      <strong>{providerCheck.ok ? `服务连接正常 · ${providerCheck.models.length} 个模型` : '连接检测失败'}</strong>
                      <span>{providerCheck.message}</span>
                      {providerCheck.ok && configuredModelValid === false && (
                        <span>当前模型“{config.model}”不可用，请从模型列表中选择一个有效模型。</span>
                      )}
                    </span>
                  </div>
                )}
                <div className="settings-save-status" role="status" aria-live="polite">
                  {saveStatus || '设置会自动保存，并在下一次对话时生效。'}
                </div>
              </div>
              </div>
            </div>
          )}

          {activeNav === 'persona' && (
            <div className="settings-pane settings-persona-pane">
              <div className="settings-pane-heading">
                <h2>角色人格</h2>
                <p>定义 ChouYu 的性格、语气和回复风格。</p>
              </div>
              <div className="settings-card settings-persona-card">
                <div className="settings-field">
                <label htmlFor="settings-soul">SOUL.md 人格设定</label>
                <textarea
                  id="settings-soul"
                  className="settings-soul-editor"
                  value={config.soulMd}
                  onChange={(e) => setConfig((prev) => ({ ...prev, soulMd: e.target.value }))}
                  onBlur={() => { void save({ soulMd: config.soulMd }) }}
                  aria-describedby="settings-soul-help"
                />
                <div id="settings-soul-help" className="settings-help">保存后会立即应用到下一次 AI 对话。</div>
                <button
                  className="settings-secondary-btn"
                  onClick={() => { setConfig((prev) => ({ ...prev, soulMd: DEFAULT_SOUL_MD })); void save({ soulMd: DEFAULT_SOUL_MD }) }}
                >恢复默认人格</button>
              </div>
              </div>
            </div>
          )}

          {activeNav === 'tools' && (
            <ToolsSettingsTab
              globalEnabled={config.aiToolsEnabled}
              onGlobalChange={(enabled) => { void save({ aiToolsEnabled: enabled }) }}
            />
          )}

          {activeNav === 'memory' && (
            <MemorySettingsTab
              enabled={config.memoryEnabled}
              onEnabledChange={(enabled) => { void save({ memoryEnabled: enabled }) }}
              config={config}
              onSaveConfig={save}
              focusMemoryId={focusMemoryId}
            />
          )}

          {activeNav === 'general' && (
            <div className="settings-pane">
              <div className="settings-pane-heading">
                <h2>通用设置</h2>
                <p>调整启动行为、宠物显示和常用快捷键。</p>
              </div>
              <div className="settings-card">
              <div className="settings-field settings-field-row">
                <label>开机自启</label>
                <label className="settings-switch">
                  <input
                    type="checkbox"
                    aria-label="开机自启"
                    checked={config.autoStart}
                    onChange={(e) => {
                      const enabled = e.target.checked
                      void save({ autoStart: enabled })
                    }}
                  />
                  <span className="settings-switch-slider" />
                </label>
              </div>
              <div className="settings-field">
                <label htmlFor="settings-pet-size">宠物大小 <span className="settings-field-value">{config.petSize}px</span></label>
                <input
                  id="settings-pet-size"
                  type="range"
                  min="40"
                  max="160"
                  step="8"
                  value={config.petSize}
                  onChange={(e) => setConfig((prev) => ({ ...prev, petSize: Number(e.target.value) }))}
                  onPointerUp={() => { void save({ petSize: config.petSize }) }}
                  onKeyUp={() => { void save({ petSize: config.petSize }) }}
                  onBlur={() => { void save({ petSize: config.petSize }) }}
                />
              </div>
              <div className="settings-field settings-field-row">
                <label htmlFor="settings-hotkey">唤出面板</label>
                <div className="settings-hotkey-row">
                  <input
                    id="settings-hotkey"
                    type="text"
                    value={hotkeyDraft}
                    onChange={(e) => setHotkeyDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void save({ hotkey: hotkeyDraft }) }}
                    aria-describedby="settings-hotkey-help"
                  />
                  <button className="settings-secondary-btn" onClick={() => { void save({ hotkey: hotkeyDraft }) }}>应用</button>
                </div>
              </div>
              <div id="settings-hotkey-help" className="settings-help">示例：Alt+Space、CommandOrControl+Shift+Y</div>
              </div>

              <div className="settings-section-title">智能功能</div>
              <div className="settings-card settings-toggle-card">
              <div className="settings-field settings-field-row">
                <label>开机问好</label>
                <label className="settings-switch">
                  <input
                    type="checkbox"
                    aria-label="开机问好"
                    checked={config.proactiveGreeting}
                    onChange={(e) => save({ proactiveGreeting: e.target.checked })}
                  />
                  <span className="settings-switch-slider" />
                </label>
              </div>
              <div className="settings-field settings-field-row">
                <label>久坐提醒</label>
                <label className="settings-switch">
                  <input
                    type="checkbox"
                    aria-label="久坐提醒"
                    checked={config.proactiveRestReminder}
                    onChange={(e) => save({ proactiveRestReminder: e.target.checked })}
                  />
                  <span className="settings-switch-slider" />
                </label>
              </div>
              <div className="settings-field settings-field-row">
                <label>剪贴板感知</label>
                <label className="settings-switch">
                  <input
                    type="checkbox"
                    aria-label="剪贴板感知"
                    checked={config.clipboardWatch}
                    onChange={(e) => save({ clipboardWatch: e.target.checked })}
                  />
                  <span className="settings-switch-slider" />
                </label>
              </div>
              <div className="settings-field settings-field-row">
                <label>AI 工具调用</label>
                <label className="settings-switch">
                  <input
                    type="checkbox"
                    aria-label="AI 工具调用"
                    checked={config.aiToolsEnabled}
                    onChange={(e) => save({ aiToolsEnabled: e.target.checked })}
                  />
                  <span className="settings-switch-slider" />
                </label>
              </div>
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
              <div className="settings-about-version">v{appVersion}</div>
              <div className="settings-about-desc">你的桌面 AI 宠物助手</div>
              <button
                className="settings-about-update-btn"
                onClick={() => {
                  setUpdateStatus('检查中...')
                  window.electronAPI.checkForUpdates().catch(() => setUpdateStatus('检查失败'))
                }}
                disabled={updateStatus === '检查中...'}
              >
                {updateStatus || '检查更新'}
              </button>
            </div>
          )}

          {activeNav.startsWith('plugin-') && (() => {
            const pluginId = activeNav.replace('plugin-', '')
            const plugin = plugins.find((p) => p.id === pluginId)
            if (!plugin) return null
            return <PluginSettingsTab plugin={plugin} />
          })()}
          {saveError && <div className="settings-error" role="alert">{saveError}</div>}
        </div>
      </div>
    </div>
  )
}
