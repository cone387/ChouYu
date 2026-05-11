import { useState, useRef, useEffect } from 'react'
import TopBar from './TopBar'
import MessageArea from './MessageArea'
import InputArea from './InputArea'
import Settings from '../Settings/Settings'
import { Message, PetState } from '../../shared/types'
import { DEFAULT_CONFIG } from '../../shared/constants'
import { streamChat } from '../../core/ai-engine'
import { buildSystemPrompt, buildMessages } from '../../core/prompt-builder'
import { saveMessages, clearMessages } from '../../core/memory'
import './ChatPanel.css'

interface ChatPanelProps {
  position: { x: number; y: number }
  petState: PetState
  onPetStateChange: (state: PetState) => void
  onClose: () => void
  initialShowSettings?: boolean
  onSettingsClose?: () => void
}

export default function ChatPanel({ position, petState, onPetStateChange, onClose, initialShowSettings, onSettingsClose }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [showSettings, setShowSettings] = useState(initialShowSettings || false)
  const [showHistory, setShowHistory] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    saveMessages(messages)
    if (messages.length > 0) setShowHistory(true)
  }, [messages])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

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
    onPetStateChange('thinking')
    setIsStreaming(true)

    const config = { ...DEFAULT_CONFIG, ...getStoredConfig() }
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
    setIsStreaming(false)
    onPetStateChange('idle')
  }

  const getStatusText = () => {
    if (petState === 'thinking') return '正在思考...'
    if (petState === 'talking') return '正在回复...'
    return '在线'
  }

  return (
    <div
      ref={panelRef}
      data-interactive
      className="chat-panel"
      style={{ left: position.x, top: position.y }}
    >
      {showSettings ? (
        <Settings onClose={() => { setShowSettings(false); onSettingsClose?.() }} />
      ) : (
        <>
          <TopBar
            status={getStatusText()}
            showHistory={showHistory}
            onToggleHistory={() => setShowHistory((v) => !v)}
            onNewTopic={handleNewTopic}
            onClose={onClose}
          />
          {showHistory && <MessageArea messages={messages} isStreaming={isStreaming} />}
          <InputArea onSend={handleSend} disabled={isStreaming} autoFocus />
        </>
      )}
    </div>
  )
}

function getStoredConfig() {
  try {
    const raw = localStorage.getItem('chouyu-config')
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}
