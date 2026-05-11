import { useState, useRef, useCallback } from 'react'
import CommandMenu, { getFilteredCommands } from './CommandMenu'

interface InputAreaProps {
  onSend: (content: string) => void
  disabled: boolean
  autoFocus?: boolean
}

export default function InputArea({ onSend, disabled, autoFocus }: InputAreaProps) {
  const [value, setValue] = useState('')
  const [showCommands, setShowCommands] = useState(false)
  const [cmdIndex, setCmdIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

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
            <button className="toolbar-btn" title="附件（待实现）">📎</button>
          </div>
          <div className="input-toolbar-right">
            <button className="toolbar-btn model-btn" title="切换模型">gpt-4o ▾</button>
            <button
              className="toolbar-btn send-btn"
              onClick={handleSend}
              disabled={disabled || !value.trim()}
              title="发送"
            >
              ⏎
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
