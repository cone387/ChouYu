import { useState, useRef, useCallback, useEffect } from 'react'
import CommandMenu, { getFilteredCommands } from './CommandMenu'
import { PluginInfo } from '../../shared/types'
import {
  getAttachmentValidationError,
  MAX_ATTACHMENT_COUNT,
  readAttachmentFile,
  type PendingAttachment
} from '../../core/attachments'
export type { PendingAttachment } from '../../core/attachments'

interface InputAreaProps {
  onSend: (content: string, attachments?: PendingAttachment[]) => void
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

const FALLBACK_MODELS = ['qwen-turbo', 'qwen-plus', 'qwen-max', 'qwen-long']

export default function InputArea({ onSend, disabled, autoFocus, model, onModelChange, onScreenshot, plugins, pluginCommands, initialActivePlugin, onInitialPluginConsumed, initialAttachment, onInitialAttachmentConsumed }: InputAreaProps) {
  const [value, setValue] = useState('')
  const [showCommands, setShowCommands] = useState(false)
  const [showModelSelector, setShowModelSelector] = useState(false)
  const [showScreenshotMenu, setShowScreenshotMenu] = useState(false)
  const [hideWindowOnCapture, setHideWindowOnCapture] = useState(true)
  const [modelOptions, setModelOptions] = useState<string[]>(FALLBACK_MODELS)
  const [modelSearch, setModelSearch] = useState('')
  const [cmdIndex, setCmdIndex] = useState(0)
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [activePlugin, setActivePlugin] = useState<PluginInfo | null>(null)
  const [showPluginOverflow, setShowPluginOverflow] = useState(false)
  const [attachmentError, setAttachmentError] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

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
    if (!showModelSelector) return
    setModelSearch('')
    const dismiss = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.model-selector')) {
        setShowModelSelector(false)
      }
    }
    document.addEventListener('mousedown', dismiss)
    return () => document.removeEventListener('mousedown', dismiss)
  }, [showModelSelector])

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

  useEffect(() => {
    window.electronAPI.fetchModels().then((models) => {
      if (models && models.length > 0) setModelOptions(models)
    })
  }, [])

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
        { cmd: '/clear', desc: '清空对话，新话题' },
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
        setShowModelSelector(true)
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
      setAttachments((prev) => prev.length < MAX_ATTACHMENT_COUNT
        ? [...prev, { type: 'image', data: dataUrl, name: `截图${prev.length + 1}.png` }]
        : prev)
    })
  }, [attachments.length, onScreenshot, hideWindowOnCapture])

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

  const filteredModels = modelSearch
    ? modelOptions.filter((m) => m.toLowerCase().includes(modelSearch.toLowerCase()))
    : modelOptions

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
          <div className="attachment-list">
            {attachments.map((att, i) => (
              <div key={i} className="attachment-item">
                {att.type === 'image' ? (
                  <img src={att.data} className="attachment-thumb" alt={att.name} onClick={() => setPreviewImage(att.data)} />
                ) : (
                  <div className="attachment-file">
                    <span className="attachment-file-icon">📄</span>
                    <span className="attachment-file-name">{att.name}</span>
                  </div>
                )}
                <button className="attachment-remove" onClick={() => removeAttachment(i)} aria-label={`移除附件 ${att.name}`}>✕</button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          className="input-textarea"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={activePlugin ? (activePlugin.inputPlaceholder || '输入内容...') : '输入消息，/ 打开指令菜单...'}
          rows={2}
          disabled={disabled}
          autoFocus={autoFocus}
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
                  <button className="screenshot-menu-item disabled" disabled>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <rect x="2" y="3" width="12" height="10" rx="1"/><path d="M5 8h6M8 5v6"/>
                    </svg>
                    <span className="screenshot-menu-label">文字识别</span>
                  </button>
                  <button className="screenshot-menu-item disabled" disabled>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <rect x="2" y="2" width="12" height="12" rx="1"/><path d="M2 10l4-4 3 3 5-5"/>
                    </svg>
                    <span className="screenshot-menu-label">滚动截图</span>
                  </button>
                  <button className="screenshot-menu-item disabled" disabled>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <circle cx="8" cy="8" r="5"/><circle cx="8" cy="8" r="2" fill="currentColor"/>
                    </svg>
                    <span className="screenshot-menu-label">录屏</span>
                  </button>
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
            <div className="model-selector">
              {showModelSelector && (
                <div className="model-dropdown">
                  <input
                    className="model-search"
                    placeholder="搜索模型..."
                    value={modelSearch}
                    onChange={(e) => setModelSearch(e.target.value)}
                    autoFocus
                    aria-label="搜索模型"
                    onMouseDown={(e) => e.stopPropagation()}
                  />
                  <div className="model-list" role="listbox" aria-label="可用模型">
                    {filteredModels.map((m) => (
                      <button
                        key={m}
                        className={`model-option${m === model ? ' active' : ''}`}
                        onClick={() => { onModelChange?.(m); setShowModelSelector(false) }}
                        role="option"
                        aria-selected={m === model}
                      >{m}</button>
                    ))}
                    {filteredModels.length === 0 && (
                      <div className="model-empty">无匹配模型</div>
                    )}
                  </div>
                </div>
              )}
              <div className="model-btn-group">
                <button className="toolbar-btn model-btn" title="切换模型" aria-label={`当前模型 ${model || 'AI'}，点击切换`} aria-expanded={showModelSelector} onClick={() => setShowModelSelector((v) => !v)}>
                  {model || 'AI'}
                </button>
                <button className="toolbar-btn model-arrow" title="选择模型" aria-label="打开模型列表" aria-expanded={showModelSelector} onClick={() => setShowModelSelector((v) => !v)}>
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
                    <path d="M1 3l3 3 3-3"/>
                  </svg>
                </button>
              </div>
            </div>
            <button
              className="toolbar-btn send-btn"
              onClick={handleSend}
              disabled={disabled || (!value.trim() && attachments.length === 0)}
              title="发送"
              aria-label="发送消息"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M2.5 2.5l11 5.5-11 5.5v-4l7-1.5-7-1.5v-4z"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
      {previewImage && (
        <div className="image-preview-overlay" onClick={() => setPreviewImage(null)} role="dialog" aria-modal="true" aria-label="附件图片预览">
          <img src={previewImage} className="image-preview-img" alt="待发送附件预览" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  )
}
