import { useState, useRef, useEffect, useCallback } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { ToolApprovalRequest } from '../../../../shared/tools'
import { formatMemoryContext } from '../../../../shared/memory'
import {
  Message,
  PetState,
  AppConfig,
  ChatSessionSummary,
  SessionWorkspace
} from '../../shared/types'
import { streamChat } from '../../core/ai-engine'
import { buildSystemPrompt, buildMessages } from '../../core/prompt-builder'
import { loadSessionWorkspace, saveActiveSessionMessages } from '../../core/memory'
import { getContinuationSeed, getConversationForRetry, getEditedConversation, STOPPED_PLACEHOLDER_CONTENT } from '../../core/conversation-actions'
import { mergeSessionsInCurrentOrder } from '../../core/session-order'

export interface SessionGeneration {
  controller: AbortController
  responseId: string
  toolBoundary: boolean
  requestId?: string
  /** Renders buffered stream chunks immediately; used before boundaries/stop. */
  flushRender?: () => void
}

interface GenerationAppend {
  messageId: string
  seedContent: string
}

interface GenerationOptions {
  /** 追加模式：流式内容拼接到既有消息（停止后继续生成）。 */
  appendTo?: GenerationAppend
}

/**
 * Stream chunks arrive far faster than React should re-render the message
 * list. Chunks are buffered per generation and flushed at this cadence; the
 * final flush happens synchronously on done/error/stop so nothing is lost.
 */
export const STREAM_RENDER_INTERVAL_MS = 80

interface UseSessionWorkspaceParams {
  config: AppConfig
  onPetStateChange: (state: PetState) => void
  onConfigLoaded: (config: AppConfig) => void
  showMemoryWriteNotice: (message: string) => void
  setToolApprovalRequests: Dispatch<SetStateAction<ToolApprovalRequest[]>>
  clearMemoryCandidates: () => void
  requestComposerFocus: () => void
}

/**
 * Owns the multi-session chat workspace: session list, per-session message
 * caches, streaming generations, and persistence. ChatPanel consumes the
 * returned handlers; streaming/tool-event subscriptions can reach the refs
 * exposed here to stay consistent with in-flight generations.
 */
export function useSessionWorkspace({
  config,
  onPetStateChange,
  onConfigLoaded,
  showMemoryWriteNotice,
  setToolApprovalRequests,
  clearMemoryCandidates,
  requestComposerFocus
}: UseSessionWorkspaceParams) {
  const [messages, setMessages] = useState<Message[]>([])
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([])
  const [activeSessionId, setActiveSessionId] = useState('')
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false)
  const [workspaceError, setWorkspaceError] = useState('')
  const [loadRevision, setLoadRevision] = useState(0)
  const [streamingSessionIds, setStreamingSessionIds] = useState<Set<string>>(() => new Set())
  const sessionGenerationsRef = useRef<Map<string, SessionGeneration>>(new Map())
  const pendingGenerationsRef = useRef<Set<string>>(new Set())
  const requestSessionRef = useRef<Map<string, string>>(new Map())
  const sessionMessagesRef = useRef<Map<string, Message[]>>(new Map())
  const happyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const initializedRef = useRef(false)
  const latestMessagesRef = useRef<Message[]>([])
  const activeSessionIdRef = useRef('')
  const isStreaming = activeSessionId ? streamingSessionIds.has(activeSessionId) : false

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
    clearMemoryCandidates()
  }, [clearMemoryCandidates])

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
  }, [onPetStateChange, setSessionStreaming, setToolApprovalRequests])

  const persistCurrentSession = useCallback(async (preserveSessionOrder = false) => {
    const id = activeSessionIdRef.current
    if (!id || !initializedRef.current) return
    const workspace = await saveActiveSessionMessages(id, latestMessagesRef.current)
    setSessions((previous) => preserveSessionOrder ? mergeSessionsInCurrentOrder(previous, workspace.sessions) : workspace.sessions)
  }, [])

  useEffect(() => {
    let active = true
    setWorkspaceError('')
    Promise.all([
      loadSessionWorkspace(),
      window.electronAPI.db.getConfig()
    ]).then(([workspace, loadedConfig]) => {
      if (!active) return
      applyWorkspace(workspace)
      onConfigLoaded(loadedConfig)
      initializedRef.current = true
      setWorkspaceLoaded(true)
    }).catch(() => { if (active) setWorkspaceError('会话加载失败，请重试。') })
    return () => { active = false }
  }, [applyWorkspace, onConfigLoaded, loadRevision])

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
    if (!activeSessionIdRef.current) return
    const workspace = await window.electronAPI.db.saveSessionMessages(activeSessionIdRef.current, [])
    setSessions((previous) => mergeSessionsInCurrentOrder(previous, workspace.sessions))
    requestComposerFocus()
  }, [requestComposerFocus, stopSessionResponse, updateSessionMessages])

  const generateAIResponse = useCallback(async (conversation: Message[], sessionId = activeSessionIdRef.current, options: GenerationOptions = {}) => {
    if (!sessionId) return
    if (sessionGenerationsRef.current.has(sessionId)) {
      // Start another response as soon as the current one completes. Read the
      // session's latest messages at that point so the completed answer is in
      // the next request's context.
      // Note: options are not queued — append-mode callers must be guarded by isStreaming.
      pendingGenerationsRef.current.add(sessionId)
      return
    }
    const responseBaseId = options.appendTo?.messageId ?? `${Date.now()}-assistant`
    let segmentIndex = 0
    let aiMsgId = responseBaseId
    let accumulated = options.appendTo?.seedContent ?? ''
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
      } catch (error) {
        relevantMemories = []
        showMemoryWriteNotice(error instanceof Error ? `Mem0 记忆检索失败：${error.message}` : 'Mem0 记忆检索失败，请检查连接配置')
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
    const continuationPolicy = options.appendTo
      ? '上一条回复被中断了。请从中断处自然地继续写完剩余内容，不要重复已写部分，不要重新开头。'
      : ''
    const systemPrompt = buildSystemPrompt(config.soulMd, [memoryContext, memoryConversationPolicy, continuationPolicy].filter(Boolean).join('\n\n'))
    const history = buildMessages(conversation)

    // Buffer rendered content and flush on a cadence instead of re-rendering
    // the whole message list per chunk (see STREAM_RENDER_INTERVAL_MS).
    let renderTimer: ReturnType<typeof setTimeout> | null = null
    const renderAccumulated = () => {
      if (renderTimer) {
        clearTimeout(renderTimer)
        renderTimer = null
      }
      if (controller.signal.aborted) return
      const targetMessageId = aiMsgId
      const content = accumulated
      updateSessionMessages(sessionId, (previous) => {
        const existing = previous.find((message) => message.id === targetMessageId)
        if (existing) {
          // 续写针对同一条用户消息重新检索记忆，保留原引用（含用户反馈标记）而不是整组替换。
          return previous.map((message) => message.id === targetMessageId
            ? { ...message, content, responseStatus: undefined, memoryRefs: options.appendTo ? message.memoryRefs : memoryRefs }
            : message)
        }
        return [...previous, { id: targetMessageId, role: 'assistant', content, timestamp: Date.now(), memoryRefs }]
      })
    }
    const scheduleRender = () => {
      if (renderTimer) return
      renderTimer = setTimeout(() => {
        renderTimer = null
        renderAccumulated()
      }, STREAM_RENDER_INTERVAL_MS)
    }
    generation.flushRender = renderAccumulated

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
            renderAccumulated()
            finishGeneration()
            if (activeSessionIdRef.current === sessionId) finishPetResponse()
            return
          }
          if (chunk && generation.toolBoundary) {
            renderAccumulated()
            segmentIndex += 1
            // 追加模式的分段 id 在既有消息 id 后扩展；安全前提是被续写消息只可能处于 stopped（首次续写渲染即清除）。
            aiMsgId = `${responseBaseId}-${segmentIndex}`
            accumulated = ''
            generation.responseId = aiMsgId
            generation.toolBoundary = false
          }
          accumulated += chunk
          if (activeSessionIdRef.current === sessionId) onPetStateChange('talking')
          scheduleRender()
        },
        controller.signal,
        (requestId) => {
          generation.requestId = requestId
          requestSessionRef.current.set(requestId, sessionId)
        }
      )
    } catch (error) {
      renderAccumulated()
      finishGeneration()
      if (activeSessionIdRef.current === sessionId) onPetStateChange('idle')
      if (error instanceof Error && error.name === 'AbortError') return
      const message = error instanceof Error ? error.message : '未知错误'
      const errorMessage: Message = {
        id: aiMsgId,
        role: 'assistant',
        content: options.appendTo ? (accumulated || STOPPED_PLACEHOLDER_CONTENT) : `请求失败：${message}`,
        timestamp: Date.now(),
        // 失败的续写保持可继续状态：'stopped' 让「继续生成」按钮仍然可用，
        // 而不是退化成会丢弃半截内容的整体重试。
        responseStatus: options.appendTo ? 'stopped' : 'error'
      }
      if (options.appendTo) showMemoryWriteNotice(`继续生成失败：${message}`)
      updateSessionMessages(sessionId, (previous) => {
        const existing = previous.find((item) => item.id === aiMsgId)
        if (!existing) return [...previous, errorMessage]
        return previous.map((item) => item.id === aiMsgId
          ? (options.appendTo
            ? { ...item, content: errorMessage.content, responseStatus: errorMessage.responseStatus }
            : errorMessage)
          : item)
      })
    }
  }, [config, finishPetResponse, onPetStateChange, persistSessionMessages, setSessionStreaming, showMemoryWriteNotice, updateSessionMessages])

  const handleStopGeneration = useCallback(() => {
    const sessionId = activeSessionIdRef.current
    const generation = sessionGenerationsRef.current.get(sessionId)
    if (!generation) return
    pendingGenerationsRef.current.delete(sessionId)
    generation.flushRender?.()
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
        content: STOPPED_PLACEHOLDER_CONTENT,
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

  const editUserMessage = useCallback((messageId: string, newContent: string) => {
    if (isStreaming) return
    const conversation = getEditedConversation(messages, messageId, newContent)
    if (!conversation) return
    const sessionId = activeSessionIdRef.current
    updateSessionMessages(sessionId, () => conversation)
    void generateAIResponse(conversation, sessionId)
  }, [messages, isStreaming, generateAIResponse, updateSessionMessages])

  const continueAssistantMessage = useCallback((messageId: string) => {
    if (isStreaming) return
    const seedContent = getContinuationSeed(messages, messageId)
    if (seedContent === null) return
    void generateAIResponse(messages, activeSessionIdRef.current, { appendTo: { messageId, seedContent } })
  }, [messages, isStreaming, generateAIResponse])

  return {
    messages,
    sessions,
    activeSessionId,
    workspaceLoaded,
    workspaceError,
    retryWorkspace: () => setLoadRevision(value => value + 1),
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
  }
}
