import { useState, useRef, useCallback, useEffect } from 'react'
import CommandMenu, { getFilteredCommands } from './CommandMenu'

interface InputAreaProps {
  onSend: (content: string) => void
  disabled: boolean
  autoFocus?: boolean
  model?: string
}

export default function InputArea({ onSend, disabled, autoFocus, model }: InputAreaProps) {
  const [value, setValue] = useState('')
  const [showCommands, setShowCommands] = useState(false)
  const [cmdIndex, setCmdIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (autoFocus === false) return
    const tryFocus = () => textareaRef.current?.focus()
    tryFocus()
    const t1 = setTimeout(tryFocus, 100)
    const t2 = setTimeout(tryFocus, 300)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [])

  const handleSend = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setValue('')
    setShowCommands(false)
  }, [value, disabled, onSend])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showCommands) {
      const filtered = getFilteredCommands(value)
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
      if (e.key === 'Enter') {
        e.preventDefault()
        if (filtered[cmdIndex]) handleCommand(filtered[cmdIndex].cmd)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
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
      default:
        setValue(cmd + ' ')
        textareaRef.current?.focus()
    }
  }

  return (
    <div className="input-area">
      {showCommands && (
        <CommandMenu
          filter={value}
          selectedIndex={cmdIndex}
          onSelect={handleCommand}
          onClose={() => setShowCommands(false)}
        />
      )}
      <div className="input-container">
        <textarea
          ref={textareaRef}
          className="input-textarea"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="输入消息，/ 打开指令菜单..."
          rows={2}
          disabled={disabled}
          autoFocus={autoFocus}
        />
        <div className="input-toolbar">
          <div className="input-toolbar-left">
            <button className="toolbar-btn" title="附件（待实现）">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M14 8.5l-5.5 5.5a3.5 3.5 0 01-5-5l6-6a2.5 2.5 0 013.5 3.5l-5.5 5.5a1 1 0 01-1.5-1.5L11 5.5"/>
              </svg>
            </button>
          </div>
          <div className="input-toolbar-right">
            <button className="toolbar-btn model-btn" title="当前模型">{model || 'AI'}</button>
            <button
              className="toolbar-btn send-btn"
              onClick={handleSend}
              disabled={disabled || !value.trim()}
              title="发送"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M2.5 2.5l11 5.5-11 5.5v-4l7-1.5-7-1.5v-4z"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
