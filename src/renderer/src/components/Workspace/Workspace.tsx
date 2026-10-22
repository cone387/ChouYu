import { useChatCommands } from '../ChatPanel/useChatCommands'
import { useWorkspaceOverlays } from './useWorkspaceOverlays'
import { useWorkspaceNavigation } from './useWorkspaceNavigation'
import ChatPanel from '../ChatPanel/ChatPanel'
import type { AgentFocusRequest } from '../../../../shared/agents'
import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import GlobalSearch, { type SearchSnapshot } from './GlobalSearch'
import Journal from '../Journal/Journal'
import TasksView from '../Tasks/TasksView'
import type { TaskConversionDraft } from '../Tasks/taskNavigation'
import WorkspaceNav, { type WorkspacePage } from './WorkspaceNav'
import WorkspaceHeader from './WorkspaceHeader'
import { useWorkspacePresentation } from './useWorkspacePresentation'
import { getWorkspaceGeometry, type WorkspaceMode } from '../../core/workspace-state'
import ContactWorkToolbar from '../ChatPanel/ContactWorkToolbar'

import type { AgentDiscussion } from '../Contacts/agentDiscussion'
import Settings from '../Settings/Settings'
import ConversationSidebar from '../ConversationSidebar/ConversationSidebar'
import ContactsView from '../Contacts/ContactsView'
import ToolApprovalDialog from '../ToolApproval/ToolApprovalDialog'
import MemorySettingsTab from '../Settings/MemorySettingsTab'
import type { ToolApprovalRequest, ToolExecutionEvent } from '../../../../shared/tools'
import type { MemoryConflictAction, MemoryFeedbackValue, MemoryRecord } from '../../../../shared/memory'
import { isAIConfigured } from '../../../../shared/config'

import { PetState, AppConfig, PluginInfo, SessionWorkspace } from '../../shared/types'
import { DEFAULT_CONFIG } from '../../shared/constants'
import { parseStoredSidebarVisibility, SESSION_SIDEBAR_STATE_KEY } from '../../core/panel-state'
import { usePanelResize } from '../ChatPanel/usePanelResize'
import { activatePanel } from '../../core/panel-layer'
import { useSessionWorkspace } from '../ChatPanel/useSessionWorkspace'
import '../ChatPanel/ChatPanel.css'

export interface WorkspaceProps {
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
  workspaceRequest?: { page: WorkspacePage; id: number; taskId?: string; taskDraft?: TaskConversionDraft }
  onSettingsClose?: () => void
  onScreenshot?: (hidePanel: boolean, callback: (dataUrl: string) => void) => void
  onScrollScreenshot?: (callback: (dataUrl: string) => void) => void
  initialPluginId?: string | null
  onPluginIdConsumed?: () => void
  pendingAttachment?: { type: 'image' | 'text'; data: string; name: string } | null
  onPendingAttachmentConsumed?: () => void
  pendingMessage?: string | null
  onPendingMessageConsumed?: () => void
  assistantFocusRequest?: number
}

export default function Workspace({ visible, position, onPositionChange, petState, onPetStateChange, onHide, onClose, petVisible, onPetVisibleChange, initialShowSettings, workspaceRequest, onSettingsClose, onScreenshot, onScrollScreenshot, initialPluginId, onPluginIdConsumed, pendingAttachment, onPendingAttachmentConsumed, pendingMessage, onPendingMessageConsumed, assistantFocusRequest }: WorkspaceProps) {
  const [agentFocus, setAgentFocus] = useState<(AgentFocusRequest & { sessionId: string }) | null>(null)
  const [agentDiscussion, setAgentDiscussion] = useState<(AgentDiscussion & { sessionId: string }) | null>(null)
  const [taskFocusId, setTaskFocusId] = useState<string | undefined>()
  const [taskOpenRequest, setTaskOpenRequest] = useState<{ id: number; taskId: string }>()
  const [taskConversionRequest, setTaskConversionRequest] = useState<{ id: number; draft: TaskConversionDraft }>()
  const [showMessageSearch, setShowMessageSearch] = useState(false)
  const searchSnapshot = useRef<SearchSnapshot | null>(null)
  const [taskSearchRequest, setTaskSearchRequest] = useState<{ id: string; done: boolean; query: string; nonce: number }>()
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

  const [contactsFocusId, setContactsFocusId] = useState<string | null>(null)
  const [showContactDetail, setShowContactDetail] = useState(false)
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
    replyViewportRef,
    sessions,
    activeSessionId,
    characters,
    activeCharacterId,
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
    applyWorkspace,
    updateSessionMessages,
    stopSessionResponse,
    generateAIResponse,
    createSession: createStoredSession,
    selectSession: selectStoredSession,
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
  const { activePage, visitedPages, pageLoaded, navigate, linkedTask, setLinkedTask, parkedTasks,
    returnToken, restoreContactOrigin, navigationError, setNavigationError, messageFocus, setMessageFocus,
    openCharacterChat, focusAssistant, selectSession, createSession } = useWorkspaceNavigation({
    initialShowSettings, onSettingsClose, sessions, activeSessionId, activeCharacterId, selectStoredSession, createStoredSession,
    setAgentDiscussion, setShowMessageSearch
  })
  const showSettings = activePage === 'settings'
  const showMemoryWorkspace = activePage === 'memory'
  const isChat = activePage === 'chat'
  const presentation = useWorkspacePresentation()
  const displayMode = isChat ? presentation.mode : 'workspace'
  const maximized = presentation.maximized
  useEffect(() => { if (activePage !== 'memory') setMemoryCorrectionId('') }, [activePage])
  const inputHistory = useMemo(
    () => messages.filter((message) => message.role === 'user' && !message.toolData && message.content.trim()).map((message) => message.content),
    [messages]
  )
  const activeCharacter = characters.find((character) => character.id === activeCharacterId) ?? null
  // 自定义角色自带 Provider 配置（主进程 resolveCharacterConfig 解析），
  // 全局 AI 配置为空时也允许对话；内置角色仍依赖设置页的全局配置。
  const customCharacterActive = Boolean(activeCharacter && !activeCharacter.builtIn)
  // 工作区首次加载按最近更新时间排列，后续更新保留卡片位置。
  // 不要在显示层重新排序：自动保存也会修改 updatedAt。
  const openMemoryWorkspace = useCallback((focusId = '') => {
    setMemoryCorrectionId(focusId)
    navigate('memory')
  }, [navigate])

  const { handleSend, handleEditMessage, handleModelChange } = useChatCommands({ config, setConfig, setShowOnboarding, setConfirmClear, setMemoryCandidates, showMemoryWriteNotice, activeSessionIdRef, happyTimerRef, plugins, updateSessionMessages, generateAIResponse, createSession, activeCharacterId, navigate, openMemoryWorkspace, customCharacterActive, sessionMessagesRef, messages, isStreaming, editUserMessage, activeCharacter })
  const visibleSessions = sessions
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
    onPositionChange
  })
  const toolApprovalRequest = toolApprovalRequests[0] || null
  const geometry = getWorkspaceGeometry(displayMode, maximized, viewport, chatContentWidth, sessionSidebarWidth, panelHeight)
  const shellWidth = geometry.width
  const narrowLayout = geometry.narrow
  const sessionsVisible = displayMode !== 'chat' && (narrowLayout ? narrowSessionsOpen : displayMode === 'sessions' || showSessions)
  const panelReady = pageLoaded && presentation.loaded && dimensionsLoaded && sidebarLoaded && (workspaceLoaded || Boolean(workspaceError) || showSettings)
  const persistSessionsVisible = useCallback((visible: boolean) => {
    void window.electronAPI.db.setState(SESSION_SIDEBAR_STATE_KEY, String(visible)).catch(() => { /* The persistent storage notice reports disk failures. */ })
  }, [])
  const changeDisplayMode = (mode: WorkspaceMode) => {
    presentation.changeMode(mode)
    if (mode !== 'chat') { setShowSessions(true); persistSessionsVisible(true) }
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
      if (['completed', 'denied', 'expired', 'cancelled', 'error'].includes(event.status)) {
        setToolApprovalRequests((current) => current.filter((request) => request.callId !== event.callId))
      }
      const sessionId = requestSessionRef.current.get(event.requestId)
      // Unknown/finished requests have no authority to append to whichever chat is open.
      if (!sessionId) return
      const generation = sessionGenerationsRef.current.get(sessionId)
      if (generation && ['completed', 'denied', 'expired', 'cancelled', 'error'].includes(event.status)) generation.toolBoundary = true
      updateSessionMessages(sessionId, (previous) => {
        const id = `tool-${event.callId}`
        const toolData = {
          callId: event.callId,
          name: event.name,
          displayName: event.displayName,
          risk: event.risk,
          status: event.status,
          summary: event.summary, taskId: event.taskId, taskRefs: event.taskRefs
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
    if (workspaceRequest) {
      navigate(workspaceRequest.page); setTaskFocusId(workspaceRequest.taskId); setTaskSearchRequest(undefined)
      setTaskOpenRequest(workspaceRequest.taskId ? { id: workspaceRequest.id, taskId: workspaceRequest.taskId } : undefined)
      setTaskConversionRequest(workspaceRequest.taskDraft ? { id: workspaceRequest.id, draft: workspaceRequest.taskDraft } : undefined)
    }
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
      persistSessionsVisible(next)
      if (!next) setTimeout(requestComposerFocus, 0)
      return next
    })
  }, [requestComposerFocus, narrowLayout, displayMode, presentation.changeMode, persistSessionsVisible])

  useWorkspaceOverlays({ visible, toolApprovalRequest, config, isChat, showMessageSearch,
    confirmClear, onClose, requestComposerFocus, setShowGlobalSearch, setShowMessageSearch, setConfirmClear })

  const pluginCommands = plugins.map((plugin) => ({ cmd: '/' + plugin.command, desc: plugin.description }))

  const getStatusText = () => {
    if (isStreaming) return '正在回复...'
    if (petState === 'thinking') return '正在思考...'
    if (petState === 'talking') return '正在回复...'
    return '在线'
  }

  const openAISettings = useCallback(() => {
    setShowOnboarding(false)
    navigate('settings')
  }, [navigate])

  const clearContactsFocus = useCallback(() => setContactsFocusId(null), [])
  const closeContactDetail = useCallback(() => setShowContactDetail(false), [])

  useEffect(() => {
    if (!visible || !isChat) setShowContactDetail(false)
  }, [visible, isChat])

  const openContactsDetail = useCallback((characterId: string) => {
    setContactsFocusId(characterId)
    setShowContactDetail(true)
  }, [])

  // 主进程在别的入口追加了助手消息（或会话结构变化）：重拉工作区，保留侧栏顺序。
  useEffect(() => window.electronAPI.onSessionsChanged((reminderOnly) => {
    void window.electronAPI.db.getSessionWorkspace()
      .then((workspace) => applyWorkspace(workspace, true, reminderOnly === true))
      .catch(() => { /* 保留现有工作区，下次事件重试 */ })
  }), [applyWorkspace])

  // 托盘/宠物入口请求聚焦助手会话：只消费递增的那一次，不随 sessions 变化重放。
  const handledAssistantFocusRef = useRef(0)
  useEffect(() => {
    if (!workspaceLoaded) return
    if (!assistantFocusRequest || assistantFocusRequest === handledAssistantFocusRef.current) return
    handledAssistantFocusRef.current = assistantFocusRequest
    void focusAssistant().catch(() => {})
  }, [workspaceLoaded, assistantFocusRequest, focusAssistant])

  // 仅在获得焦点且读到最新内容时，按渲染层已展示的消息边界标读。
  const activeAssistantUnread = sessions.find((session) => session.id === activeSessionId)?.unreadCount ?? 0
  useEffect(() => { setAgentFocus(null) }, [activeSessionId, isChat])
  useEffect(() => { setAgentDiscussion(previous => previous?.sessionId === activeSessionId ? previous : null) }, [activeSessionId])
  const markVisibleMessagesRead = useCallback(() => {
    if (!visible || !isChat || !workspaceLoaded || !activeAssistantUnread) return
    void window.electronAPI.db.markSessionRead(activeSessionId, messages[messages.length - 1]?.id)
      .then(workspace => applyWorkspace(workspace, true, true)).catch(() => {})
  }, [visible, isChat, workspaceLoaded, activeAssistantUnread, activeSessionId, applyWorkspace, messages])

  // 删除角色会连带删除其会话：先停掉这些会话的在途生成（对齐 deleteSession 的先例），
  // 再按保留侧栏顺序的方式应用新工作区。
  const handleCharactersDeleted = useCallback((workspace: SessionWorkspace) => {
    sessions.filter((session) => !workspace.sessions.some((item) => item.id === session.id))
      .forEach((session) => {
        try { stopSessionResponse(session.id) } catch { /* 中止尽力而为，删除流程继续。 */ }
      })
    applyWorkspace(workspace, true)
  }, [sessions, stopSessionResponse, applyWorkspace])

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
    <div ref={panelRef} data-interactive data-ready={panelReady} data-panel-window="main" onPointerDownCapture={event => activatePanel(event.target)}
      className="chat-panel app-workspace"
      data-window-mode={displayMode} data-maximized={maximized}
      data-workspace-page={activePage}
      style={{ left: maximized ? 0 : position.x, top: maximized ? 0 : position.y, width: shellWidth, height: geometry.height, display: visible && panelReady ? undefined : 'none' }}>
      {displayMode === 'workspace' && <WorkspaceNav activePage={activePage} onNavigate={navigate} status={getStatusText()} unreadCount={sessions.reduce((total, session) => total + (session.unreadCount ?? 0), 0)} />}
      <WorkspaceHeader onHide={onHide} onClose={onClose} dragHandleProps={dragHandleProps}
        searchHotkey={config.searchHotkey}
        onSearch={() => setShowGlobalSearch(true)}
        sessionsVisible={sessionsVisible} onToggleSessions={isChat ? toggleSessionSidebar : undefined}
        maximized={maximized} onMaximize={presentation.toggleMaximized} mode={displayMode} onModeChange={changeDisplayMode} />
      <div className="workspace-body">
        <div className="workspace-page workspace-chat" hidden={!isChat}>
          {sessionsVisible && narrowLayout && <button className="workspace-sessions-backdrop" aria-label="收起会话列表" onClick={toggleSessionSidebar} />}
          <div className="workspace-sessions" hidden={!sessionsVisible} style={{ width: sessionSidebarWidth }}>
            <ConversationSidebar
              sessions={visibleSessions} activeSessionId={activeSessionId} width={sessionSidebarWidth}
              characters={characters}
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
          <ChatPanel model={{
            activeCharacter, showOnboarding, customCharacterActive, openContactsDetail, config,
            openAISettings, workspaceError, retryWorkspace, workspaceLoaded, messageFocus,
            activeSessionId, setMessageFocus, setAgentFocus, visible, isChat,
            toolApprovalRequest, confirmClear, showMessageSearch, messageSearchQuery, setShowMessageSearch,
            requestComposerFocus, messages, isStreaming, retryAssistantMessage, handleEditMessage,
            continueAssistantMessage, submitMemoryFeedback, correctMemory, activeCharacterId, replyViewportRef,
            activeAssistantUnread, markVisibleMessagesRead, setConfirmClear, clearCurrentSession, memoryCandidates,
            memoryCandidateBusy, resolveMemoryCandidate, memoryCandidateError, memoryWriteNotice, agentFocus,
            setAgentDiscussion, agentDiscussion, handleSend, handleStopGeneration, composerFocusRequest,
            handleModelChange, onScreenshot, onScrollScreenshot, plugins, pluginCommands,
            activePluginForInput, setActivePluginForInput, pendingAttachment, onPendingAttachmentConsumed, inputHistory
          }} />
          {showContactDetail && visible && isChat && <ContactsView active config={config} detailOnly
            focusCharacterId={contactsFocusId} onFocusConsumed={clearContactsFocus} onDismiss={closeContactDetail}
            onOpenChat={(characterId) => { void openCharacterChat(characterId) }}
            onDeleted={handleCharactersDeleted} />}
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
        <section className="workspace-page workspace-contacts" hidden={activePage !== 'contacts'} aria-label="通讯录工作区">
          {visitedPages.contacts && <ContactsView active={visible && activePage === 'contacts'} config={config} focusCharacterId={contactsFocusId} onFocusConsumed={clearContactsFocus}
            onOpenChat={(characterId) => { void openCharacterChat(characterId) }}
            onDeleted={handleCharactersDeleted} />}
        </section>
        <section className="workspace-page workspace-journal" hidden={activePage !== 'journal'} aria-label="活动工作区">
          {visitedPages.journal && <>
            <Journal active={visible && activePage === 'journal'} searchRequest={journalSearch} />
          </>}
        </section>
        <section className="workspace-page workspace-tasks" hidden={activePage !== 'tasks'} aria-label="任务工作区">
          {visitedPages.tasks && <>
            <TasksView active={visible && activePage === 'tasks'} focusTaskId={taskFocusId} searchRequest={taskSearchRequest} taskOpenRequest={taskOpenRequest} conversionRequest={taskConversionRequest} onRequestConsumed={() => { setTaskOpenRequest(undefined); setTaskConversionRequest(undefined) }} onOpenChat={async id => { await selectSession(id); navigate('chat') }} />
          </>}
        </section>
        <section className="workspace-page workspace-settings" hidden={!showSettings} aria-label="设置工作区">
          {visitedPages.settings && <>
            {returnToken && <button type="button" data-contact-return onClick={() => void restoreContactOrigin()}>返回原联系人事项</button>}
            <Settings active={visible && showSettings} onClose={() => returnToken ? void restoreContactOrigin() : navigate('chat')} petVisible={petVisible} onPetVisibleChange={onPetVisibleChange}
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
      {visible && panelReady && toolApprovalRequest && <ToolApprovalDialog request={toolApprovalRequest} onResolve={resolveToolApproval} />}
      {navigationError && <div className="memory-candidate-error" role="alert">{navigationError}<button type="button" onClick={() => setNavigationError('')}>关闭</button></div>}
      {[...parkedTasks.map(item => ({ task: item.task, parked: true })), ...(linkedTask ? [{ task: linkedTask, parked: false }] : [])].map(({ task, parked }) => <ContactWorkToolbar key={`${task.characterId}:${task.focus?.nonce ?? task.nonce}`} standalone suspended={parked || !visible} characterId={task.characterId} name={task.name} initialTab={task.initialTab ?? 'work'} focusRequest={task.focus} deliveryFocus={task.deliveryFocus} onReturn={!parked && returnToken ? () => void restoreContactOrigin() : undefined} onClose={() => { if (!parked) { if (returnToken) void restoreContactOrigin(); else setLinkedTask(null) } }} onChat={() => { void openCharacterChat(task.characterId).catch(error => setNavigationError(error.message)) }} />)}
      {showGlobalSearch && visible && <GlobalSearch searchHotkey={config.searchHotkey} onContact={id => { setContactsFocusId(id); navigate('contacts') }} onTask={(id, done, query) => { setTaskFocusId(id); setTaskSearchRequest({ id, done, query, nonce: Date.now() }); navigate('tasks') }} snapshot={searchSnapshot} onClose={() => setShowGlobalSearch(false)}
        onSession={async (id, query) => { await selectSession(id); navigate('chat'); setNarrowSessionsOpen(false); setMessageSearchQuery(query); setShowMessageSearch(true) }}
        onMemory={openMemoryWorkspace}
        onJournal={(date, query, sourceId) => { setJournalSearch({ date, query, sourceId, id: Date.now() }); navigate('journal') }} />}
    </div>
  )
}
