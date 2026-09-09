import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react'
import GlobalSearch, { type SearchSnapshot } from '../Workspace/GlobalSearch'
import Journal from '../Journal/Journal'
import WorkspaceNav, { type WorkspacePage } from '../Workspace/WorkspaceNav'
import WorkspaceHeader from '../Workspace/WorkspaceHeader'
import { useWorkspacePresentation } from '../Workspace/useWorkspacePresentation'
import { getWorkspaceGeometry, type WorkspaceMode } from '../../core/workspace-state'
import MessageArea from './MessageArea'
import InputArea, { PendingAttachment } from './InputArea'
import Settings from '../Settings/Settings'
import ConversationSidebar from '../ConversationSidebar/ConversationSidebar'
import OnboardingCard from '../Onboarding/OnboardingCard'
import ToolApprovalDialog from '../ToolApproval/ToolApprovalDialog'
import MemoryCandidateCard from '../Memory/MemoryCandidateCard'
import MemorySettingsTab from '../Settings/MemorySettingsTab'
import type { ToolApprovalRequest, ToolExecutionEvent } from '../../../../shared/tools'
import type { MemoryConflictAction, MemoryFeedbackValue, MemoryRecord } from '../../../../shared/memory'
import { isAIConfigured } from '../../../../shared/config'
import {
  Message,
  PetState,
  AppConfig,
  PluginInfo,
  PluginMessageData
} from '../../shared/types'
import {
  DEFAULT_CONFIG,
  MAX_HISTORY_MESSAGES,
  WORKSPACE_NAV_WIDTH,
} from '../../shared/constants'
import {
  parseStoredSidebarVisibility,
  SESSION_SIDEBAR_STATE_KEY
} from '../../core/panel-state'
import { usePanelResize } from './usePanelResize'
import { useSessionWorkspace } from './useSessionWorkspace'
import './ChatPanel.css'

interface ChatPanelProps {
  visible: boolean
  position: { x: number; y: number }
  onPositionChange: (pos: { x: number; y: number }) => void
  petState: PetState
  onPetStateChange: (state: PetState) => void
  onHide: () => void
  onClose: () => void
  petVisible: boolean
  onPetVisibleChange: (visible: boolean) => void
  initialShowSettings?: boolean
  workspaceRequest?: { page: WorkspacePage; id: number }
  onSettingsClose?: () => void
  onScreenshot?: (hidePanel: boolean, callback: (dataUrl: string) => void) => void
  onScrollScreenshot?: (callback: (dataUrl: string) => void) => void
  initialPluginId?: string | null
  onPluginIdConsumed?: () => void
  pendingAttachment?: { type: 'image' | 'text'; data: string; name: string } | null
  onPendingAttachmentConsumed?: () => void
  pendingMessage?: string | null
  onPendingMessageConsumed?: () => void
}

export default function ChatPanel({ visible, position, onPositionChange, petState, onPetStateChange, onHide, onClose, petVisible, onPetVisibleChange, initialShowSettings, workspaceRequest, onSettingsClose, onScreenshot, onScrollScreenshot, initialPluginId, onPluginIdConsumed, pendingAttachment, onPendingAttachmentConsumed, pendingMessage, onPendingMessageConsumed }: ChatPanelProps) {
  const [activePage, setActivePage] = useState<WorkspacePage>(initialShowSettings ? 'settings' : 'chat')
  const [visitedPages, setVisitedPages] = useState<Partial<Record<WorkspacePage, boolean>>>({ settings: initialShowSettings })
  const showSettings = activePage === 'settings'
  const showMemoryWorkspace = activePage === 'memory'
  const isChat = activePage === 'chat'
  const presentation = useWorkspacePresentation()
  const displayMode = isChat ? presentation.mode : 'workspace'
  const maximized = presentation.maximized
  const settingsCloseRef = useRef(onSettingsClose)
  settingsCloseRef.current = onSettingsClose
  const navigate = useCallback((page: WorkspacePage) => {
    setVisitedPages(previous => ({ ...previous, [page]: true }))
    setActivePage(page)
    if (page !== 'settings') settingsCloseRef.current?.()
  }, [])
  const [showMessageSearch, setShowMessageSearch] = useState(false)
  const searchSnapshot = useRef<SearchSnapshot | null>(null)
  const [showGlobalSearch, setShowGlobalSearch] = useState(false)
  const [journalSearch, setJournalSearch] = useState<{ date: string; query: string; id: number; sourceId?: string }>()
  const [messageSearchQuery, setMessageSearchQuery] = useState('')
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight })
  useEffect(() => {
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  const [showSessions, setShowSessions] = useState(true)
  const [narrowSessionsOpen, setNarrowSessionsOpen] = useState(false)
  const [sidebarLoaded, setSidebarLoaded] = useState(false)
  const [composerFocusRequest, setComposerFocusRequest] = useState(0)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG)
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const [activePluginForInput, setActivePluginForInput] = useState<PluginInfo | null>(null)
  const [toolApprovalRequests, setToolApprovalRequests] = useState<ToolApprovalRequest[]>([])
  const [memoryCandidates, setMemoryCandidates] = useState<MemoryRecord[]>([])
  const [memoryCandidateBusy, setMemoryCandidateBusy] = useState(false)
  const [memoryCandidateError, setMemoryCandidateError] = useState('')
  const [memoryWriteNotice, setMemoryWriteNotice] = useState('')
  const [memoryCorrectionId, setMemoryCorrectionId] = useState('')
  const memoryNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef({ dragging: false, startX: 0, startY: 0, posX: 0, posY: 0, dx: 0, dy: 0 })

  const showMemoryWriteNotice = useCallback((message: string) => {
    if (memoryNoticeTimerRef.current) clearTimeout(memoryNoticeTimerRef.current)
    setMemoryWriteNotice(message)
    memoryNoticeTimerRef.current = setTimeout(() => {
      setMemoryWriteNotice('')
      memoryNoticeTimerRef.current = null
    }, 5000)
  }, [])

  const requestComposerFocus = useCallback(() => {
    setComposerFocusRequest((current) => current + 1)
  }, [])

  const onConfigLoaded = useCallback((loadedConfig: AppConfig) => {
    setConfig(loadedConfig)
    setShowOnboarding(!isAIConfigured(loadedConfig))
  }, [])

  const clearMemoryCandidates = useCallback(() => {
    setMemoryCandidates([])
  }, [])

  const {
    messages,
    sessions,
    activeSessionId,
    workspaceLoaded,
    workspaceError,
    retryWorkspace,
    streamingSessionIds,
    isStreaming,
    sessionGenerationsRef,
    requestSessionRef,
    sessionMessagesRef,
    happyTimerRef,
    activeSessionIdRef,
    updateSessionMessages,
    generateAIResponse,
    createSession,
    selectSession,
    renameSession,
    deleteSession,
    exportSession,
    clearCurrentSession,
    handleStopGeneration,
    retryAssistantMessage,
    editUserMessage,
    continueAssistantMessage
  } = useSessionWorkspace({
    config,
    onPetStateChange,
    onConfigLoaded,
    showMemoryWriteNotice,
    setToolApprovalRequests,
    clearMemoryCandidates,
    requestComposerFocus
  })
  const inputHistory = useMemo(
    () => messages.filter((message) => message.role === 'user' && !message.toolData && message.content.trim()).map((message) => message.content),
    [messages]
  )
  const {
    dimensionsLoaded,
    panelHeight,
    sessionSidebarWidth,
    chatContentWidth,
    handlePanelResizeStart,
    handlePanelResizeMove,
    handlePanelResizeEnd,
    handleSidebarResizeStart,
    handleSidebarResizeMove,
    handleSidebarResizeEnd,
    handleContentResizeStart,
    handleContentResizeMove,
    handleContentResizeEnd
  } = usePanelResize({
    position,
    onPositionChange,
    sidebarOccupiesSpace: displayMode !== 'chat',
    chromeWidth: displayMode === 'workspace' ? WORKSPACE_NAV_WIDTH : 0
  })
  const toolApprovalRequest = toolApprovalRequests[0] || null
  const geometry = getWorkspaceGeometry(displayMode, maximized, viewport, chatContentWidth, sessionSidebarWidth, panelHeight)
  const shellWidth = geometry.width
  const narrowLayout = geometry.narrow
  const sessionsVisible = displayMode !== 'chat' && (narrowLayout ? narrowSessionsOpen : displayMode === 'sessions' || showSessions)
  const panelReady = presentation.loaded && dimensionsLoaded && sidebarLoaded && (workspaceLoaded || Boolean(workspaceError) || showSettings)
  const changeDisplayMode = (mode: WorkspaceMode) => {
    presentation.changeMode(mode)
    if (mode !== 'chat') setShowSessions(true)
    if (mode !== 'workspace') navigate('chat')
    setNarrowSessionsOpen(mode !== 'chat' && narrowLayout)
  }

  const refreshPlugins = useCallback(async () => {
    setPlugins(await window.electronAPI.plugin.getPlugins())
  }, [])

  useEffect(() => () => {
    if (memoryNoticeTimerRef.current) clearTimeout(memoryNoticeTimerRef.current)
  }, [])

  useEffect(() => {
    void refreshPlugins()
  }, [refreshPlugins])

  useEffect(() => window.electronAPI.onConfigChanged((nextConfig) => {
    setConfig(nextConfig)
    setShowOnboarding(!isAIConfigured(nextConfig))
  }), [])

  useEffect(() => {
    window.electronAPI.db.getState(SESSION_SIDEBAR_STATE_KEY)
      .then((storedSidebar) => setShowSessions(storedSidebar === null ? true : parseStoredSidebarVisibility(storedSidebar)))
      .catch(() => {}).finally(() => setSidebarLoaded(true))
  }, [])

  useEffect(() => {
    const unsubscribeApproval = window.electronAPI.ai.onToolApprovalRequest((request) => {
      setToolApprovalRequests((current) => current.some((item) => item.approvalId === request.approvalId) ? current : [...current, request])
    })
    const unsubscribeEvents = window.electronAPI.ai.onToolEvent((event: ToolExecutionEvent) => {
      const sessionId = requestSessionRef.current.get(event.requestId) || activeSessionIdRef.current
      if (!sessionId) return
      const generation = sessionGenerationsRef.current.get(sessionId)
      if (['completed', 'denied', 'error'].includes(event.status)) {
        if (generation) generation.toolBoundary = true
        setToolApprovalRequests((current) => current.filter((request) => request.callId !== event.callId))
      }
      updateSessionMessages(sessionId, (previous) => {
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
  }, [updateSessionMessages])

  useEffect(() => {
    if (initialShowSettings) navigate('settings')
  }, [initialShowSettings, navigate])

  useEffect(() => {
    if (workspaceRequest) navigate(workspaceRequest.page)
  }, [workspaceRequest, navigate])

  useEffect(() => {
    if (pendingAttachment || pendingMessage || initialPluginId) navigate('chat')
  }, [pendingAttachment, pendingMessage, initialPluginId, navigate])

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
    if (visible && panelReady && isChat && workspaceLoaded && !toolApprovalRequest) requestComposerFocus()
  }, [requestComposerFocus, isChat, visible, workspaceLoaded, panelReady, toolApprovalRequest])

  useEffect(() => {
    if (!activeSessionId) return
    onPetStateChange(isStreaming ? 'talking' : 'idle')
  }, [activeSessionId, isStreaming, onPetStateChange])

  useLayoutEffect(() => {
    if (!visible || !panelReady || maximized) return
    const panelEl = panelRef.current
    if (!panelEl) return
      const rect = panelEl.getBoundingClientRect()
      const nextX = Math.min(Math.max(4, position.x), Math.max(4, window.innerWidth - rect.width - 4))
      const nextY = Math.min(Math.max(4, position.y), Math.max(4, window.innerHeight - rect.height - 4))
      if (nextX !== position.x || nextY !== position.y) onPositionChange({ x: nextX, y: nextY })
  }, [visible, panelReady, showMemoryWorkspace, showSettings, showSessions, panelHeight, chatContentWidth, sessionSidebarWidth, position, onPositionChange, viewport, maximized, shellWidth])

  const handleDragStart = useCallback((event: React.PointerEvent) => {
    if (event.button !== 0 || maximized) return
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
  }, [position, maximized])

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


  const toggleSessionSidebar = useCallback(() => {
    if (displayMode === 'chat') { presentation.changeMode('sessions'); setNarrowSessionsOpen(true); return }
    if (narrowLayout) {
      setNarrowSessionsOpen(current => !current)
      return
    }
    if (displayMode === 'sessions') { presentation.changeMode('chat'); return }
    setShowSessions((current) => {
      const next = !current
      void window.electronAPI.db.setState(SESSION_SIDEBAR_STATE_KEY, String(next)).catch(() => { /* The persistent storage notice reports disk failures. */ })
      if (!next) setTimeout(requestComposerFocus, 0)
      return next
    })
  }, [requestComposerFocus, narrowLayout, displayMode, presentation.changeMode])

  useEffect(() => {
    if (maximized || (messages.length === 0 && !isStreaming)) return
    const panelEl = panelRef.current
    if (!panelEl) return
    requestAnimationFrame(() => {
      const rect = panelEl.getBoundingClientRect()
      if (rect.bottom > window.innerHeight - 4) {
        onPositionChange({ ...position, y: Math.max(4, position.y - (rect.bottom - window.innerHeight + 8)) })
      }
    })
  }, [messages.length, isStreaming, maximized])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!visible || toolApprovalRequest || event.defaultPrevented || document.querySelector('dialog[open], [aria-modal="true"]')) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault(); setShowGlobalSearch(true); return
      }
      if (isChat && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        setShowMessageSearch(true)
        return
      }
      if (event.key !== 'Escape') return
      if (isChat && showMessageSearch) {
        setShowMessageSearch(false)
        requestComposerFocus()
        return
      }
      if (isChat && confirmClear) {
        setConfirmClear(false)
        return
      }
      if (!isChat) {
        navigate('chat')
        return
      }
      onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [confirmClear, isChat, navigate, onClose, requestComposerFocus, showMessageSearch, toolApprovalRequest, visible])



  const pluginCommands = plugins.map((plugin) => ({ cmd: '/' + plugin.command, desc: plugin.description }))

  const proposeMemories = useCallback((content: string, sessionId: string, messageId: string) => {
    if (!config.memoryEnabled || !content.trim()) return
    showMemoryWriteNotice('正在分析这条消息是否需要记住…')
    void window.electronAPI.memory.propose(content, sessionId, messageId).then((candidates) => {
      const pendingCandidates = candidates.filter((candidate) => candidate.status === 'pending')
      if (pendingCandidates.length > 0) {
        setMemoryCandidates((previous) => [...previous, ...pendingCandidates.filter((candidate) => !previous.some((item) => item.id === candidate.id))])
        showMemoryWriteNotice(`发现 ${pendingCandidates.length} 条记忆候选，等待确认`)
        return
      }
      const activeCandidates = candidates.filter((candidate) => candidate.status === 'active')
      if (activeCandidates.some((candidate) => candidate.type === 'person')) showMemoryWriteNotice('身份档案已更新')
      else if (activeCandidates.length > 0) showMemoryWriteNotice(`已自动保存 ${activeCandidates.length} 条记忆`)
      else showMemoryWriteNotice('这条消息未识别为需要保存的用户信息')
    }).catch((error) => showMemoryWriteNotice(error instanceof Error ? `Mem0 记忆写入失败：${error.message}` : 'Mem0 记忆写入失败，请检查连接配置'))
  }, [config.memoryEnabled, showMemoryWriteNotice])

  const handleSend = async (content: string, attachments?: PendingAttachment[]) => {
    const originatingSessionId = activeSessionIdRef.current
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
        updateSessionMessages(originatingSessionId, (previous) => [...previous, resultMessage])

        const feedToPetSetting = await window.electronAPI.db.getState(`plugin:${plugin.id}:feedToPet`)
        if (feedToPetSetting === 'true' && result.ok) {
          const petPrompt = `用户刚通过 ${plugin.name} 插件执行了操作：\n输入：${extractedContent}\n结果：${result.message}\n\n请用你的性格简短评论一下（1-2句话）。`
          const petMsgId = (Date.now() + 2).toString()
          await generateAIResponse(
            [{ role: 'user', content: petPrompt, id: petMsgId + '-prompt', timestamp: Date.now() }],
            originatingSessionId
          )
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
      updateSessionMessages(originatingSessionId, (previous) => [...previous, {
        id: Date.now().toString(),
        role: 'assistant',
        content: '可用指令：\n- `/new` 新建对话\n- `/clear` 清空当前对话\n- `/remember 内容` 创建记忆候选\n- `/memory` 打开记忆工作区\n- `/journal` 打开工作日志\n- `/settings` 打开设置\n- `/model` 切换模型\n- `/help` 查看帮助',
        timestamp: Date.now()
      }])
      return
    }
    if (content === '/remember' || content.startsWith('/remember ')) {
      const memoryText = content.slice('/remember'.length).trim()
      if (!memoryText) {
        updateSessionMessages(originatingSessionId, (previous) => [...previous, { id: Date.now().toString(), role: 'assistant', content: '用法：`/remember 需要记住的内容`。', timestamp: Date.now() }])
        return
      }
      if (!config.memoryEnabled) {
        updateSessionMessages(originatingSessionId, (previous) => [...previous, { id: Date.now().toString(), role: 'assistant', content: '长期记忆已在设置中关闭。', timestamp: Date.now() }])
        return
      }
      const candidates = await window.electronAPI.memory.propose(`请记住：${memoryText}`, activeSessionIdRef.current)
      const pendingCandidates = candidates.filter((candidate) => candidate.status === 'pending')
      setMemoryCandidates((previous) => [...previous, ...pendingCandidates.filter((candidate) => !previous.some((item) => item.id === candidate.id))])
      return
    }
    if (content === '/journal') {
      navigate('journal')
      return
    }
    if (content === '/memory') {
      openMemoryWorkspace()
      return
    }
    if (content === '/settings') {
      navigate('settings')
      return
    }
    if (content === '/model' || content.startsWith('/model ')) {
      const requestedModel = content.slice('/model'.length).trim()
      if (!requestedModel) {
        updateSessionMessages(originatingSessionId, (previous) => [...previous, {
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
        updateSessionMessages(originatingSessionId, (previous) => [...previous, {
          id: Date.now().toString(),
          role: 'assistant',
          content: `已切换到模型 \`${saved.model}\`。`,
          timestamp: Date.now()
        }])
      } catch (error) {
        const message = error instanceof Error ? error.message : '模型切换失败'
        updateSessionMessages(originatingSessionId, (previous) => [...previous, {
          id: Date.now().toString(),
          role: 'assistant',
          content: `模型切换失败：${message}`,
          timestamp: Date.now()
        }])
      }
      return
    }

    if (!isAIConfigured(config)) {
      setShowOnboarding(true)
      updateSessionMessages(originatingSessionId, (previous) => [...previous, { id: Date.now().toString(), role: 'assistant', content: '尚未完成 AI Provider 配置。请填写 Base URL、API Key 和模型并通过连接检测后再开始对话。', timestamp: Date.now() }])
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
    const sessionId = activeSessionIdRef.current
    const currentMessages = sessionMessagesRef.current.get(sessionId) || messages
    const nextMessages = [...currentMessages, userMessage]
    updateSessionMessages(sessionId, () => nextMessages)
    proposeMemories(content, sessionId, userMessage.id)
    await generateAIResponse(nextMessages, sessionId)
  }

  const handleEditMessage = useCallback((messageId: string, newContent: string) => {
    if (isStreaming) return
    const sessionId = activeSessionIdRef.current
    proposeMemories(newContent, sessionId, messageId)
    editUserMessage(messageId, newContent)
  }, [isStreaming, proposeMemories, editUserMessage])

  const getStatusText = () => {
    if (isStreaming) return '正在回复...'
    if (petState === 'thinking') return '正在思考...'
    if (petState === 'talking') return '正在回复...'
    return '在线'
  }

  const handleModelChange = useCallback((newModel: string) => {
    setConfig((previous) => ({ ...previous, model: newModel }))
    void window.electronAPI.db.saveConfig({ model: newModel })
  }, [])

  const openAISettings = useCallback(() => {
    setShowOnboarding(false)
    navigate('settings')
  }, [navigate])

  const openMemoryWorkspace = useCallback((focusId = '') => {
    setMemoryCorrectionId(focusId)
    navigate('memory')
  }, [navigate])

  const saveMemoryWorkspaceConfig = useCallback(async (patch: Partial<AppConfig>) => {
    const saved = await window.electronAPI.db.saveConfig(patch)
    setConfig(saved)
  }, [])

  const resolveToolApproval = useCallback((approved: boolean) => {
    const request = toolApprovalRequest
    if (!request) return
    window.electronAPI.ai.resolveToolRequest(request.approvalId, approved)
    setToolApprovalRequests((current) => current.filter((item) => item.approvalId !== request.approvalId))
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
      if (memoryCandidates.length === 1) requestComposerFocus()
    } catch (error) {
      setMemoryCandidateError(error instanceof Error ? error.message : '记忆操作失败。')
    } finally {
      setMemoryCandidateBusy(false)
    }
  }, [memoryCandidates, requestComposerFocus])

  const submitMemoryFeedback = useCallback(async (messageId: string, memoryId: string, sourceIds: string[] | undefined, value: MemoryFeedbackValue) => {
    const sessionId = activeSessionIdRef.current
    await Promise.all((sourceIds?.length ? sourceIds : [memoryId]).map((sourceId) => window.electronAPI.memory.feedback(sourceId, messageId, value)))
    updateSessionMessages(sessionId, (previous) => previous.map((message) => message.id === messageId
      ? { ...message, memoryRefs: message.memoryRefs?.map((memory) => memory.id === memoryId ? { ...memory, feedback: value } : memory) }
      : message))
  }, [updateSessionMessages])

  const correctMemory = useCallback((memoryId: string) => {
    openMemoryWorkspace(memoryId)
  }, [openMemoryWorkspace])

  const dragHandleProps = {
    onPointerDown: handleDragStart,
    onPointerMove: handleDragMove,
    onPointerUp: handleDragEnd,
    onPointerCancel: handleDragEnd
  }

  return (
    <div ref={panelRef} data-interactive data-ready={panelReady}
      className="chat-panel app-workspace"
      data-window-mode={displayMode} data-maximized={maximized}
      data-workspace-page={activePage}
      style={{ left: maximized ? 4 : position.x, top: maximized ? 4 : position.y, width: shellWidth, height: geometry.height, display: visible && panelReady ? undefined : 'none' }}>
      {displayMode === 'workspace' && <WorkspaceNav activePage={activePage} onNavigate={navigate} status={getStatusText()} />}
      <WorkspaceHeader onHide={onHide} onClose={onClose} dragHandleProps={dragHandleProps}
        onSearch={() => setShowGlobalSearch(true)}
        maximized={maximized} onMaximize={presentation.toggleMaximized} mode={displayMode} onModeChange={changeDisplayMode} />
      <div className="workspace-body">
        <div className="workspace-page workspace-chat" hidden={!isChat}>
          {sessionsVisible && narrowLayout && <button className="workspace-sessions-backdrop" aria-label="收起会话列表" onClick={toggleSessionSidebar} />}
          <div className="workspace-sessions" hidden={!sessionsVisible} style={{ width: sessionSidebarWidth }}>
            <ConversationSidebar
              sessions={sessions} activeSessionId={activeSessionId} width={sessionSidebarWidth}
              streamingSessionIds={streamingSessionIds} dragHandleProps={dragHandleProps}
              onCreate={async () => { await createSession(); if (narrowLayout) toggleSessionSidebar() }}
              onSelect={async (id, query) => {
                await selectSession(id)
                setMessageSearchQuery(query || '')
                setShowMessageSearch(Boolean(query))
                if (narrowLayout) toggleSessionSidebar()
              }}
              onRename={renameSession} onDelete={deleteSession} onExport={exportSession}
            />
          </div>
          {sessionsVisible && <div className="session-sidebar-resize-edge" style={{ left: sessionSidebarWidth - 4 }}
            data-interactive role="separator" aria-label="调整会话列表宽度" aria-orientation="vertical"
            onPointerDown={handleSidebarResizeStart} onPointerMove={handleSidebarResizeMove}
            onPointerUp={handleSidebarResizeEnd} onPointerCancel={handleSidebarResizeEnd} />}
          <div className="chat-panel-main">
            {showOnboarding && <OnboardingCard onConfigure={openAISettings} />}
            {workspaceError && <div className="memory-candidate-error" role="alert">{workspaceError}<button onClick={retryWorkspace}>重新加载</button></div>}
            {workspaceLoaded && (
              <MessageArea
                key={activeSessionId}
                searchOpen={showMessageSearch}
                initialSearch={messageSearchQuery}
                onCloseSearch={() => { setShowMessageSearch(false); requestComposerFocus() }}
                messages={messages}
                isStreaming={isStreaming}
                onRetry={retryAssistantMessage}
                onEditMessage={handleEditMessage}
                onContinueMessage={continueAssistantMessage}
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
                  <button type="button" autoFocus onClick={() => { setConfirmClear(false); requestComposerFocus() }}>取消</button>
                  <button type="button" className="danger" onClick={() => { setConfirmClear(false); void clearCurrentSession() }}>确认清空</button>
                </div>
              </div>
            )}
            {memoryCandidates[0] && (
              <MemoryCandidateCard
                candidate={memoryCandidates[0]}
                remaining={memoryCandidates.length}
                busy={memoryCandidateBusy}
                reviewReason={memoryCandidates[0].confidence < config.memoryAutoWriteConfidence
                  ? '表达中包含不确定信息，确认后才会写入长期记忆。'
                  : config.memoryWriteMode === 'confirm'
                    ? '当前设置要求每条候选记忆都由你确认。'
                    : undefined}
                onResolve={(action) => { void resolveMemoryCandidate(action) }}
              />
            )}
            {memoryCandidateError && <div className="memory-candidate-error" role="alert">{memoryCandidateError}</div>}
            {memoryWriteNotice && <div className="memory-write-notice" role="status">{memoryWriteNotice}</div>}
            <InputArea
              sessionId={activeSessionId}
              active={visible && isChat && !toolApprovalRequest}
              onSend={handleSend}
              onStop={handleStopGeneration}
              disabled={!workspaceLoaded}
              isStreaming={isStreaming}
              focusRequest={composerFocusRequest}
              model={config.model}
              onModelChange={handleModelChange}
              onScreenshot={onScreenshot}
              onScrollScreenshot={onScrollScreenshot}
              plugins={plugins}
              pluginCommands={pluginCommands}
              initialActivePlugin={activePluginForInput}
              onInitialPluginConsumed={() => setActivePluginForInput(null)}
              initialAttachment={pendingAttachment}
              onInitialAttachmentConsumed={onPendingAttachmentConsumed}
              history={inputHistory}
            />
          </div>
        </div>
        <section className="workspace-page workspace-memory" hidden={!showMemoryWorkspace} aria-label="记忆工作区">
          {visitedPages.memory && <>
            <div className="memory-workspace-content">
              <MemorySettingsTab workspace active={visible && showMemoryWorkspace}
                enabled={config.memoryEnabled} onEnabledChange={enabled => { void saveMemoryWorkspaceConfig({ memoryEnabled: enabled }) }}
                config={config} onSaveConfig={saveMemoryWorkspaceConfig} focusMemoryId={memoryCorrectionId || undefined} />
            </div>
          </>}
        </section>
        <section className="workspace-page workspace-journal" hidden={activePage !== 'journal'} aria-label="活动工作区">
          {visitedPages.journal && <>
            <Journal active={visible && activePage === 'journal'} searchRequest={journalSearch} />
          </>}
        </section>
        <section className="workspace-page workspace-settings" hidden={!showSettings} aria-label="设置工作区">
          {visitedPages.settings && <>
            <Settings onClose={() => navigate('chat')} petVisible={petVisible} onPetVisibleChange={onPetVisibleChange}
              onOpenMemoryWorkspace={() => openMemoryWorkspace()} onOpenJournalWorkspace={() => navigate('journal')} embedded />
          </>}
        </section>
      </div>
      <div className="chat-content-resize-edge" style={{ right: -4, left: 'auto' }}
        data-interactive role="separator" aria-label="调整聊天内容区宽度" aria-orientation="vertical"
        onPointerDown={handleContentResizeStart} onPointerMove={handleContentResizeMove}
        onPointerUp={handleContentResizeEnd} onPointerCancel={handleContentResizeEnd} />
      {(['top', 'bottom'] as const).map(edge => <div key={edge}
        className={`panel-resize-edge panel-resize-edge-${edge}`} data-interactive role="separator"
        aria-label={`从${edge === 'top' ? '顶部' : '底部'}调整聊天面板高度`} aria-orientation="horizontal"
        onPointerDown={event => handlePanelResizeStart(edge, event)} onPointerMove={handlePanelResizeMove}
        onPointerUp={handlePanelResizeEnd} onPointerCancel={handlePanelResizeEnd} />)}
      {toolApprovalRequest && <ToolApprovalDialog request={toolApprovalRequest} onResolve={resolveToolApproval} />}
      {showGlobalSearch && visible && <GlobalSearch snapshot={searchSnapshot} onClose={() => setShowGlobalSearch(false)}
        onSession={async (id, query) => { await selectSession(id); navigate('chat'); setNarrowSessionsOpen(false); setMessageSearchQuery(query); setShowMessageSearch(true) }}
        onMemory={openMemoryWorkspace}
        onJournal={(date, query, sourceId) => { setJournalSearch({ date, query, sourceId, id: Date.now() }); navigate('journal') }} />}
    </div>
  )
}
