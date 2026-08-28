import { useState, useRef, useEffect, useCallback } from 'react'
import TopBar from './TopBar'
import MessageArea from './MessageArea'
import InputArea, { PendingAttachment } from './InputArea'
import Settings from '../Settings/Settings'
import ConversationSidebar from '../ConversationSidebar/ConversationSidebar'
import OnboardingCard from '../Onboarding/OnboardingCard'
import ToolApprovalDialog from '../ToolApproval/ToolApprovalDialog'
import MemoryCandidateCard from '../Memory/MemoryCandidateCard'
import type { ToolApprovalRequest, ToolExecutionEvent } from '../../../../shared/tools'
import type { MemoryConflictAction, MemoryFeedbackValue, MemoryRecord } from '../../../../shared/memory'
import { formatMemoryContext } from '../../../../shared/memory'
import {
  Message,
  PetState,
  AppConfig,
  PluginInfo,
  PluginMessageData,
  ChatSessionSummary,
  SessionWorkspace
} from '../../shared/types'
import {
  DEFAULT_CONFIG,
  MAX_HISTORY_MESSAGES,
  PANEL_HEIGHT,
  PANEL_SETTINGS_HEIGHT,
  PANEL_SETTINGS_WIDTH,
  PANEL_WORKSPACE_WIDTH
} from '../../shared/constants'
import { streamChat } from '../../core/ai-engine'
import { buildSystemPrompt, buildMessages } from '../../core/prompt-builder'
import { loadSessionWorkspace, saveActiveSessionMessages } from '../../core/memory'
import { getConversationForRetry } from '../../core/conversation-actions'
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
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([])
  const [activeSessionId, setActiveSessionId] = useState('')
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [showSettings, setShowSettings] = useState(initialShowSettings || false)
  const [showSessions, setShowSessions] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG)
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const [activePluginForInput, setActivePluginForInput] = useState<PluginInfo | null>(null)
  const [toolApprovalRequest, setToolApprovalRequest] = useState<ToolApprovalRequest | null>(null)
  const [memoryCandidates, setMemoryCandidates] = useState<MemoryRecord[]>([])
  const [memoryCandidateBusy, setMemoryCandidateBusy] = useState(false)
  const [memoryCandidateError, setMemoryCandidateError] = useState('')
  const [memoryCorrectionId, setMemoryCorrectionId] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const activeResponseIdRef = useRef<string | null>(null)
  const toolBoundaryRef = useRef(false)
  const happyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef({ dragging: false, startX: 0, startY: 0, posX: 0, posY: 0, dx: 0, dy: 0 })
  const initializedRef = useRef(false)
  const latestMessagesRef = useRef<Message[]>([])
  const activeSessionIdRef = useRef('')

  const refreshPlugins = useCallback(async () => {
    setPlugins(await window.electronAPI.plugin.getPlugins())
  }, [])

  const applyWorkspace = useCallback((workspace: SessionWorkspace) => {
    activeSessionIdRef.current = workspace.activeSession.id
    latestMessagesRef.current = workspace.activeSession.messages
    setActiveSessionId(workspace.activeSession.id)
    setMessages(workspace.activeSession.messages)
    setSessions(workspace.sessions)
    setMemoryCandidates([])
  }, [])

  const finishPetResponse = useCallback(() => {
    if (happyTimerRef.current) clearTimeout(happyTimerRef.current)
    onPetStateChange('happy')
    happyTimerRef.current = setTimeout(() => {
      onPetStateChange('idle')
      happyTimerRef.current = null
    }, 650)
  }, [onPetStateChange])

  const stopActiveResponse = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    activeResponseIdRef.current = null
    setToolApprovalRequest(null)
    setIsStreaming(false)
    onPetStateChange('idle')
  }, [onPetStateChange])

  const persistCurrentSession = useCallback(async () => {
    const id = activeSessionIdRef.current
    if (!id || !initializedRef.current) return
    const workspace = await saveActiveSessionMessages(id, latestMessagesRef.current)
    setSessions(workspace.sessions)
  }, [])

  useEffect(() => {
    Promise.all([
      loadSessionWorkspace(),
      window.electronAPI.db.getConfig(),
      window.electronAPI.db.getState('onboarding-dismissed')
    ]).then(([workspace, loadedConfig, onboardingDismissed]) => {
      applyWorkspace(workspace)
      setConfig(loadedConfig)
      setShowOnboarding(!loadedConfig.apiKey && onboardingDismissed !== 'true')
      initializedRef.current = true
      setWorkspaceLoaded(true)
    })
    void refreshPlugins()
  }, [applyWorkspace, refreshPlugins])

  useEffect(() => window.electronAPI.onConfigChanged((nextConfig) => {
    setConfig(nextConfig)
    if (nextConfig.apiKey) setShowOnboarding(false)
  }), [])

  useEffect(() => {
    const unsubscribeApproval = window.electronAPI.ai.onToolApprovalRequest(setToolApprovalRequest)
    const unsubscribeEvents = window.electronAPI.ai.onToolEvent((event: ToolExecutionEvent) => {
      if (['completed', 'denied', 'error'].includes(event.status)) {
        toolBoundaryRef.current = true
        setToolApprovalRequest((current) => current?.callId === event.callId ? null : current)
      }
      setMessages((previous) => {
        const id = `tool-${event.callId}`
        const toolData = {
          callId: event.callId,
          name: event.name,
          displayName: event.displayName,
          risk: event.risk,
          status: event.status,
          summary: event.summary
        }
        const existing = previous.find((message) => message.id === id)
        return existing
          ? previous.map((message) => message.id === id ? { ...message, toolData } : message)
          : [...previous, { id, role: 'assistant', content: '', timestamp: Date.now(), toolData }]
      })
    })
    return () => {
      unsubscribeApproval()
      unsubscribeEvents()
    }
  }, [])

  useEffect(() => {
    if (initialShowSettings) {
      setShowSessions(false)
      setShowSettings(true)
    }
  }, [initialShowSettings])

  useEffect(() => {
    if (initialPluginId && plugins.length > 0) {
      const matchedPlugin = plugins.find((plugin) => plugin.id === initialPluginId)
      if (matchedPlugin) setActivePluginForInput(matchedPlugin)
      onPluginIdConsumed?.()
    }
  }, [initialPluginId, plugins, onPluginIdConsumed])

  useEffect(() => {
    if (pendingMessage && !isStreaming && workspaceLoaded) {
      void handleSend(pendingMessage)
      onPendingMessageConsumed?.()
    }
  }, [pendingMessage, isStreaming, workspaceLoaded])

  useEffect(() => {
    if (visible && panelRef.current && !showSettings && !showSessions) {
      const textarea = panelRef.current.querySelector('.input-textarea') as HTMLTextAreaElement | null
      if (textarea) setTimeout(() => textarea.focus(), 50)
    }
  }, [visible, showSettings, showSessions])

  useEffect(() => {
    if (!showSessions) return
    const nextX = Math.min(Math.max(4, position.x), Math.max(4, window.innerWidth - PANEL_WORKSPACE_WIDTH - 4))
    const nextY = Math.min(Math.max(4, position.y), Math.max(4, window.innerHeight - PANEL_HEIGHT - 4))
    if (nextX !== position.x || nextY !== position.y) onPositionChange({ x: nextX, y: nextY })
  }, [showSessions])

  const handleDragStart = useCallback((event: React.PointerEvent) => {
    if (event.button !== 0) return
    const target = event.target as HTMLElement
    if (target.closest('button, input, textarea, select')) return
    event.preventDefault()
    dragRef.current = {
      dragging: true,
      startX: event.screenX,
      startY: event.screenY,
      posX: position.x,
      posY: position.y,
      dx: 0,
      dy: 0
    }
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  }, [position])

  const handleDragMove = useCallback((event: React.PointerEvent) => {
    if (!dragRef.current.dragging) return
    const dx = event.screenX - dragRef.current.startX
    const dy = event.screenY - dragRef.current.startY
    dragRef.current.dx = dx
    dragRef.current.dy = dy
    if (panelRef.current) panelRef.current.style.transform = `translate(${dx}px, ${dy}px)`
  }, [])

  const handleDragEnd = useCallback(() => {
    if (!dragRef.current.dragging) return
    dragRef.current.dragging = false
    const { posX, posY, dx, dy } = dragRef.current
    const nextPosition = { x: posX + dx, y: posY + dy }
    if (panelRef.current) {
      panelRef.current.style.left = `${nextPosition.x}px`
      panelRef.current.style.top = `${nextPosition.y}px`
      panelRef.current.style.transform = ''
    }
    onPositionChange(nextPosition)
  }, [onPositionChange])

  useEffect(() => {
    latestMessagesRef.current = messages
    if (!initializedRef.current || !activeSessionId) return
    const sessionId = activeSessionId
    const timer = setTimeout(() => {
      void saveActiveSessionMessages(sessionId, messages).then((workspace) => {
        if (activeSessionIdRef.current === sessionId) setSessions(workspace.sessions)
      })
    }, 450)
    return () => clearTimeout(timer)
  }, [messages, activeSessionId])

  useEffect(() => () => {
    abortRef.current?.abort()
    if (happyTimerRef.current) clearTimeout(happyTimerRef.current)
    onPetStateChange('idle')
    if (initializedRef.current && activeSessionIdRef.current) {
      void window.electronAPI.db.saveSessionMessages(activeSessionIdRef.current, latestMessagesRef.current)
    }
  }, [])

  useEffect(() => {
    if (messages.length === 0 && !isStreaming) return
    const panelEl = panelRef.current
    if (!panelEl) return
    requestAnimationFrame(() => {
      const rect = panelEl.getBoundingClientRect()
      if (rect.bottom > window.innerHeight - 4) {
        onPositionChange({ ...position, y: Math.max(4, position.y - (rect.bottom - window.innerHeight + 8)) })
      }
    })
  }, [messages.length, isStreaming])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !visible) return
      if (confirmClear) {
        setConfirmClear(false)
        return
      }
      if (showSessions) {
        setShowSessions(false)
        return
      }
      if (showSettings) {
        setShowSettings(false)
        onSettingsClose?.()
        return
      }
      onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [confirmClear, onClose, onSettingsClose, showSessions, showSettings, visible])

  const createSession = useCallback(async () => {
    stopActiveResponse()
    await persistCurrentSession()
    const workspace = await window.electronAPI.db.createSession()
    applyWorkspace(workspace)
  }, [applyWorkspace, persistCurrentSession, stopActiveResponse])

  const selectSession = useCallback(async (id: string) => {
    if (id === activeSessionIdRef.current) return
    stopActiveResponse()
    await persistCurrentSession()
    applyWorkspace(await window.electronAPI.db.selectSession(id))
  }, [applyWorkspace, persistCurrentSession, stopActiveResponse])

  const renameSession = useCallback(async (id: string, title: string) => {
    setSessions(await window.electronAPI.db.renameSession(id, title))
  }, [])

  const deleteSession = useCallback(async (id: string) => {
    if (id === activeSessionIdRef.current) stopActiveResponse()
    applyWorkspace(await window.electronAPI.db.deleteSession(id))
  }, [applyWorkspace, stopActiveResponse])

  const exportSession = useCallback(async (id: string) => {
    await persistCurrentSession()
    const result = await window.electronAPI.db.exportSession(id)
    return result.ok
  }, [persistCurrentSession])

  const clearCurrentSession = useCallback(async () => {
    stopActiveResponse()
    setMessages([])
    setConfirmClear(false)
    if (!activeSessionIdRef.current) return
    const workspace = await window.electronAPI.db.saveSessionMessages(activeSessionIdRef.current, [])
    setSessions(workspace.sessions)
  }, [stopActiveResponse])

  const pluginCommands = plugins.map((plugin) => ({ cmd: '/' + plugin.command, desc: plugin.description }))

  const generateAIResponse = useCallback(async (conversation: Message[]) => {
    const latestUserMessage = [...conversation].reverse().find((message) => message.role === 'user' && !message.toolData)
    let relevantMemories: Awaited<ReturnType<typeof window.electronAPI.memory.search>> = []
    if (config.memoryEnabled && latestUserMessage?.content) {
      try {
        relevantMemories = await window.electronAPI.memory.search(latestUserMessage.content, 6)
      } catch {
        relevantMemories = []
      }
    }
    const memoryRefs = relevantMemories.map((memory) => ({
      id: memory.id,
      content: memory.content,
      type: memory.type,
      sourceIds: memory.sourceMemoryIds,
      clusterId: memory.clusterId,
      compressedCount: memory.compressedCount
    }))
    const systemPrompt = buildSystemPrompt(config.soulMd, formatMemoryContext(relevantMemories))
    const history = buildMessages(conversation)
    const responseBaseId = `${Date.now()}-assistant`
    let segmentIndex = 0
    let aiMsgId = responseBaseId
    let accumulated = ''
    const controller = new AbortController()
    abortRef.current = controller
    activeResponseIdRef.current = aiMsgId
    toolBoundaryRef.current = false
    setToolApprovalRequest(null)
    onPetStateChange('thinking')
    setIsStreaming(true)

    try {
      await streamChat(
        history,
        systemPrompt,
        config,
        (chunk, done) => {
          if (controller.signal.aborted) return
          if (done) {
            activeResponseIdRef.current = null
            finishPetResponse()
            setIsStreaming(false)
            return
          }
          if (chunk && toolBoundaryRef.current) {
            segmentIndex += 1
            aiMsgId = `${responseBaseId}-${segmentIndex}`
            accumulated = ''
            activeResponseIdRef.current = aiMsgId
            toolBoundaryRef.current = false
          }
          accumulated += chunk
          onPetStateChange('talking')
          setMessages((previous) => {
            const existing = previous.find((message) => message.id === aiMsgId)
            if (existing) {
              return previous.map((message) => message.id === aiMsgId
                ? { ...message, content: accumulated, responseStatus: undefined, memoryRefs }
                : message)
            }
            return [...previous, { id: aiMsgId, role: 'assistant', content: accumulated, timestamp: Date.now(), memoryRefs }]
          })
        },
        controller.signal
      )
    } catch (error) {
      activeResponseIdRef.current = null
      setIsStreaming(false)
      onPetStateChange('idle')
      if (error instanceof Error && error.name === 'AbortError') return
      const message = error instanceof Error ? error.message : '未知错误'
      const errorMessage: Message = {
        id: aiMsgId,
        role: 'assistant',
        content: `请求失败：${message}`,
        timestamp: Date.now(),
        responseStatus: 'error'
      }
      setMessages((previous) => {
        const existing = previous.find((item) => item.id === aiMsgId)
        return existing
          ? previous.map((item) => item.id === aiMsgId ? errorMessage : item)
          : [...previous, errorMessage]
      })
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }, [config, finishPetResponse, onPetStateChange])

  const handleStopGeneration = useCallback(() => {
    const responseId = activeResponseIdRef.current
    abortRef.current?.abort()
    abortRef.current = null
    activeResponseIdRef.current = null
    setToolApprovalRequest(null)
    setIsStreaming(false)
    onPetStateChange('idle')
    if (!responseId) return
    setMessages((previous) => {
      const existing = previous.find((message) => message.id === responseId)
      if (existing) {
        return previous.map((message) => message.id === responseId
          ? { ...message, responseStatus: 'stopped' }
          : message)
      }
      return [...previous, {
        id: responseId,
        role: 'assistant',
        content: '已停止生成。',
        timestamp: Date.now(),
        responseStatus: 'stopped'
      }]
    })
  }, [onPetStateChange])

  const retryAssistantMessage = useCallback((messageId: string) => {
    if (isStreaming) return
    const conversation = getConversationForRetry(messages, messageId)
    if (!conversation) return
    setMessages(conversation)
    void generateAIResponse(conversation)
  }, [messages, isStreaming, generateAIResponse])

  const handleSend = async (content: string, attachments?: PendingAttachment[]) => {
    if (happyTimerRef.current) {
      clearTimeout(happyTimerRef.current)
      happyTimerRef.current = null
    }

    for (const plugin of plugins) {
      const prefix = `/${plugin.command} `
      if (content.startsWith(prefix) || content === `/${plugin.command}`) {
        const extractedContent = content.startsWith(prefix) ? content.slice(prefix.length) : ''
        const result: PluginMessageData = await window.electronAPI.plugin.execute(plugin.id, extractedContent)
        const resultMessage: Message = {
          id: Date.now().toString(),
          role: 'assistant',
          content: result.message,
          timestamp: Date.now(),
          pluginData: result
        }
        setMessages((previous) => [...previous, resultMessage])

        const feedToPetSetting = await window.electronAPI.db.getState(`plugin:${plugin.id}:feedToPet`)
        if (feedToPetSetting === 'true' && result.ok) {
          const petPrompt = `用户刚通过 ${plugin.name} 插件执行了操作：\n输入：${extractedContent}\n结果：${result.message}\n\n请用你的性格简短评论一下（1-2句话）。`
          const systemPrompt = buildSystemPrompt(config.soulMd)
          const petMsgId = (Date.now() + 2).toString()
          let petAccumulated = ''
          onPetStateChange('thinking')
          setIsStreaming(true)
          const petAbort = new AbortController()
          abortRef.current = petAbort
          try {
            await streamChat(
              [{ role: 'user', content: petPrompt, id: petMsgId + '-prompt', timestamp: Date.now() }],
              systemPrompt,
              config,
              (chunk, done) => {
                if (petAbort.signal.aborted) return
                if (done) {
                  finishPetResponse()
                  setIsStreaming(false)
                  return
                }
                petAccumulated += chunk
                onPetStateChange('talking')
                setMessages((previous) => {
                  const existing = previous.find((message) => message.id === petMsgId)
                  return existing
                    ? previous.map((message) => message.id === petMsgId ? { ...message, content: petAccumulated } : message)
                    : [...previous, { id: petMsgId, role: 'assistant', content: petAccumulated, timestamp: Date.now() }]
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
      setConfirmClear(true)
      return
    }
    if (content === '/new') {
      await createSession()
      return
    }
    if (content === '/help') {
      setMessages((previous) => [...previous, {
        id: Date.now().toString(),
        role: 'assistant',
        content: '可用指令：\n- `/new` 新建对话\n- `/clear` 清空当前对话\n- `/remember 内容` 创建记忆候选\n- `/settings` 打开设置\n- `/model` 切换模型\n- `/help` 查看帮助',
        timestamp: Date.now()
      }])
      return
    }
    if (content === '/remember' || content.startsWith('/remember ')) {
      const memoryText = content.slice('/remember'.length).trim()
      if (!memoryText) {
        setMessages((previous) => [...previous, { id: Date.now().toString(), role: 'assistant', content: '用法：`/remember 需要记住的内容`。', timestamp: Date.now() }])
        return
      }
      if (!config.memoryEnabled) {
        setMessages((previous) => [...previous, { id: Date.now().toString(), role: 'assistant', content: '长期记忆已在设置中关闭。', timestamp: Date.now() }])
        return
      }
      const candidates = await window.electronAPI.memory.propose(`请记住：${memoryText}`, activeSessionIdRef.current)
      setMemoryCandidates((previous) => [...previous, ...candidates.filter((candidate) => !previous.some((item) => item.id === candidate.id))])
      return
    }
    if (content === '/settings') {
      setShowSessions(false)
      setShowSettings(true)
      const panelX = Math.min(Math.max(4, position.x), Math.max(4, window.innerWidth - PANEL_SETTINGS_WIDTH - 4))
      const panelY = position.y + PANEL_SETTINGS_HEIGHT > window.innerHeight - 4
        ? Math.max(4, window.innerHeight - PANEL_SETTINGS_HEIGHT - 4)
        : position.y
      if (panelX !== position.x || panelY !== position.y) onPositionChange({ x: panelX, y: panelY })
      return
    }
    if (content === '/model' || content.startsWith('/model ')) {
      const requestedModel = content.slice('/model'.length).trim()
      if (!requestedModel) {
        setMessages((previous) => [...previous, {
          id: Date.now().toString(),
          role: 'assistant',
          content: '请从输入框右下角的模型菜单中选择模型，或输入 `/model 模型名称`。',
          timestamp: Date.now()
        }])
        return
      }
      try {
        const saved = await window.electronAPI.db.saveConfig({ model: requestedModel })
        setConfig(saved)
        setMessages((previous) => [...previous, {
          id: Date.now().toString(),
          role: 'assistant',
          content: `已切换到模型 \`${saved.model}\`。`,
          timestamp: Date.now()
        }])
      } catch (error) {
        const message = error instanceof Error ? error.message : '模型切换失败'
        setMessages((previous) => [...previous, {
          id: Date.now().toString(),
          role: 'assistant',
          content: `模型切换失败：${message}`,
          timestamp: Date.now()
        }])
      }
      return
    }

    let messageContent = content
    const imageAttachment = attachments?.find((attachment) => attachment.type === 'image')
    const textAttachments = attachments?.filter((attachment) => attachment.type === 'text') || []
    if (textAttachments.length > 0) {
      const textParts = textAttachments.map((attachment) => `[附件: ${attachment.name}]\n${attachment.data.slice(0, 2000)}`)
      messageContent = content ? `${content}\n\n${textParts.join('\n\n')}` : textParts.join('\n\n')
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: messageContent,
      timestamp: Date.now(),
      imageUrl: imageAttachment?.data
    }
    const nextMessages = [...messages, userMessage]
    setMessages(nextMessages)
    if (config.memoryEnabled && content.trim()) {
      void window.electronAPI.memory.propose(content, activeSessionIdRef.current, userMessage.id).then((candidates) => {
        if (candidates.length > 0) {
          setMemoryCandidates((previous) => [...previous, ...candidates.filter((candidate) => !previous.some((item) => item.id === candidate.id))])
        }
      }).catch(() => {})
    }
    await generateAIResponse(nextMessages)
  }

  const getStatusText = () => {
    if (petState === 'thinking') return '正在思考...'
    if (petState === 'talking') return '正在回复...'
    return '在线'
  }

  const handleModelChange = useCallback((newModel: string) => {
    setConfig((previous) => ({ ...previous, model: newModel }))
    void window.electronAPI.db.saveConfig({ model: newModel })
  }, [])

  const dismissOnboarding = useCallback(async () => {
    setShowOnboarding(false)
    await window.electronAPI.db.setState('onboarding-dismissed', 'true')
  }, [])

  const openAISettings = useCallback(() => {
    setShowOnboarding(false)
    setShowSessions(false)
    setShowSettings(true)
  }, [])

  const resolveToolApproval = useCallback((approved: boolean) => {
    const request = toolApprovalRequest
    if (!request) return
    window.electronAPI.ai.resolveToolRequest(request.approvalId, approved)
    setToolApprovalRequest(null)
  }, [toolApprovalRequest])

  const resolveMemoryCandidate = useCallback(async (action: MemoryConflictAction | 'approve') => {
    const candidate = memoryCandidates[0]
    if (!candidate) return
    setMemoryCandidateBusy(true)
    setMemoryCandidateError('')
    try {
      if (action === 'approve') await window.electronAPI.memory.approve(candidate.id)
      else if (candidate.conflicts?.some((conflict) => conflict.status === 'pending')) await window.electronAPI.memory.resolveConflict(candidate.id, action)
      else await window.electronAPI.memory.reject(candidate.id)
      setMemoryCandidates((previous) => previous.filter((item) => item.id !== candidate.id))
    } catch (error) {
      setMemoryCandidateError(error instanceof Error ? error.message : '记忆操作失败。')
    } finally {
      setMemoryCandidateBusy(false)
    }
  }, [memoryCandidates])

  const submitMemoryFeedback = useCallback(async (messageId: string, memoryId: string, sourceIds: string[] | undefined, value: MemoryFeedbackValue) => {
    await Promise.all((sourceIds?.length ? sourceIds : [memoryId]).map((sourceId) => window.electronAPI.memory.feedback(sourceId, messageId, value)))
    setMessages((previous) => previous.map((message) => message.id === messageId
      ? { ...message, memoryRefs: message.memoryRefs?.map((memory) => memory.id === memoryId ? { ...memory, feedback: value } : memory) }
      : message))
  }, [])

  const correctMemory = useCallback((memoryId: string) => {
    setMemoryCorrectionId(memoryId)
    setShowSessions(false)
    setShowSettings(true)
    const panelX = Math.min(Math.max(4, position.x), Math.max(4, window.innerWidth - PANEL_SETTINGS_WIDTH - 4))
    const panelY = position.y + PANEL_SETTINGS_HEIGHT > window.innerHeight - 4 ? Math.max(4, window.innerHeight - PANEL_SETTINGS_HEIGHT - 4) : position.y
    if (panelX !== position.x || panelY !== position.y) onPositionChange({ x: panelX, y: panelY })
  }, [onPositionChange, position])

  return (
    <div
      ref={panelRef}
      data-interactive
      className={`chat-panel${showSettings ? ' chat-panel-settings' : ''}${showSessions && !showSettings ? ' chat-panel-workspace' : ''}`}
      style={{ left: position.x, top: position.y, display: visible ? undefined : 'none' }}
    >
      {showSessions && !showSettings && (
        <ConversationSidebar
          sessions={sessions}
          activeSessionId={activeSessionId}
          onClose={() => setShowSessions(false)}
          onCreate={createSession}
          onSelect={selectSession}
          onRename={renameSession}
          onDelete={deleteSession}
          onExport={exportSession}
        />
      )}

      <div className="chat-panel-main">
        {showSettings ? (
          <Settings
            onClose={() => { setShowSettings(false); setMemoryCorrectionId(''); void refreshPlugins(); onSettingsClose?.() }}
            initialNav={memoryCorrectionId ? 'memory' : undefined}
            focusMemoryId={memoryCorrectionId || undefined}
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
                showSessions={showSessions}
                onToggleSessions={() => setShowSessions((value) => !value)}
                onSettings={() => {
                  setShowSessions(false)
                  setShowSettings(true)
                  const panelX = Math.min(Math.max(4, position.x), Math.max(4, window.innerWidth - PANEL_SETTINGS_WIDTH - 4))
                  const panelY = position.y + PANEL_SETTINGS_HEIGHT > window.innerHeight - 4
                    ? Math.max(4, window.innerHeight - PANEL_SETTINGS_HEIGHT - 4)
                    : position.y
                  if (panelX !== position.x || panelY !== position.y) onPositionChange({ x: panelX, y: panelY })
                }}
                onNewTopic={() => { void createSession() }}
                onHide={onHide}
                onClose={onClose}
              />
            </div>

            {showOnboarding && (
              <OnboardingCard onConfigure={openAISettings} onSkip={() => { void dismissOnboarding() }} />
            )}
            {workspaceLoaded && (
              <MessageArea
                messages={messages}
                isStreaming={isStreaming}
                onRetry={retryAssistantMessage}
                contextLimit={MAX_HISTORY_MESSAGES}
                onMemoryFeedback={submitMemoryFeedback}
                onCorrectMemory={correctMemory}
              />
            )}
            {confirmClear && (
              <div className="clear-session-confirm" role="alertdialog" aria-labelledby="clear-session-title">
                <div>
                  <strong id="clear-session-title">清空当前对话？</strong>
                  <span>消息将从这个会话中永久删除。</span>
                </div>
                <div className="clear-session-actions">
                  <button type="button" autoFocus onClick={() => setConfirmClear(false)}>取消</button>
                  <button type="button" className="danger" onClick={() => { void clearCurrentSession() }}>确认清空</button>
                </div>
              </div>
            )}
            {memoryCandidates[0] && (
              <MemoryCandidateCard
                candidate={memoryCandidates[0]}
                remaining={memoryCandidates.length}
                busy={memoryCandidateBusy}
                onResolve={(action) => { void resolveMemoryCandidate(action) }}
              />
            )}
            {memoryCandidateError && <div className="memory-candidate-error" role="alert">{memoryCandidateError}</div>}
            <InputArea
              onSend={handleSend}
              onStop={handleStopGeneration}
              disabled={isStreaming || !workspaceLoaded}
              model={config.model}
              onModelChange={handleModelChange}
              onScreenshot={onScreenshot}
              plugins={plugins}
              pluginCommands={pluginCommands}
              initialActivePlugin={activePluginForInput}
              onInitialPluginConsumed={() => setActivePluginForInput(null)}
              initialAttachment={pendingAttachment}
              onInitialAttachmentConsumed={onPendingAttachmentConsumed}
            />
          </>
        )}
      </div>
      {toolApprovalRequest && (
        <ToolApprovalDialog request={toolApprovalRequest} onResolve={resolveToolApproval} />
      )}
    </div>
  )
}
