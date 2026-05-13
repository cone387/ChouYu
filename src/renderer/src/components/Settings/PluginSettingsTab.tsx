import { useState, useEffect } from 'react'
import { PluginInfo, AuthMethod } from '../../shared/types'

interface PluginSettingsTabProps {
  plugin: PluginInfo
}

export default function PluginSettingsTab({ plugin }: PluginSettingsTabProps) {
  const [authenticated, setAuthenticated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [activeMethodId, setActiveMethodId] = useState<string>('')
  const [feedToPet, setFeedToPet] = useState(false)
  const [customIcon, setCustomIcon] = useState('')
  const [hotkey, setHotkey] = useState('')

  const authMethods = plugin.authMethods || []

  useEffect(() => {
    // Set default active method
    if (authMethods.length > 0 && !activeMethodId) {
      setActiveMethodId(authMethods[0].id)
    }
  }, [authMethods, activeMethodId])

  useEffect(() => {
    setLoading(true)
    setMessage(null)
    window.electronAPI.plugin.isAuthenticated(plugin.id).then((result) => {
      setAuthenticated(result)
      setLoading(false)
    })
    // Load feedToPet preference
    window.electronAPI.db.getState(`plugin:${plugin.id}:feedToPet`).then((val) => {
      setFeedToPet(val === 'true')
    })
    // Load custom icon
    window.electronAPI.db.getState(`plugin:${plugin.id}:customIcon`).then((val) => {
      if (val) setCustomIcon(val)
    })
    // Load hotkey
    window.electronAPI.db.getState(`plugin:${plugin.id}:hotkey`).then((val) => {
      if (val) setHotkey(val)
    })
  }, [plugin.id])

  const activeMethod: AuthMethod | undefined = authMethods.find((m) => m.id === activeMethodId)
  const activeFields = activeMethod?.fields || []

  const handleFieldChange = (key: string, value: string) => {
    setFieldValues((prev) => ({ ...prev, [key]: value }))
  }

  const handleTabChange = (methodId: string) => {
    setActiveMethodId(methodId)
    setFieldValues({})
    setMessage(null)
  }

  const handleSubmit = async () => {
    // Validate required fields for active method
    const missingFields = activeFields
      .filter((f) => f.required !== false && !fieldValues[f.key]?.trim())
    if (missingFields.length > 0) {
      setMessage({ ok: false, text: `请填写：${missingFields.map((f) => f.label).join('、')}` })
      return
    }

    setSubmitting(true)
    setMessage(null)
    try {
      const credentials = { ...fieldValues, _authMethod: activeMethodId }
      const result = await window.electronAPI.plugin.login(plugin.id, credentials)
      if (result.ok) {
        setAuthenticated(true)
        setMessage({ ok: true, text: result.message })
      } else {
        setMessage({ ok: false, text: result.message })
      }
    } catch (err: any) {
      setMessage({ ok: false, text: err.message || '操作失败' })
    } finally {
      setSubmitting(false)
    }
  }

  const handleLogout = async () => {
    setSubmitting(true)
    setMessage(null)
    try {
      await window.electronAPI.plugin.logout(plugin.id)
      setAuthenticated(false)
      setFieldValues({})
      setMessage({ ok: true, text: '已登出' })
    } catch (err: any) {
      setMessage({ ok: false, text: err.message || '登出失败' })
    } finally {
      setSubmitting(false)
    }
  }

  const getButtonText = () => {
    if (!activeMethod) return '登录'
    switch (activeMethod.id) {
      case 'credentials': return '登录'
      case 'apikey': return '保存'
      case 'token': return '保存'
      default: return '登录'
    }
  }

  if (loading) {
    return <div className="settings-pane"><p>加载中...</p></div>
  }

  return (
    <div className="settings-pane">
      <div className="settings-field">
        <label>图标</label>
        <input
          type="text"
          value={customIcon}
          onChange={(e) => {
            const val = e.target.value
            setCustomIcon(val)
            window.electronAPI.db.setState(`plugin:${plugin.id}:customIcon`, val)
          }}
          placeholder={plugin.icon || '🔌'}
          maxLength={2}
          style={{ width: 60 }}
        />
      </div>
      <div className="settings-field">
        <label>快捷键</label>
        <input
          type="text"
          value={hotkey}
          onChange={(e) => {
            const val = e.target.value
            setHotkey(val)
            window.electronAPI.db.setState(`plugin:${plugin.id}:hotkey`, val)
          }}
          placeholder="例如 Alt+B"
          style={{ width: 120 }}
        />
        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>设置后需重启生效</span>
      </div>
      <div style={{ borderTop: '1px solid var(--border)', margin: '12px 0' }} />
      {authenticated ? (
        <>
          <div className="settings-field settings-field-row">
            <label>状态</label>
            <span className="plugin-auth-status">已登录</span>
          </div>
          {activeFields
            .filter((f) => f.persistent)
            .map((field) => (
              <div key={field.key} className="settings-field">
                <label>{field.label}</label>
                <input
                  type="text"
                  value={fieldValues[field.key] || ''}
                  disabled
                  placeholder={field.placeholder}
                />
              </div>
            ))}
          <div className="settings-field">
            <button
              className="plugin-auth-btn plugin-logout-btn"
              onClick={handleLogout}
              disabled={submitting}
            >
              登出
            </button>
          </div>
        </>
      ) : (
        <>
          {authMethods.length > 1 && (
            <div className="plugin-auth-tabs">
              {authMethods.map((method) => (
                <button
                  key={method.id}
                  className={`plugin-auth-tab${activeMethodId === method.id ? ' plugin-auth-tab-active' : ''}`}
                  onClick={() => handleTabChange(method.id)}
                  disabled={submitting}
                >
                  {method.label}
                </button>
              ))}
            </div>
          )}
          {activeFields.map((field) => (
            <div key={field.key} className="settings-field">
              <label>{field.label}</label>
              <input
                type={field.type === 'url' ? 'text' : field.type}
                value={fieldValues[field.key] || ''}
                onChange={(e) => handleFieldChange(field.key, e.target.value)}
                placeholder={field.placeholder}
                disabled={submitting}
              />
            </div>
          ))}
          <div className="settings-field">
            <button
              className="plugin-auth-btn"
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? '处理中...' : getButtonText()}
            </button>
          </div>
        </>
      )}
      {message && (
        <div className={`plugin-message ${message.ok ? 'plugin-message-ok' : 'plugin-message-error'}`}>
          {message.text}
        </div>
      )}

      <div className="settings-field settings-field-row" style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
        <label>执行后宠物评论</label>
        <label className="settings-switch">
          <input
            type="checkbox"
            checked={feedToPet}
            onChange={(e) => {
              setFeedToPet(e.target.checked)
              window.electronAPI.db.setState(`plugin:${plugin.id}:feedToPet`, e.target.checked ? 'true' : 'false')
            }}
          />
          <span className="settings-switch-slider" />
        </label>
      </div>
    </div>
  )
}
