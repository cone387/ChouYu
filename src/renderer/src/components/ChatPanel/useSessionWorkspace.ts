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
import { getConversationForRetry } from '../../core/conversation-actions'
import { mergeSessionsInCurrentOrder } from '../../core/session-order'

export interface SessionGeneration {
  controller: AbortController
  responseId: string
  toolBoundary: boolean
  requestId?: string
}

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
    Promise.all([
      loadSessionWorkspace(),
      window.electronAPI.db.getConfig()
    ]).then(([workspace, loadedConfig]) => {
      applyWorkspace(workspace)
      onConfigLoaded(loadedConfig)
      initializedRef.current = true
      setWorkspaceLoaded(true)
    })
  }, [applyWorkspace, onConfigLoaded])

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
  }, [config, finishPetResponse, onPetStateChange, persistSessionMessages, setSessionStreaming, showMemoryWriteNotice, updateSessionMessages])

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

  return {
    messages,
    sessions,
    activeSessionId,
    workspaceLoaded,
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
    retryAssistantMessage
  }
}
