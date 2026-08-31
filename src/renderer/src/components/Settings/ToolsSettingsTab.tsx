import { useEffect, useMemo, useState } from 'react'
import type { ToolCatalogItem } from '../../../../shared/tools'
import { getToolRiskLabel } from '../../../../shared/tools'
import './ToolsSettingsTab.css'

interface ToolsSettingsTabProps {
  globalEnabled: boolean
  onGlobalChange: (enabled: boolean) => void
  permissionMode: 'confirm' | 'auto' | 'full'
  onPermissionModeChange: (mode: 'confirm' | 'auto' | 'full') => void
}

export default function ToolsSettingsTab({ globalEnabled, onGlobalChange, permissionMode, onPermissionModeChange }: ToolsSettingsTabProps) {
  const [tools, setTools] = useState<ToolCatalogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busyName, setBusyName] = useState('')
  const [error, setError] = useState('')
  const groups = useMemo(() => [
    { key: 'builtin', label: '内置工具', tools: tools.filter((tool) => tool.source === 'builtin') },
    { key: 'plugin', label: '插件工具', tools: tools.filter((tool) => tool.source === 'plugin') }
  ].filter((group) => group.tools.length > 0), [tools])

  useEffect(() => {
    window.electronAPI.tools.list()
      .then(setTools)
      .catch((reason) => setError(reason instanceof Error ? reason.message : '工具列表加载失败。'))
      .finally(() => setLoading(false))
  }, [])

  const toggleTool = async (name: string, enabled: boolean) => {
    setBusyName(name)
    setError('')
    try {
      setTools(await window.electronAPI.tools.setEnabled(name, enabled))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '工具设置保存失败。')
    } finally {
      setBusyName('')
    }
  }

  return (
    <div className="settings-pane tool-settings-pane">
      <div className="settings-pane-heading">
        <h2>AI 工具</h2>
        <p>控制模型可以发现和请求哪些本机或插件能力。</p>
      </div>

      <div className="tool-master-card">
        <div>
          <strong>允许 AI 请求工具</strong>
          <span>敏感工具仍会在每次执行前单独询问。</span>
        </div>
        <label className="settings-switch">
          <input type="checkbox" checked={globalEnabled} onChange={(event) => onGlobalChange(event.target.checked)} aria-label="允许 AI 请求工具" />
          <span className="settings-switch-slider" />
        </label>
      </div>

      <div className="tool-permission-card">
        <div>
          <strong>操作权限</strong>
          <span>
            {permissionMode === 'confirm'
              ? '读取和写入类工具执行前都会请求确认。'
              : permissionMode === 'auto'
                ? '安全和读取类工具自动执行，写入类工具仍需确认。'
                : '所有已启用工具直接执行，请仅在可信环境使用。'}
          </span>
        </div>
        <select
          value={permissionMode}
          aria-label="AI 工具操作权限"
          onChange={(event) => onPermissionModeChange(event.target.value as ToolsSettingsTabProps['permissionMode'])}
        >
          <option value="confirm">手动确认</option>
          <option value="auto">自动审核</option>
          <option value="full">完全访问</option>
        </select>
      </div>

      {!globalEnabled && (
        <div className="tool-global-notice" role="status">总开关已关闭，Provider 请求不会携带任何工具定义。</div>
      )}

      {loading && <div className="tool-settings-empty" role="status">正在加载工具目录…</div>}
      {!loading && groups.map((group) => (
        <section key={group.key} className="tool-settings-group">
          <h3>{group.label}<span>{group.tools.length}</span></h3>
          <div className="tool-settings-list">
            {group.tools.map((tool) => (
              <article key={tool.name} className={`tool-catalog-card${tool.enabled ? '' : ' disabled'}`}>
                <div className={`tool-catalog-icon risk-${tool.risk}`} aria-hidden="true">
                  <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M7 3.5a3.5 3.5 0 015.8 2.6l3.1 3.1a2.5 2.5 0 010 3.6l-3.1 3.1a3.5 3.5 0 01-5.8-2.6l-2.3-2.3a3.5 3.5 0 012.3-7.5zM8 8l4 4"/>
                  </svg>
                </div>
                <div className="tool-catalog-copy">
                  <div className="tool-catalog-title">
                    <strong>{tool.displayName}</strong>
                    <span className={`tool-risk-pill risk-${tool.risk}`}>{getToolRiskLabel(tool.risk)}</span>
                  </div>
                  <p>{tool.description}</p>
                  <div className="tool-catalog-meta">
                    <code>{tool.name}</code>
                    <span>{tool.source === 'plugin' ? '插件' : '内置'}</span>
                    <span>
                      {permissionMode === 'full'
                        ? '直接执行'
                        : permissionMode === 'auto'
                          ? tool.risk === 'write' ? '写入需确认' : '自动执行'
                          : tool.requiresConfirmation ? '逐次确认' : '自动执行'}
                    </span>
                  </div>
                </div>
                <label className="settings-switch tool-toggle">
                  <input
                    type="checkbox"
                    checked={tool.enabled}
                    disabled={busyName === tool.name}
                    onChange={(event) => { void toggleTool(tool.name, event.target.checked) }}
                    aria-label={`${tool.enabled ? '禁用' : '启用'} ${tool.displayName}`}
                  />
                  <span className="settings-switch-slider" />
                </label>
              </article>
            ))}
          </div>
        </section>
      ))}

      {!loading && tools.length === 0 && <div className="tool-settings-empty">当前没有可用工具。</div>}
      {error && <div className="tool-settings-error" role="alert">{error}</div>}
    </div>
  )
}
