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
import { isAIConfigured } from '../../../../shared/config'
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
  PANEL_SETTINGS_HEIGHT,
  PANEL_SETTINGS_WIDTH,
  PANEL_MIN_HEIGHT,
  CHAT_CONTENT_MAX_WIDTH,
  CHAT_CONTENT_MIN_WIDTH,
  SESSION_SIDEBAR_MAX_WIDTH,
  SESSION_SIDEBAR_MIN_WIDTH,
} from '../../shared/constants'
import { streamChat } from '../../core/ai-engine'
import { buildSystemPrompt, buildMessages } from '../../core/prompt-builder'
import { loadSessionWorkspace, saveActiveSessionMessages } from '../../core/memory'
import { getConversationForRetry } from '../../core/conversation-actions'
import { mergeSessionsInCurrentOrder } from '../../core/session-order'
import {
  getDefaultPanelHeight,
  normalizePanelHeight,
  normalizeChatContentWidth,
  normalizeSessionSidebarWidth,
  PANEL_HEIGHT_STATE_KEY,
  parseStoredSidebarVisibility,
  SESSION_SIDEBAR_STATE_KEY,
  SESSION_SIDEBAR_WIDTH_STATE_KEY,
  CHAT_CONTENT_WIDTH_STATE_KEY
} from '../../core/panel-state'
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
  onSettingsClose?: () => void
  onScreenshot?: (hidePanel: boolean, callback: (dataUrl: string) => void) => void
  initialPluginId?: string | null
  onPluginIdConsumed?: () => void
  pendingAttachment?: { type: 'image' | 'text'; data: string; name: string } | null
  onPendingAttachmentConsumed?: () => void
  pendingMessage?: string | null
  onPendingMessageConsumed?: () => void
}

interface SessionGeneration {
  controller: AbortController
  responseId: string
  toolBoundary: boolean
  requestId?: string
}

export default function ChatPanel({ visible, position, onPositionChange, petState, onPetStateChange, onHide, onClose, petVisible, onPetVisibleChange, initialShowSettings, onSettingsClose, onScreenshot, initialPluginId, onPluginIdConsumed, pendingAttachment, onPendingAttachmentConsumed, pendingMessage, onPendingMessageConsumed }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([])
  const [activeSessionId, setActiveSessionId] = useState('')
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false)
  const [streamingSessionIds, setStreamingSessionIds] = useState<Set<string>>(() => new Set())
  const [showSettings, setShowSettings] = useState(initialShowSettings || false)
  const [showSessions, setShowSessions] = useState(false)
  const [panelHeight, setPanelHeight] = useState(() => getDefaultPanelHeight(window.innerHeight))
  const [sessionSidebarWidth, setSessionSidebarWidth] = useState(() => normalizeSessionSidebarWidth(undefined))
  const [chatContentWidth, setChatContentWidth] = useState(() => normalizeChatContentWidth(undefined))
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
  const sessionGenerationsRef = useRef<Map<string, SessionGeneration>>(new Map())
  const pendingGenerationsRef = useRef<Set<string>>(new Set())
  const requestSessionRef = useRef<Map<string, string>>(new Map())
  const sessionMessagesRef = useRef<Map<string, Message[]>>(new Map())
  const happyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const memoryNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef({ dragging: false, startX: 0, startY: 0, posX: 0, posY: 0, dx: 0, dy: 0 })
  const panelResizeRef = useRef({ resizing: false, edge: 'bottom' as 'top' | 'bottom', startY: 0, startHeight: 0, startTop: 0, currentHeight: 0 })
  const sidebarResizeRef = useRef({ resizing: false, startX: 0, startWidth: 0, currentWidth: 0 })
  const contentResizeRef = useRef({ resizing: false, startX: 0, startWidth: 0, currentWidth: 0 })
  const initializedRef = useRef(false)
  const latestMessagesRef = useRef<Message[]>([])
  const activeSessionIdRef = useRef('')
  const isStreaming = activeSessionId ? streamingSessionIds.has(activeSessionId) : false
  const toolApprovalRequest = toolApprovalRequests[0] || null

  const showMemoryWriteNotice = useCallback((message: string) => {
    if (memoryNoticeTimerRef.current) clearTimeout(memoryNoticeTimerRef.current)
    setMemoryWriteNotice(message)
    memoryNoticeTimerRef.current = setTimeout(() => {
      setMemoryWriteNotice('')
      memoryNoticeTimerRef.current = null
    }, 5000)
  }, [])

  useEffect(() => () => {
    if (memoryNoticeTimerRef.current) clearTimeout(memoryNoticeTimerRef.current)
  }, [])

  const requestComposerFocus = useCallback(() => {
    setComposerFocusRequest((current) => current + 1)
  }, [])

  const setSessionStreaming = useCallback((sessionId: string, streaming: boolean) => {
    setStreamingSessionIds((previous) => {
      const next = new Set(previous)
      if (streaming) next.add(sessionId)
      else next.delete(sessionId)
      return next
    })
  }, [])

  const updateSessionMessages = useCallback((sessionId: string, updater: (messages: Message[]) => Message[]): Message[] => {
    const current = sessionMessagesRef.current.get(sessionId)
      || (activeSessionIdRef.current === sessionId ? latestMessagesRef.current : [])
    const next = updater(current)
    sessionMessagesRef.current.set(sessionId, next)
    if (activeSessionIdRef.current === sessionId) {
      latestMessagesRef.current = next
      setMessages(next)
    }
    return next
  }, [])

  const persistSessionMessages = useCallback((sessionId: string, nextMessages: Message[]) => {
    void window.electronAPI.db.saveSessionMessages(sessionId, nextMessages).then((workspace) => {
      setSessions((previous) => mergeSessionsInCurrentOrder(previous, workspace.sessions))
    }).catch(() => {})
  }, [])

  const refreshPlugins = useCallback(async () => {
    setPlugins(await window.electronAPI.plugin.getPlugins())
  }, [])

  const applyWorkspace = useCallback((workspace: SessionWorkspace, preserveSessionOrder = false) => {
    const sessionId = workspace.activeSession.id
    const activeMessages = sessionGenerationsRef.current.has(sessionId)
      ? sessionMessagesRef.current.get(sessionId) || workspace.activeSession.messages
      : workspace.activeSession.messages
    activeSessionIdRef.current = sessionId
    latestMessagesRef.current = activeMessages
    sessionMessagesRef.current.set(sessionId, activeMessages)
    setActiveSessionId(sessionId)
    setMessages(activeMessages)
    setSessions((previous) => {
      if (!preserveSessionOrder || previous.length === 0) return workspace.sessions
      return mergeSessionsInCurrentOrder(previous, workspace.sessions)
    })
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

  const stopSessionResponse = useCallback((sessionId: string) => {
    pendingGenerationsRef.current.delete(sessionId)
    const generation = sessionGenerationsRef.current.get(sessionId)
    if (!generation) return
    generation.controller.abort()
    if (generation.requestId) requestSessionRef.current.delete(generation.requestId)
    sessionGenerationsRef.current.delete(sessionId)
    setSessionStreaming(sessionId, false)
    setToolApprovalRequests((current) => current.filter((request) => request.requestId !== generation.requestId))
    if (activeSessionIdRef.current === sessionId) onPetStateChange('idle')
  }, [onPetStateChange, setSessionStreaming])

  const persistCurrentSession = useCallback(async (preserveSessionOrder = false) => {
    const id = activeSessionIdRef.current
    if (!id || !initializedRef.current) return
    const workspace = await saveActiveSessionMessages(id, latestMessagesRef.current)
    setSessions((previous) => preserveSessionOrder ? mergeSessionsInCurrentOrder(previous, workspace.sessions) : workspace.sessions)
  }, [])

  useEffect(() => {
    Promise.all([
      loadSessionWorkspace(),
      window.electronAPI.db.getConfig()
    ]).then(([workspace, loadedConfig]) => {
      applyWorkspace(workspace)
      setConfig(loadedConfig)
      setShowOnboarding(!isAIConfigured(loadedConfig))
      initializedRef.current = true
      setWorkspaceLoaded(true)
    })
    void refreshPlugins()
  }, [applyWorkspace, refreshPlugins])

  useEffect(() => window.electronAPI.onConfigChanged((nextConfig) => {
    setConfig(nextConfig)
    setShowOnboarding(!isAIConfigured(nextConfig))
  }), [])

  useEffect(() => {
    Promise.all([
      window.electronAPI.db.getState(PANEL_HEIGHT_STATE_KEY),
      window.electronAPI.db.getState(SESSION_SIDEBAR_STATE_KEY),
      window.electronAPI.db.getState(SESSION_SIDEBAR_WIDTH_STATE_KEY),
      window.electronAPI.db.getState(CHAT_CONTENT_WIDTH_STATE_KEY)
    ]).then(([storedHeight, storedSidebar, storedSidebarWidth, storedContentWidth]) => {
      setPanelHeight(normalizePanelHeight(storedHeight, window.innerHeight))
      setShowSessions(parseStoredSidebarVisibility(storedSidebar))
      setSessionSidebarWidth(normalizeSessionSidebarWidth(storedSidebarWidth))
      setChatContentWidth(normalizeChatContentWidth(storedContentWidth, window.innerWidth, normalizeSessionSidebarWidth(storedSidebarWidth)))
    }).catch(() => {})

    const clampToViewport = () => {
      setPanelHeight((current) => normalizePanelHeight(current, window.innerHeight))
      setChatContentWidth((current) => normalizeChatContentWidth(current, window.innerWidth, sessionSidebarWidth))
    }
    window.addEventListener('resize', clampToViewport)
    return () => window.removeEventListener('resize', clampToViewport)
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
    if (initialShowSettings) {
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
    if (visible && !showSettings && workspaceLoaded) requestComposerFocus()
  }, [requestComposerFocus, showSettings, visible, workspaceLoaded])

  useEffect(() => {
    if (!activeSessionId) return
    onPetStateChange(isStreaming ? 'talking' : 'idle')
  }, [activeSessionId, isStreaming, onPetStateChange])

  useEffect(() => {
    if (!visible || showSettings) return
    const panelEl = panelRef.current
    if (!panelEl) return
    requestAnimationFrame(() => {
      const rect = panelEl.getBoundingClientRect()
      const nextX = Math.min(Math.max(4, position.x), Math.max(4, window.innerWidth - rect.width - 4))
      const nextY = Math.min(Math.max(4, position.y), Math.max(4, window.innerHeight - rect.height - 4))
      if (nextX !== position.x || nextY !== position.y) onPositionChange({ x: nextX, y: nextY })
    })
  }, [visible, showSettings, showSessions, panelHeight, position, onPositionChange])

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

  const handlePanelResizeStart = useCallback((edge: 'top' | 'bottom', event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    panelResizeRef.current = { resizing: true, edge, startY: event.screenY, startHeight: panelHeight, startTop: position.y, currentHeight: panelHeight }
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [panelHeight, position.y])

  const handlePanelResizeMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!panelResizeRef.current.resizing) return
    const { edge, startY, startHeight, startTop } = panelResizeRef.current
    const delta = event.screenY - startY
    const maxHeight = edge === 'top'
      ? Math.max(PANEL_MIN_HEIGHT, startHeight + startTop - 4)
      : Math.max(PANEL_MIN_HEIGHT, window.innerHeight - startTop - 4)
    const requestedHeight = edge === 'top' ? startHeight - delta : startHeight + delta
    const nextHeight = Math.min(maxHeight, Math.max(PANEL_MIN_HEIGHT, requestedHeight))
    panelResizeRef.current.currentHeight = nextHeight
    setPanelHeight(nextHeight)
    if (edge === 'top') {
      const nextTop = startTop + startHeight - nextHeight
      onPositionChange({ x: position.x, y: nextTop })
    }
  }, [onPositionChange, position.x])

  const handlePanelResizeEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!panelResizeRef.current.resizing) return
    panelResizeRef.current.resizing = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    void window.electronAPI.db.setState(PANEL_HEIGHT_STATE_KEY, String(panelResizeRef.current.currentHeight))
  }, [])

  const handleSidebarResizeStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    sidebarResizeRef.current = { resizing: true, startX: event.screenX, startWidth: sessionSidebarWidth, currentWidth: sessionSidebarWidth }
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [sessionSidebarWidth])

  const handleSidebarResizeMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!sidebarResizeRef.current.resizing) return
    const requested = sidebarResizeRef.current.startWidth + event.screenX - sidebarResizeRef.current.startX
    const viewportMaximum = Math.max(SESSION_SIDEBAR_MIN_WIDTH, window.innerWidth - position.x - chatContentWidth - 16)
    const nextWidth = Math.min(SESSION_SIDEBAR_MAX_WIDTH, viewportMaximum, Math.max(SESSION_SIDEBAR_MIN_WIDTH, requested))
    sidebarResizeRef.current.currentWidth = nextWidth
    setSessionSidebarWidth(nextWidth)
  }, [chatContentWidth, position.x])

  const handleSidebarResizeEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!sidebarResizeRef.current.resizing) return
    sidebarResizeRef.current.resizing = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    void window.electronAPI.db.setState(SESSION_SIDEBAR_WIDTH_STATE_KEY, String(sidebarResizeRef.current.currentWidth))
  }, [])

  const handleContentResizeStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    contentResizeRef.current = { resizing: true, startX: event.screenX, startWidth: chatContentWidth, currentWidth: chatContentWidth }
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [chatContentWidth])

  const handleContentResizeMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!contentResizeRef.current.resizing) return
    const requested = contentResizeRef.current.startWidth + event.screenX - contentResizeRef.current.startX
    const nextWidth = normalizeChatContentWidth(requested, window.innerWidth - position.x, showSessions && !showSettings ? sessionSidebarWidth : 0)
    contentResizeRef.current.currentWidth = nextWidth
    setChatContentWidth(nextWidth)
  }, [position.x, sessionSidebarWidth, showSessions, showSettings])

  const handleContentResizeEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!contentResizeRef.current.resizing) return
    contentResizeRef.current.resizing = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    void window.electronAPI.db.setState(CHAT_CONTENT_WIDTH_STATE_KEY, String(contentResizeRef.current.currentWidth))
  }, [])

  const toggleSessionSidebar = useCallback(() => {
    setShowSessions((current) => {
      const next = !current
      void window.electronAPI.db.setState(SESSION_SIDEBAR_STATE_KEY, String(next))
      if (!next) setTimeout(requestComposerFocus, 0)
      return next
    })
  }, [requestComposerFocus])

  useEffect(() => {
    latestMessagesRef.current = messages
    if (!initializedRef.current || !activeSessionId) return
    const sessionId = activeSessionId
    const timer = setTimeout(() => {
      void saveActiveSessionMessages(sessionId, messages).then((workspace) => {
        if (activeSessionIdRef.current === sessionId) {
          setSessions((previous) => mergeSessionsInCurrentOrder(previous, workspace.sessions))
        }
      })
    }, 450)
    return () => clearTimeout(timer)
  }, [messages, activeSessionId])

  useEffect(() => () => {
    sessionGenerationsRef.current.forEach((generation) => generation.controller.abort())
    if (happyTimerRef.current) clearTimeout(happyTimerRef.current)
    onPetStateChange('idle')
    if (initializedRef.current) {
      sessionMessagesRef.current.forEach((storedMessages, sessionId) => {
        void window.electronAPI.db.saveSessionMessages(sessionId, storedMessages)
      })
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
      if (showSettings) {
        setShowSettings(false)
        onSettingsClose?.()
        return
      }
      if (showSessions) {
        toggleSessionSidebar()
        return
      }
      onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [confirmClear, onClose, onSettingsClose, showSessions, showSettings, toggleSessionSidebar, visible])

  const createSession = useCallback(async () => {
    await persistCurrentSession()
    const workspace = await window.electronAPI.db.createSession()
    applyWorkspace(workspace)
    requestComposerFocus()
  }, [applyWorkspace, persistCurrentSession, requestComposerFocus])

  const selectSession = useCallback(async (id: string) => {
    if (id === activeSessionIdRef.current) return
    await persistCurrentSession(true)
    applyWorkspace(await window.electronAPI.db.selectSession(id), true)
    requestComposerFocus()
  }, [applyWorkspace, persistCurrentSession, requestComposerFocus])

  const renameSession = useCallback(async (id: string, title: string) => {
    const updated = await window.electronAPI.db.renameSession(id, title)
    setSessions((previous) => mergeSessionsInCurrentOrder(previous, updated))
  }, [])

  const deleteSession = useCallback(async (id: string) => {
    stopSessionResponse(id)
    applyWorkspace(await window.electronAPI.db.deleteSession(id), true)
  }, [applyWorkspace, stopSessionResponse])

  const exportSession = useCallback(async (id: string) => {
    await persistCurrentSession(true)
    const result = await window.electronAPI.db.exportSession(id)
    return result.ok
  }, [persistCurrentSession])

  const clearCurrentSession = useCallback(async () => {
    stopSessionResponse(activeSessionIdRef.current)
    updateSessionMessages(activeSessionIdRef.current, () => [])
    setConfirmClear(false)
    if (!activeSessionIdRef.current) return
    const workspace = await window.electronAPI.db.saveSessionMessages(activeSessionIdRef.current, [])
    setSessions((previous) => mergeSessionsInCurrentOrder(previous, workspace.sessions))
    requestComposerFocus()
  }, [requestComposerFocus, stopSessionResponse, updateSessionMessages])

  const pluginCommands = plugins.map((plugin) => ({ cmd: '/' + plugin.command, desc: plugin.description }))

  const generateAIResponse = useCallback(async (conversation: Message[], sessionId = activeSessionIdRef.current) => {
    if (!sessionId) return
    if (sessionGenerationsRef.current.has(sessionId)) {
      // Start another response as soon as the current one completes. Read the
      // session's latest messages at that point so the completed answer is in
      // the next request's context.
      pendingGenerationsRef.current.add(sessionId)
      return
    }
    const responseBaseId = `${Date.now()}-assistant`
    let segmentIndex = 0
    let aiMsgId = responseBaseId
    let accumulated = ''
    const controller = new AbortController()
    const generation: SessionGeneration = { controller, responseId: aiMsgId, toolBoundary: false }
    // Mark the session busy before memory lookup so a fast second send is queued.
    sessionGenerationsRef.current.set(sessionId, generation)
    if (activeSessionIdRef.current === sessionId) onPetStateChange('thinking')
    setSessionStreaming(sessionId, true)

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
    const memoryContext = formatMemoryContext(relevantMemories)
    const memoryConversationPolicy = '记忆写入由系统单独分析并反馈。除非相关记忆明确出现在上下文中，否则不要声称已经记住用户信息；像“我叫不上”这类歧义表达应先询问确认，不要直接当作姓名。'
    const systemPrompt = buildSystemPrompt(config.soulMd, [memoryContext, memoryConversationPolicy].filter(Boolean).join('\n\n'))
    const history = buildMessages(conversation)

    const finishGeneration = () => {
      if (sessionGenerationsRef.current.get(sessionId) !== generation) return
      sessionGenerationsRef.current.delete(sessionId)
      if (generation.requestId) requestSessionRef.current.delete(generation.requestId)
      if (pendingGenerationsRef.current.has(sessionId)) {
        pendingGenerationsRef.current.delete(sessionId)
        const queuedConversation = sessionMessagesRef.current.get(sessionId) || []
        void generateAIResponse(queuedConversation, sessionId)
        return
      }
      setSessionStreaming(sessionId, false)
      const storedMessages = sessionMessagesRef.current.get(sessionId) || []
      persistSessionMessages(sessionId, storedMessages)
    }

    try {
      await streamChat(
        history,
        systemPrompt,
        config,
        (chunk, done) => {
          if (controller.signal.aborted) return
          if (done) {
            finishGeneration()
            if (activeSessionIdRef.current === sessionId) finishPetResponse()
            return
          }
          if (chunk && generation.toolBoundary) {
            segmentIndex += 1
            aiMsgId = `${responseBaseId}-${segmentIndex}`
            accumulated = ''
            generation.responseId = aiMsgId
            generation.toolBoundary = false
          }
          accumulated += chunk
          if (activeSessionIdRef.current === sessionId) onPetStateChange('talking')
          updateSessionMessages(sessionId, (previous) => {
            const existing = previous.find((message) => message.id === aiMsgId)
            if (existing) {
              return previous.map((message) => message.id === aiMsgId
                ? { ...message, content: accumulated, responseStatus: undefined, memoryRefs }
                : message)
            }
            return [...previous, { id: aiMsgId, role: 'assistant', content: accumulated, timestamp: Date.now(), memoryRefs }]
          })
        },
        controller.signal,
        (requestId) => {
          generation.requestId = requestId
          requestSessionRef.current.set(requestId, sessionId)
        }
      )
    } catch (error) {
      finishGeneration()
      if (activeSessionIdRef.current === sessionId) onPetStateChange('idle')
      if (error instanceof Error && error.name === 'AbortError') return
      const message = error instanceof Error ? error.message : '未知错误'
      const errorMessage: Message = {
        id: aiMsgId,
        role: 'assistant',
        content: `请求失败：${message}`,
        timestamp: Date.now(),
        responseStatus: 'error'
      }
      updateSessionMessages(sessionId, (previous) => {
        const existing = previous.find((item) => item.id === aiMsgId)
        return existing
          ? previous.map((item) => item.id === aiMsgId ? errorMessage : item)
          : [...previous, errorMessage]
      })
    }
  }, [config, finishPetResponse, onPetStateChange, persistSessionMessages, setSessionStreaming, updateSessionMessages])

  const handleStopGeneration = useCallback(() => {
    const sessionId = activeSessionIdRef.current
    const generation = sessionGenerationsRef.current.get(sessionId)
    if (!generation) return
    pendingGenerationsRef.current.delete(sessionId)
    const responseId = generation.responseId
    stopSessionResponse(sessionId)
    const nextMessages = updateSessionMessages(sessionId, (previous) => {
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
    persistSessionMessages(sessionId, nextMessages)
  }, [persistSessionMessages, stopSessionResponse, updateSessionMessages])

  const retryAssistantMessage = useCallback((messageId: string) => {
    if (isStreaming) return
    const conversation = getConversationForRetry(messages, messageId)
    if (!conversation) return
    const sessionId = activeSessionIdRef.current
    updateSessionMessages(sessionId, () => conversation)
    void generateAIResponse(conversation, sessionId)
  }, [messages, isStreaming, generateAIResponse, updateSessionMessages])

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
        content: '可用指令：\n- `/new` 新建对话\n- `/clear` 清空当前对话\n- `/remember 内容` 创建记忆候选\n- `/settings` 打开设置\n- `/model` 切换模型\n- `/help` 查看帮助',
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
    if (content === '/settings') {
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
    if (config.memoryEnabled && content.trim()) {
      showMemoryWriteNotice('正在分析这条消息是否需要记住…')
      void window.electronAPI.memory.propose(content, sessionId, userMessage.id).then((candidates) => {
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
      }).catch(() => showMemoryWriteNotice('记忆分析失败，可稍后重试'))
    }
    await generateAIResponse(nextMessages, sessionId)
  }

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
    setShowSettings(true)
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
    setMemoryCorrectionId(memoryId)
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
      style={{
        left: position.x,
        top: position.y,
        width: showSettings ? undefined : Math.min(chatContentWidth + (showSessions ? sessionSidebarWidth : 0), window.innerWidth - 16),
        height: !showSettings ? panelHeight : undefined,
        display: visible ? undefined : 'none'
      }}
    >
      {showSessions && !showSettings && (
        <ConversationSidebar
          sessions={sessions}
          activeSessionId={activeSessionId}
          width={sessionSidebarWidth}
          streamingSessionIds={streamingSessionIds}
          dragHandleProps={{
            onPointerDown: handleDragStart,
            onPointerMove: handleDragMove,
            onPointerUp: handleDragEnd,
            onPointerCancel: handleDragEnd
          }}
          onCreate={createSession}
          onSelect={selectSession}
          onRename={renameSession}
          onDelete={deleteSession}
          onExport={exportSession}
        />
      )}
      {!showSettings && (
        <div
          className="chat-content-resize-edge"
          style={{ left: (showSessions ? sessionSidebarWidth : 0) + chatContentWidth - 4 }}
          data-interactive
          role="separator"
          aria-label="调整聊天内容区宽度"
          aria-orientation="vertical"
          onPointerDown={handleContentResizeStart}
          onPointerMove={handleContentResizeMove}
          onPointerUp={handleContentResizeEnd}
          onPointerCancel={handleContentResizeEnd}
        />
      )}
      {showSessions && !showSettings && (
        <div
          className="session-sidebar-resize-edge"
          style={{ left: sessionSidebarWidth - 4 }}
          data-interactive
          role="separator"
          aria-label="调整会话列表宽度"
          aria-orientation="vertical"
          onPointerDown={handleSidebarResizeStart}
          onPointerMove={handleSidebarResizeMove}
          onPointerUp={handleSidebarResizeEnd}
          onPointerCancel={handleSidebarResizeEnd}
        />
      )}

      <div className="chat-panel-main">
        {showSettings ? (
          <Settings
            onClose={() => { setShowSettings(false); setShowOnboarding(!isAIConfigured(config)); setMemoryCorrectionId(''); void refreshPlugins(); onSettingsClose?.() }}
            initialNav={memoryCorrectionId ? 'memory' : undefined}
            focusMemoryId={memoryCorrectionId || undefined}
            petVisible={petVisible}
            onPetVisibleChange={onPetVisibleChange}
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
                onToggleSessions={toggleSessionSidebar}
                onSettings={() => {
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

            {showOnboarding && <OnboardingCard onConfigure={openAISettings} />}
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
                  <button type="button" autoFocus onClick={() => { setConfirmClear(false); requestComposerFocus() }}>取消</button>
                  <button type="button" className="danger" onClick={() => { void clearCurrentSession() }}>确认清空</button>
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
              onSend={handleSend}
              onStop={handleStopGeneration}
              disabled={!workspaceLoaded}
              isStreaming={isStreaming}
              focusRequest={composerFocusRequest}
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
      {!showSettings && (['top', 'bottom'] as const).map((edge) => (
        <div
          key={edge}
          className={`panel-resize-edge panel-resize-edge-${edge}`}
          data-interactive
          role="separator"
          aria-label={`从${edge === 'top' ? '顶部' : '底部'}调整聊天面板高度`}
          aria-orientation="horizontal"
          onPointerDown={(event) => handlePanelResizeStart(edge, event)}
          onPointerMove={handlePanelResizeMove}
          onPointerUp={handlePanelResizeEnd}
          onPointerCancel={handlePanelResizeEnd}
        />
      ))}
      {toolApprovalRequest && (
        <ToolApprovalDialog request={toolApprovalRequest} onResolve={resolveToolApproval} />
      )}
    </div>
  )
}
