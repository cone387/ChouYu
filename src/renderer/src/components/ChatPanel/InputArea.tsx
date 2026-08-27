import { useState, useRef, useCallback, useEffect } from 'react'
import CommandMenu, { getFilteredCommands } from './CommandMenu'
import ModelPicker from '../ModelPicker/ModelPicker'
import WindowCapturePicker, { CaptureAction } from '../WindowCapturePicker/WindowCapturePicker'
import { PluginInfo } from '../../shared/types'
import type { CaptureSourceInfo, VisualQuickAction } from '../../../../shared/capture'
import { VISUAL_ACTION_PROMPTS } from '../../../../shared/capture'
import {
  getAttachmentValidationError,
  MAX_ATTACHMENT_COUNT,
  readAttachmentFile,
  type PendingAttachment
} from '../../core/attachments'
export type { PendingAttachment } from '../../core/attachments'

interface InputAreaProps {
  onSend: (content: string, attachments?: PendingAttachment[]) => void
  onStop?: () => void
  disabled: boolean
  autoFocus?: boolean
  model?: string
  onModelChange?: (model: string) => void
  onScreenshot?: (hidePanel: boolean, callback: (dataUrl: string) => void) => void
  plugins?: PluginInfo[]
  pluginCommands?: { cmd: string; desc: string }[]
  initialActivePlugin?: PluginInfo | null
  onInitialPluginConsumed?: () => void
  initialAttachment?: PendingAttachment | null
  onInitialAttachmentConsumed?: () => void
}

export default function InputArea({ onSend, onStop, disabled, autoFocus, model, onModelChange, onScreenshot, plugins, pluginCommands, initialActivePlugin, onInitialPluginConsumed, initialAttachment, onInitialAttachmentConsumed }: InputAreaProps) {
  const [value, setValue] = useState('')
  const [showCommands, setShowCommands] = useState(false)
  const [modelPickerOpenRequest, setModelPickerOpenRequest] = useState(0)
  const [showScreenshotMenu, setShowScreenshotMenu] = useState(false)
  const [hideWindowOnCapture, setHideWindowOnCapture] = useState(true)
  const [modelOptions, setModelOptions] = useState<string[]>([])
  const [modelListStatus, setModelListStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const [modelListMessage, setModelListMessage] = useState('')
  const [cmdIndex, setCmdIndex] = useState(0)
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [activePlugin, setActivePlugin] = useState<PluginInfo | null>(null)
  const [showPluginOverflow, setShowPluginOverflow] = useState(false)
  const [attachmentError, setAttachmentError] = useState('')
  const [showWindowCapture, setShowWindowCapture] = useState(false)
  const [captureSources, setCaptureSources] = useState<CaptureSourceInfo[]>([])
  const [captureSourcesLoading, setCaptureSourcesLoading] = useState(false)
  const [captureSourcesError, setCaptureSourcesError] = useState('')
  const [recentCaptures, setRecentCaptures] = useState<PendingAttachment[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`
  }, [])

  useEffect(() => {
    resizeTextarea()
  }, [value, resizeTextarea])

  useEffect(() => {
    if (autoFocus === false) return
    const tryFocus = () => textareaRef.current?.focus()
    tryFocus()
    const t1 = setTimeout(tryFocus, 100)
    const t2 = setTimeout(tryFocus, 300)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [])

  useEffect(() => {
    if (initialActivePlugin) {
      setActivePlugin(initialActivePlugin)
      onInitialPluginConsumed?.()
    }
  }, [initialActivePlugin, onInitialPluginConsumed])

  useEffect(() => {
    if (initialAttachment) {
      setAttachments((prev) => prev.length < MAX_ATTACHMENT_COUNT ? [...prev, initialAttachment] : prev)
      onInitialAttachmentConsumed?.()
    }
  }, [initialAttachment, onInitialAttachmentConsumed])

  useEffect(() => {
    if (!showScreenshotMenu) return
    const dismiss = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.screenshot-selector')) {
        setShowScreenshotMenu(false)
      }
    }
    document.addEventListener('mousedown', dismiss)
    return () => document.removeEventListener('mousedown', dismiss)
  }, [showScreenshotMenu])

  useEffect(() => {
    if (!showPluginOverflow) return
    const dismiss = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.plugin-overflow-wrapper')) {
        setShowPluginOverflow(false)
      }
    }
    document.addEventListener('mousedown', dismiss)
    return () => document.removeEventListener('mousedown', dismiss)
  }, [showPluginOverflow])

  const refreshModels = useCallback(async () => {
    setModelListStatus('loading')
    setModelListMessage('正在检测 Provider 连接…')
    try {
      const result = await window.electronAPI.fetchModels()
      setModelOptions(result.models)
      setModelListMessage(result.message)
      setModelListStatus(result.ok ? 'ready' : 'unavailable')
    } catch {
      setModelOptions([])
      setModelListStatus('unavailable')
      setModelListMessage('模型检测失败，请稍后重试。')
    }
  }, [])

  useEffect(() => {
    void refreshModels()
    return window.electronAPI.onConfigChanged(() => {
      void refreshModels()
    })
  }, [refreshModels])

  const handleSend = useCallback(() => {
    const trimmed = value.trim()
    if ((!trimmed && attachments.length === 0) || disabled) return
    if (activePlugin) {
      onSend(`/${activePlugin.command} ${trimmed}`)
      setValue('')
      setAttachments([])
      setShowCommands(false)
      setActivePlugin(null)
      // Keep focus on textarea after plugin execution
      setTimeout(() => textareaRef.current?.focus(), 50)
      return
    }
    onSend(trimmed, attachments.length > 0 ? attachments : undefined)
    setValue('')
    setAttachments([])
    setAttachmentError('')
    setShowCommands(false)
  }, [value, disabled, onSend, attachments, activePlugin])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && activePlugin) {
      e.preventDefault()
      e.nativeEvent.stopImmediatePropagation()
      setActivePlugin(null)
      return
    }

    if (showCommands) {
      const allCommands = pluginCommands ? [...[
        { cmd: '/new', desc: '新建对话' },
        { cmd: '/clear', desc: '清空当前对话' },
        { cmd: '/settings', desc: '打开设置' },
        { cmd: '/model', desc: '切换模型' },
        { cmd: '/help', desc: '查看可用指令' }
      ], ...pluginCommands] : undefined
      const filtered = getFilteredCommands(value, allCommands)
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setCmdIndex((prev) => (prev + 1) % filtered.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setCmdIndex((prev) => (prev - 1 + filtered.length) % filtered.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        if (filtered[cmdIndex]) handleCommand(filtered[cmdIndex].cmd)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.nativeEvent.stopImmediatePropagation()
        setShowCommands(false)
        return
      }
    }

    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      handleSend()
      return
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value
    setValue(v)
    const shouldShow = v === '/' || (v.startsWith('/') && !v.includes(' '))
    setShowCommands(shouldShow)
    if (shouldShow) setCmdIndex(0)
  }

  const handleCommand = (cmd: string) => {
    setShowCommands(false)
    setValue('')
    switch (cmd) {
      case '/new':
        onSend('/new')
        break
      case '/clear':
        onSend('/clear')
        break
      case '/help':
        onSend('/help')
        break
      case '/settings':
        onSend('/settings')
        break
      case '/model':
        setModelPickerOpenRequest((previous) => previous + 1)
        break
      default: {
        // Find matching plugin for placeholder hint
        const matchedPlugin = (plugins || []).find((p) => `/${p.command}` === cmd)
        setValue(cmd + ' ')
        textareaRef.current?.focus()
        // Temporarily show plugin placeholder as hint
        if (matchedPlugin && textareaRef.current) {
          textareaRef.current.setAttribute('placeholder', matchedPlugin.inputPlaceholder || matchedPlugin.description)
        }
        break
      }
    }
  }

  const doScreenshot = useCallback((hidePanel?: boolean) => {
    if (attachments.length >= MAX_ATTACHMENT_COUNT) {
      setAttachmentError(`最多添加 ${MAX_ATTACHMENT_COUNT} 个附件。`)
      return
    }
    setShowScreenshotMenu(false)
    const hide = hidePanel ?? hideWindowOnCapture
    onScreenshot?.(hide, (dataUrl) => {
      const attachment: PendingAttachment = { type: 'image', data: dataUrl, name: `截图${Date.now()}.png` }
      setAttachments((prev) => prev.length < MAX_ATTACHMENT_COUNT ? [...prev, attachment] : prev)
      setRecentCaptures((prev) => [attachment, ...prev.filter((item) => item.data !== attachment.data)].slice(0, 5))
    })
  }, [attachments.length, onScreenshot, hideWindowOnCapture])

  const doScreenshotAction = useCallback((action: VisualQuickAction) => {
    if (disabled) return
    setShowScreenshotMenu(false)
    onScreenshot?.(hideWindowOnCapture, (dataUrl) => {
      const attachment: PendingAttachment = { type: 'image', data: dataUrl, name: `截图${Date.now()}.png` }
      setRecentCaptures((prev) => [attachment, ...prev.filter((item) => item.data !== attachment.data)].slice(0, 5))
      onSend(VISUAL_ACTION_PROMPTS[action], [attachment])
    })
  }, [disabled, hideWindowOnCapture, onScreenshot, onSend])

  const refreshCaptureSources = useCallback(async () => {
    setCaptureSourcesLoading(true)
    setCaptureSourcesError('')
    try {
      const sources = await window.electronAPI.getCaptureSources()
      setCaptureSources(sources)
      if (sources.length === 0) setCaptureSourcesError('没有读取到可捕获的窗口，请检查系统屏幕录制权限。')
    } catch (error) {
      setCaptureSources([])
      setCaptureSourcesError(error instanceof Error ? error.message : '读取窗口列表失败。')
    } finally {
      setCaptureSourcesLoading(false)
    }
  }, [])

  const openWindowCapture = useCallback(() => {
    if (disabled) return
    setShowScreenshotMenu(false)
    setShowWindowCapture(true)
    void refreshCaptureSources()
  }, [disabled, refreshCaptureSources])

  const captureWindowSource = useCallback(async (source: CaptureSourceInfo, action: CaptureAction) => {
    if (attachments.length >= MAX_ATTACHMENT_COUNT && action === 'attach') {
      setShowWindowCapture(false)
      setAttachmentError(`最多添加 ${MAX_ATTACHMENT_COUNT} 个附件。`)
      return
    }
    setCaptureSourcesLoading(true)
    setCaptureSourcesError('')
    try {
      const dataUrl = await window.electronAPI.captureSource(source.id, true)
      const safeName = source.name.replace(/[<>:"/\\|?*]/g, '_').slice(0, 60) || '窗口截图'
      const attachment: PendingAttachment = { type: 'image', data: dataUrl, name: `${safeName}.png` }
      setRecentCaptures((prev) => [attachment, ...prev.filter((item) => item.data !== attachment.data)].slice(0, 5))
      setShowWindowCapture(false)
      if (action === 'attach') {
        setAttachments((prev) => [...prev, attachment])
      } else {
        onSend(VISUAL_ACTION_PROMPTS[action], [attachment])
      }
    } catch (error) {
      setCaptureSourcesError(error instanceof Error ? error.message : '窗口截图失败，请重试。')
    } finally {
      setCaptureSourcesLoading(false)
    }
  }, [attachments.length, onSend])

  const runVisualAttachmentAction = useCallback((action: VisualQuickAction) => {
    if (disabled || !attachments.some((attachment) => attachment.type === 'image')) return
    onSend(VISUAL_ACTION_PROMPTS[action], attachments)
    setAttachments([])
    setAttachmentError('')
  }, [attachments, disabled, onSend])

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        doScreenshot()
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [doScreenshot])

  const handleFileSelect = useCallback(async () => {
    if (attachments.length >= MAX_ATTACHMENT_COUNT) {
      setAttachmentError(`最多添加 ${MAX_ATTACHMENT_COUNT} 个附件。`)
      return
    }
    const result = await window.electronAPI.openFileDialog()
    if (result) {
      setAttachments((prev) => [...prev, result])
      setAttachmentError('')
    }
  }, [attachments.length])

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const [dragOver, setDragOver] = useState(false)

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    let nextCount = attachments.length
    let firstError = ''
    files.forEach((file) => {
      const validationError = getAttachmentValidationError(file, nextCount)
      if (validationError) {
        firstError ||= validationError
        return
      }
      nextCount++
      void readAttachmentFile(file)
        .then((attachment) => setAttachments((prev) => [...prev, attachment]))
        .catch((error) => setAttachmentError(error instanceof Error ? error.message : '附件读取失败'))
    })
    setAttachmentError(firstError)
  }, [attachments.length])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(true)
  }, [])

  const handleDragLeave = useCallback(() => {
    setDragOver(false)
  }, [])

  const configuredModelInvalid = modelListStatus === 'ready' && Boolean(model) && !modelOptions.includes(model || '')

  return (
    <div className="input-area">
      {showCommands && (
        <CommandMenu
          filter={value}
          selectedIndex={cmdIndex}
          onSelect={handleCommand}
          onClose={() => setShowCommands(false)}
          pluginCommands={pluginCommands}
        />
      )}
      <div
        className={`input-container${dragOver ? ' drag-over' : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        {attachmentError && <div className="attachment-error" role="alert">{attachmentError}</div>}
        {attachments.length > 0 && (
          <>
            <div className="attachment-list">
              {attachments.map((att, i) => (
                <div key={i} className="attachment-item">
                  {att.type === 'image' ? (
                    <img src={att.data} className="attachment-thumb" alt={att.name} onClick={() => setPreviewImage(att.data)} />
                  ) : (
                    <div className="attachment-file">
                      <span className="attachment-file-icon" aria-hidden="true">
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"><path d="M3 1.5h6l4 4v9H3zM9 1.5v4h4"/></svg>
                      </span>
                      <span className="attachment-file-name">{att.name}</span>
                    </div>
                  )}
                  <button className="attachment-remove" onClick={() => removeAttachment(i)} aria-label={`移除附件 ${att.name}`}>✕</button>
                </div>
              ))}
            </div>
            {attachments.some((attachment) => attachment.type === 'image') && (
              <div className="attachment-quick-actions" aria-label="图片快捷操作">
                <span>用 AI 处理图片</span>
                <button type="button" onClick={() => runVisualAttachmentAction('ocr')} disabled={disabled}>识别文字</button>
                <button type="button" onClick={() => runVisualAttachmentAction('summarize')} disabled={disabled}>总结</button>
                <button type="button" onClick={() => runVisualAttachmentAction('translate')} disabled={disabled}>翻译</button>
              </div>
            )}
          </>
        )}
        <textarea
          ref={textareaRef}
          className="input-textarea"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={activePlugin ? (activePlugin.inputPlaceholder || '输入内容...') : '输入消息，/ 打开指令菜单...'}
          rows={3}
          disabled={disabled}
          autoFocus={autoFocus}
          aria-keyshortcuts="Control+Enter Meta+Enter"
          aria-label={activePlugin ? `${activePlugin.name} 输入内容` : '输入消息'}
        />
        <div className="input-toolbar">
          <div className="input-toolbar-left">
            <div className="screenshot-selector">
              {showScreenshotMenu && (
                <div className="screenshot-dropdown">
                  <button className="screenshot-menu-item" onClick={() => doScreenshot()}>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="5" cy="12" r="2"/><circle cx="11" cy="12" r="2"/>
                      <path d="M6.5 10.5L11 3M9.5 10.5L5 3"/>
                    </svg>
                    <span className="screenshot-menu-label">截图</span>
                    <span className="screenshot-menu-shortcut">Ctrl+Shift+A</span>
                  </button>
                  <button className="screenshot-menu-item" onClick={() => doScreenshotAction('ocr')} disabled={disabled}>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <path d="M3 5V3h3M10 3h3v2M13 11v2h-3M6 13H3v-2M5 8h6M8 5.5v5"/>
                    </svg>
                    <span className="screenshot-menu-label">文字识别</span>
                  </button>
                  <button className="screenshot-menu-item" onClick={openWindowCapture} disabled={disabled}>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <rect x="2" y="3" width="12" height="9" rx="1"/><path d="M5 14h6M8 12v2"/>
                    </svg>
                    <span className="screenshot-menu-label">窗口或屏幕</span>
                  </button>
                  <button className="screenshot-menu-item disabled" disabled>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <rect x="2" y="2" width="12" height="12" rx="1"/><path d="M2 10l4-4 3 3 5-5"/>
                    </svg>
                    <span className="screenshot-menu-label">滚动截图（稍后支持）</span>
                  </button>
                  {recentCaptures.length > 0 && (
                    <>
                      <div className="screenshot-menu-divider" />
                      <div className="recent-captures-label">最近截图</div>
                      <div className="recent-captures">
                        {recentCaptures.map((capture, index) => (
                          <button
                            key={`${capture.name}-${index}`}
                            type="button"
                            onClick={() => {
                              if (attachments.length >= MAX_ATTACHMENT_COUNT) {
                                setAttachmentError(`最多添加 ${MAX_ATTACHMENT_COUNT} 个附件。`)
                                setShowScreenshotMenu(false)
                                return
                              }
                              setAttachments((prev) => [...prev, capture])
                              setShowScreenshotMenu(false)
                            }}
                            aria-label={`再次添加 ${capture.name}`}
                            title={capture.name}
                          >
                            <img src={capture.data} alt="" />
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  <div className="screenshot-menu-divider" />
                  <label className="screenshot-menu-item screenshot-menu-check">
                    <input
                      type="checkbox"
                      checked={hideWindowOnCapture}
                      onChange={(e) => setHideWindowOnCapture(e.target.checked)}
                    />
                    <span className="screenshot-menu-label">隐藏当前窗口</span>
                  </label>
                </div>
              )}
              <div className="screenshot-btn-group">
                <button className="toolbar-btn screenshot-btn" title="截图" aria-label="截图" onClick={() => doScreenshot()}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="5" cy="12" r="2"/>
                    <circle cx="11" cy="12" r="2"/>
                    <path d="M6.5 10.5L11 3M9.5 10.5L5 3"/>
                  </svg>
                </button>
                <button className="toolbar-btn screenshot-arrow" title="截图选项" aria-label="打开截图选项" aria-expanded={showScreenshotMenu} onClick={() => setShowScreenshotMenu((v) => !v)}>
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
                    <path d="M1 3l3 3 3-3"/>
                  </svg>
                </button>
              </div>
            </div>
            <button className="toolbar-btn" title="附件" aria-label="添加附件" onClick={handleFileSelect}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M14 8.5l-5.5 5.5a3.5 3.5 0 01-5-5l6-6a2.5 2.5 0 013.5 3.5l-5.5 5.5a1 1 0 01-1.5-1.5L11 5.5"/>
              </svg>
            </button>
            {(() => {
              const iconPlugins = (plugins || []).filter((p) => p.icon)
              const visible = iconPlugins.slice(0, 2)
              const overflow = iconPlugins.slice(2)
              return (
                <>
                  {visible.map((p) => (
                    <button
                      key={p.id}
                      className={`toolbar-btn plugin-btn${activePlugin?.id === p.id ? ' active' : ''}`}
                      title={p.name}
                      aria-label={`使用 ${p.name} 插件`}
                      aria-pressed={activePlugin?.id === p.id}
                      onClick={() => setActivePlugin(activePlugin?.id === p.id ? null : p)}
                    >
                      <span className="plugin-btn-icon">{p.icon}</span>
                    </button>
                  ))}
                  {overflow.length > 0 && (
                    <div className="plugin-overflow-wrapper">
                      <button
                        className="toolbar-btn plugin-overflow-btn"
                        title="更多插件"
                        aria-label="更多插件"
                        aria-expanded={showPluginOverflow}
                        onClick={() => setShowPluginOverflow((v) => !v)}
                      >⋯</button>
                      {showPluginOverflow && (
                        <div className="plugin-overflow-menu">
                          {overflow.map((p) => (
                            <button
                              key={p.id}
                              className="plugin-overflow-item"
                              onClick={() => { setActivePlugin(p); setShowPluginOverflow(false) }}
                            >
                              <span>{p.icon}</span>
                              <span>{p.name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )
            })()}
            {activePlugin && (
              <span className="plugin-active-badge">{activePlugin.name}</span>
            )}
          </div>
          <div className="input-toolbar-right">
            <ModelPicker
              value={model}
              models={modelOptions}
              status={modelListStatus}
              statusMessage={modelListMessage}
              onChange={(nextModel) => onModelChange?.(nextModel)}
              onRefresh={() => { void refreshModels() }}
              invalid={configuredModelInvalid}
              placement="top"
              openRequest={modelPickerOpenRequest}
            />
            <button
              className={`toolbar-btn send-btn${disabled ? ' stop-btn' : ''}`}
              onClick={disabled ? onStop : handleSend}
              disabled={!disabled && !value.trim() && attachments.length === 0}
              title={disabled ? '停止生成' : '发送'}
              aria-label={disabled ? '停止生成' : '发送消息'}
            >
              {disabled ? (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
                  <rect x="3.5" y="3.5" width="7" height="7" rx="1"/>
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                  <path d="M2.5 2.5l11 5.5-11 5.5v-4l7-1.5-7-1.5v-4z"/>
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>
      {showWindowCapture && (
        <WindowCapturePicker
          sources={captureSources}
          loading={captureSourcesLoading}
          error={captureSourcesError}
          onClose={() => setShowWindowCapture(false)}
          onRefresh={() => { void refreshCaptureSources() }}
          onCapture={(source, action) => { void captureWindowSource(source, action) }}
        />
      )}
      {previewImage && (
        <div className="image-preview-overlay" onClick={() => setPreviewImage(null)} role="dialog" aria-modal="true" aria-label="附件图片预览">
          <img src={previewImage} className="image-preview-img" alt="待发送附件预览" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  )
}
