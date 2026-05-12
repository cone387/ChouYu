import { useState, useRef, useEffect, useCallback } from 'react'
import TopBar from './TopBar'
import MessageArea from './MessageArea'
import InputArea from './InputArea'
import Settings from '../Settings/Settings'
import { Message, PetState, AppConfig } from '../../shared/types'
import { DEFAULT_CONFIG } from '../../shared/constants'
import { streamChat } from '../../core/ai-engine'
import { buildSystemPrompt, buildMessages } from '../../core/prompt-builder'
import { loadMessages, saveMessages, clearMessages } from '../../core/memory'
import './ChatPanel.css'

interface ChatPanelProps {
  position: { x: number; y: number }
  onPositionChange: (pos: { x: number; y: number }) => void
  petState: PetState
  onPetStateChange: (state: PetState) => void
  onClose: () => void
  initialShowSettings?: boolean
  onSettingsClose?: () => void
}

export default function ChatPanel({ position, onPositionChange, petState, onPetStateChange, onClose, initialShowSettings, onSettingsClose }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [showSettings, setShowSettings] = useState(initialShowSettings || false)
  const [showHistory, setShowHistory] = useState(false)
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG)
  const [closing, setClosing] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef({ dragging: false, startX: 0, startY: 0, posX: 0, posY: 0 })
  const initializedRef = useRef(false)

  useEffect(() => {
    loadMessages().then((msgs) => {
      setMessages(msgs)
      initializedRef.current = true
    })
    window.electronAPI.db.getConfig().then(setConfig)
  }, [])

  useEffect(() => {
    if (initialShowSettings) setShowSettings(true)
  }, [initialShowSettings])

  const handleDragStart = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    if (target.closest('button')) return
    e.preventDefault()
    dragRef.current = {
      dragging: true,
      startX: e.screenX,
      startY: e.screenY,
      posX: position.x,
      posY: position.y
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }, [position])

  const handleDragMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current.dragging) return
    const dx = e.screenX - dragRef.current.startX
    const dy = e.screenY - dragRef.current.startY
    onPositionChange({
      x: dragRef.current.posX + dx,
      y: dragRef.current.posY + dy
    })
  }, [onPositionChange])

  const handleDragEnd = useCallback(() => {
    dragRef.current.dragging = false
  }, [])

  useEffect(() => {
    if (!initializedRef.current) return
    saveMessages(messages)
  }, [messages])

  const handleClose = useCallback(() => {
    setClosing(true)
    setTimeout(() => onClose(), 180)
  }, [onClose])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleClose])

  const handleSend = async (content: string) => {
    if (content === '/clear') {
      setMessages([])
      clearMessages()
      return
    }
    if (content === '/help') {
      const helpMsg: Message = {
        id: Date.now().toString(),
        role: 'assistant',
        content: '可用指令：\n- `/clear` 清空对话\n- `/settings` 打开设置\n- `/model` 切换模型\n- `/help` 查看帮助',
        timestamp: Date.now()
      }
      setMessages((prev) => [...prev, helpMsg])
      return
    }
    if (content === '/settings') {
      setShowSettings(true)
      const screenH = window.innerHeight
      const panelH = 360
      if (position.y + panelH > screenH - 4) {
        onPositionChange({ ...position, y: Math.max(4, screenH - panelH - 4) })
      }
      return
    }

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content,
      timestamp: Date.now()
    }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setShowHistory(true)
    onPetStateChange('thinking')
    setIsStreaming(true)

    const systemPrompt = buildSystemPrompt()
    const history = buildMessages(newMessages)

    const aiMsgId = (Date.now() + 1).toString()
    let accumulated = ''

    abortRef.current = new AbortController()

    try {
      await streamChat(
        history,
        systemPrompt,
        config,
        (chunk, done) => {
          if (done) {
            onPetStateChange('idle')
            setIsStreaming(false)
            return
          }
          accumulated += chunk
          onPetStateChange('talking')
          setMessages((prev) => {
            const existing = prev.find((m) => m.id === aiMsgId)
            if (existing) {
              return prev.map((m) => m.id === aiMsgId ? { ...m, content: accumulated } : m)
            }
            return [...prev, { id: aiMsgId, role: 'assistant', content: accumulated, timestamp: Date.now() }]
          })
        },
        abortRef.current.signal
      )
    } catch (err: any) {
      if (err.name === 'AbortError') return
      const errorMsg: Message = {
        id: aiMsgId,
        role: 'assistant',
        content: `出错了：${err.message}\n\n请在设置中检查 API Key 和 Base URL 配置。`,
        timestamp: Date.now()
      }
      setMessages((prev) => {
        const existing = prev.find((m) => m.id === aiMsgId)
        if (existing) return prev.map((m) => m.id === aiMsgId ? errorMsg : m)
        return [...prev, errorMsg]
      })
      onPetStateChange('idle')
      setIsStreaming(false)
    }
  }

  const handleNewTopic = () => {
    if (abortRef.current) abortRef.current.abort()
    setMessages([])
    clearMessages()
    setShowHistory(false)
    setIsStreaming(false)
    onPetStateChange('idle')
  }

  const getStatusText = () => {
    if (petState === 'thinking') return '正在思考...'
    if (petState === 'talking') return '正在回复...'
    return '在线'
  }

  const handleModelChange = useCallback((newModel: string) => {
    setConfig((prev) => ({ ...prev, model: newModel }))
    window.electronAPI.db.saveConfig({ model: newModel })
  }, [])

  const handleAttachment = useCallback((attachment: { type: 'image' | 'text'; data: string; name: string }) => {
    const content = attachment.type === 'image'
      ? `[截图: ${attachment.name}]`
      : `[文件: ${attachment.name}]\n${attachment.data.slice(0, 2000)}`
    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content,
      timestamp: Date.now()
    }
    setMessages((prev) => [...prev, userMsg])
    setShowHistory(true)
  }, [])

  return (
    <div
      ref={panelRef}
      data-interactive
      className={`chat-panel${showSettings ? ' chat-panel-settings' : ''}${closing ? ' closing' : ''}`}
      style={{ left: position.x, top: position.y }}
    >
      {showSettings ? (
        <Settings
          onClose={() => { setShowSettings(false); onSettingsClose?.(); handleClose() }}
          dragHandleProps={{
            onPointerDown: handleDragStart,
            onPointerMove: handleDragMove,
            onPointerUp: handleDragEnd,
            onPointerCancel: handleDragEnd
          }}
        />
      ) : (
        <>
          <div
            className="chat-panel-drag-handle"
            onPointerDown={handleDragStart}
            onPointerMove={handleDragMove}
            onPointerUp={handleDragEnd}
            onPointerCancel={handleDragEnd}
          >
            <TopBar
              status={getStatusText()}
              showHistory={showHistory}
              onToggleHistory={() => setShowHistory((v) => !v)}
              onNewTopic={handleNewTopic}
              onClose={handleClose}
            />
          </div>
          {showHistory && <MessageArea messages={messages} isStreaming={isStreaming} />}
          <InputArea onSend={handleSend} disabled={isStreaming} model={config.model} onModelChange={handleModelChange} onAttachment={handleAttachment} />
        </>
      )}
    </div>
  )
}
