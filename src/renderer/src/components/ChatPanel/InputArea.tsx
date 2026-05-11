import { useState, useRef, useCallback } from 'react'
import CommandMenu from './CommandMenu'

interface InputAreaProps {
  onSend: (content: string) => void
  disabled: boolean
}

export default function InputArea({ onSend, disabled }: InputAreaProps) {
  const [value, setValue] = useState('')
  const [showCommands, setShowCommands] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSend = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setValue('')
    setShowCommands(false)
  }, [value, disabled, onSend])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value
    setValue(v)
    setShowCommands(v === '/' || (v.startsWith('/') && !v.includes(' ')))
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
          onSelect={handleCommand}
          onClose={() => setShowCommands(false)}
        />
      )}
      <textarea
        ref={textareaRef}
        className="input-textarea"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="输入消息，/ 打开指令菜单..."
        rows={3}
        disabled={disabled}
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
  )
}
