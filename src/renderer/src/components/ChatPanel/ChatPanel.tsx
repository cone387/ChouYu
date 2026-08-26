import { useState, useRef, useEffect, useCallback } from 'react'
import TopBar from './TopBar'
import MessageArea from './MessageArea'
import InputArea, { PendingAttachment } from './InputArea'
import Settings from '../Settings/Settings'
import { Message, PetState, AppConfig, PluginInfo, PluginMessageData } from '../../shared/types'
import { DEFAULT_CONFIG } from '../../shared/constants'
import { streamChat } from '../../core/ai-engine'
import { buildSystemPrompt, buildMessages } from '../../core/prompt-builder'
import { loadMessages, saveMessages, clearMessages } from '../../core/memory'
import './ChatPanel.css'

interface ChatPanelProps {
  visible: boolean
  position: { x: number; y: number }
  onPositionChange: (pos: { x: number; y: number }) => void
  petState: PetState
  onPetStateChange: (state: PetState) => void
  onHide: () => void
  onClose: () => void
  initialShowSettings?: boolean
  onSettingsClose?: () => void
  onScreenshot?: (hidePanel: boolean, callback: (dataUrl: string) => void) => void
  initialPluginId?: string | null
  onPluginIdConsumed?: () => void
  pendingAttachment?: { type: 'image' | 'text'; data: string; name: string } | null
  onPendingAttachmentConsumed?: () => void
  pendingMessage?: string | null
  onPendingMessageConsumed?: () => void
}

export default function ChatPanel({ visible, position, onPositionChange, petState, onPetStateChange, onHide, onClose, initialShowSettings, onSettingsClose, onScreenshot, initialPluginId, onPluginIdConsumed, pendingAttachment, onPendingAttachmentConsumed, pendingMessage, onPendingMessageConsumed }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [showSettings, setShowSettings] = useState(initialShowSettings || false)
  const [showHistory, setShowHistory] = useState(false)
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG)
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const [activePluginForInput, setActivePluginForInput] = useState<PluginInfo | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef({ dragging: false, startX: 0, startY: 0, posX: 0, posY: 0 })
  const initializedRef = useRef(false)
  const latestMessagesRef = useRef<Message[]>([])

  useEffect(() => {
    loadMessages().then((msgs) => {
      setMessages(msgs)
      initializedRef.current = true
    })
    window.electronAPI.db.getConfig().then(setConfig)
    window.electronAPI.plugin.getPlugins().then(setPlugins)
  }, [])

  useEffect(() => window.electronAPI.onConfigChanged(setConfig), [])

  useEffect(() => {
    if (initialShowSettings) setShowSettings(true)
  }, [initialShowSettings])

  useEffect(() => {
    if (initialPluginId && plugins.length > 0) {
      const matchedPlugin = plugins.find(p => p.id === initialPluginId)
      if (matchedPlugin) {
        setActivePluginForInput(matchedPlugin)
      }
      onPluginIdConsumed?.()
    }
  }, [initialPluginId, plugins, onPluginIdConsumed])

  // Auto-send pending message (from clipboard action)
  useEffect(() => {
    if (pendingMessage && !isStreaming) {
      handleSend(pendingMessage)
      onPendingMessageConsumed?.()
    }
  }, [pendingMessage])

  // Re-focus textarea when panel becomes visible again
  useEffect(() => {
    if (visible && panelRef.current) {
      const textarea = panelRef.current.querySelector('.input-textarea') as HTMLTextAreaElement | null
      if (textarea) {
        setTimeout(() => textarea.focus(), 50)
      }
    }
  }, [visible])

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
    // Use transform during drag to avoid re-rendering message list
    if (panelRef.current) {
      panelRef.current.style.transform = `translate(${dx}px, ${dy}px)`
    }
  }, [])

  const handleDragEnd = useCallback(() => {
    if (!dragRef.current.dragging) return
    dragRef.current.dragging = false
    const dx = (panelRef.current?.style.transform.match(/translate\((.+?)px/)?.[1]) || '0'
    const dy = (panelRef.current?.style.transform.match(/,\s*(.+?)px/)?.[1]) || '0'
    if (panelRef.current) {
      panelRef.current.style.transform = ''
    }
    onPositionChange({
      x: dragRef.current.posX + Number(dx),
      y: dragRef.current.posY + Number(dy)
    })
  }, [])

  useEffect(() => {
    latestMessagesRef.current = messages
    if (!initializedRef.current) return
    const timer = setTimeout(() => { void saveMessages(messages) }, 500)
    return () => clearTimeout(timer)
  }, [messages])

  useEffect(() => () => {
    if (initializedRef.current) void saveMessages(latestMessagesRef.current)
  }, [])

  useEffect(() => {
    if (!showHistory) return
    const panelEl = panelRef.current
    if (!panelEl) return
    requestAnimationFrame(() => {
      const rect = panelEl.getBoundingClientRect()
      const screenH = window.innerHeight
      if (rect.bottom > screenH - 4) {
        const newY = Math.max(4, position.y - (rect.bottom - screenH + 8))
        onPositionChange({ ...position, x: position.x, y: newY })
      }
    })
  }, [showHistory])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && visible) onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, visible])

  const pluginCommands = plugins.map((p) => ({ cmd: '/' + p.command, desc: p.description }))

  const handleSend = async (content: string, attachments?: PendingAttachment[]) => {
    // Plugin command detection (before built-in commands)
    for (const plugin of plugins) {
      const prefix = `/${plugin.command} `
      if (content.startsWith(prefix) || content === `/${plugin.command}`) {
        const extractedContent = content.startsWith(prefix) ? content.slice(prefix.length) : ''
        const result: PluginMessageData = await window.electronAPI.plugin.execute(plugin.id, extractedContent)
        const resultMsg: Message = {
          id: Date.now().toString(),
          role: 'assistant',
          content: result.message,
          timestamp: Date.now(),
          pluginData: result
        }
        setMessages((prev) => [...prev, resultMsg])
        setShowHistory(true)

        // If feedToPet is enabled (user setting), let the AI pet comment on the result
        const feedToPetSetting = await window.electronAPI.db.getState(`plugin:${plugin.id}:feedToPet`)
        if (feedToPetSetting === 'true' && result.ok) {
          const petPrompt = `用户刚通过 ${plugin.name} 插件执行了操作：\n输入：${extractedContent}\n结果：${result.message}\n\n请用你的性格简短评论一下（1-2句话）。`
          const systemPrompt = buildSystemPrompt(config.soulMd)
          const petMsgId = (Date.now() + 2).toString()
          let petAccumulated = ''
          onPetStateChange('thinking')
          setIsStreaming(true)
          const petAbort = new AbortController()
          try {
            await streamChat(
              [{ role: 'user', content: petPrompt, id: petMsgId + '-prompt', timestamp: Date.now() }],
              systemPrompt,
              config,
              (chunk, done) => {
                if (done) {
                  onPetStateChange('idle')
                  setIsStreaming(false)
                  return
                }
                petAccumulated += chunk
                onPetStateChange('talking')
                setMessages((prev) => {
                  const existing = prev.find((m) => m.id === petMsgId)
                  if (existing) {
                    return prev.map((m) => m.id === petMsgId ? { ...m, content: petAccumulated } : m)
                  }
                  return [...prev, { id: petMsgId, role: 'assistant', content: petAccumulated, timestamp: Date.now() }]
                })
              },
              petAbort.signal
            )
          } catch {
            onPetStateChange('idle')
            setIsStreaming(false)
          }
        }
        return
      }
    }

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

    let msgContent = content
    const imageAttachment = attachments?.find((a) => a.type === 'image')
    const textAttachments = attachments?.filter((a) => a.type === 'text') || []
    if (textAttachments.length > 0) {
      const textParts = textAttachments.map((a) => `[附件: ${a.name}]\n${a.data.slice(0, 2000)}`)
      msgContent = content ? `${content}\n\n${textParts.join('\n\n')}` : textParts.join('\n\n')
    }

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: msgContent,
      timestamp: Date.now(),
      imageUrl: imageAttachment?.data
    }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setShowHistory(true)
    onPetStateChange('thinking')
    setIsStreaming(true)

    const systemPrompt = buildSystemPrompt(config.soulMd)
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

  return (
    <div
      ref={panelRef}
      data-interactive
      className={`chat-panel${showSettings ? ' chat-panel-settings' : ''}`}
      style={{ left: position.x, top: position.y, display: visible ? undefined : 'none' }}
    >
      {showSettings ? (
        <Settings
          onClose={() => { setShowSettings(false); onSettingsClose?.() }}
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
              onSettings={() => {
                setShowSettings(true)
                const screenH = window.innerHeight
                const panelH = 360
                if (position.y + panelH > screenH - 4) {
                  onPositionChange({ ...position, y: Math.max(4, screenH - panelH - 4) })
                }
              }}
              onNewTopic={handleNewTopic}
              onHide={onHide}
              onClose={onClose}
            />
          </div>
          {showHistory && <MessageArea messages={messages} isStreaming={isStreaming} />}
          <InputArea onSend={handleSend} disabled={isStreaming} model={config.model} onModelChange={handleModelChange} onScreenshot={onScreenshot} plugins={plugins} pluginCommands={pluginCommands} initialActivePlugin={activePluginForInput} onInitialPluginConsumed={() => setActivePluginForInput(null)} initialAttachment={pendingAttachment} onInitialAttachmentConsumed={onPendingAttachmentConsumed} />
        </>
      )}
    </div>
  )
}
