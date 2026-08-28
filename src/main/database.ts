import { app, safeStorage } from 'electron'
import { randomUUID } from 'crypto'
import path from 'path'
import fs from 'fs'
import { AppConfig, DEFAULT_APP_CONFIG, normalizeConfig } from '../shared/config'
import {
  DEFAULT_SESSION_TITLE,
  MAX_SESSION_MESSAGES,
  buildSessionPreview,
  deriveSessionTitle,
  normalizeSessionTitle
} from '../shared/sessions'
import type { ToolActivityData } from '../shared/tools'
import type { MemoryFeedbackValue } from '../shared/memory'

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  imageUrl?: string
  responseStatus?: 'error' | 'stopped'
  toolData?: ToolActivityData
  memoryRefs?: Array<{ id: string; content: string; type: string; feedback?: MemoryFeedbackValue }>
  pluginData?: unknown
}

export interface ChatSession {
  id: string
  title: string
  messages: Message[]
  createdAt: number
  updatedAt: number
}

export interface ChatSessionSummary {
  id: string
  title: string
  preview: string
  messageCount: number
  createdAt: number
  updatedAt: number
}

export interface SessionWorkspace {
  sessions: ChatSessionSummary[]
  activeSession: ChatSession
}

interface StoreData {
  version: number
  config: AppConfig
  sessions: ChatSession[]
  activeSessionId: string
  state: Record<string, string>
}

interface PersistedStoreData extends Partial<StoreData> {
  messages?: Message[]
}

const STORE_VERSION = 3
const MAX_SESSIONS = 100
const ENCRYPTED_PREFIX = 'safe:v1:'

let store: StoreData
let filePath: string
let persistTimer: ReturnType<typeof setTimeout> | null = null

function protect(value: string): string {
  if (!value || value.startsWith(ENCRYPTED_PREFIX)) return value
  if (!safeStorage.isEncryptionAvailable()) return value
  return ENCRYPTED_PREFIX + safeStorage.encryptString(value).toString('base64')
}

function unprotect(value: unknown): string {
  if (typeof value !== 'string') return ''
  if (!value.startsWith(ENCRYPTED_PREFIX)) return value
  try {
    return safeStorage.decryptString(Buffer.from(value.slice(ENCRYPTED_PREFIX.length), 'base64'))
  } catch {
    return ''
  }
}

function isSecretStateKey(key: string): boolean {
  const normalized = key.toLowerCase()
  return normalized.includes('token') || normalized.includes('password') || normalized.includes('api_key')
}

function sanitizeToolData(value: unknown): ToolActivityData | undefined {
  if (!value || typeof value !== 'object') return undefined
  const input = value as Partial<ToolActivityData>
  if (typeof input.callId !== 'string' || typeof input.name !== 'string' || typeof input.displayName !== 'string') return undefined
  if (!['safe', 'read', 'write'].includes(String(input.risk))) return undefined
  if (!['requested', 'running', 'completed', 'denied', 'error'].includes(String(input.status))) return undefined
  const status = input.status as ToolActivityData['status']
  const interrupted = status === 'requested' || status === 'running'
  return {
    callId: input.callId.slice(0, 128),
    name: input.name.slice(0, 64),
    displayName: input.displayName.slice(0, 100),
    risk: input.risk as ToolActivityData['risk'],
    status: interrupted ? 'error' : status,
    summary: interrupted
      ? '上次工具执行已中断'
      : typeof input.summary === 'string' ? input.summary.slice(0, 500) : undefined
  }
}

function sanitizeMemoryRefs(value: unknown): Message['memoryRefs'] {
  if (!Array.isArray(value)) return undefined
  return value.slice(0, 12).flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const ref = item as Record<string, unknown>
    if (typeof ref.id !== 'string' || typeof ref.content !== 'string' || typeof ref.type !== 'string') return []
    return [{
      id: ref.id.slice(0, 128),
      content: ref.content.slice(0, 500),
      type: ref.type.slice(0, 40),
      feedback: ref.feedback === 'helpful' || ref.feedback === 'unhelpful' ? ref.feedback : undefined
    }]
  })
}

function sanitizeMessages(value: unknown): Message[] {
  if (!Array.isArray(value)) return []
  return value
    .slice(-MAX_SESSION_MESSAGES)
    .filter((message): message is Message => Boolean(
      message && typeof message === 'object' && ['user', 'assistant', 'system'].includes(message.role)
    ))
    .map((message) => ({
      ...message,
      id: String(message.id || randomUUID()).slice(0, 128),
      content: String(message.content ?? '').slice(0, 200_000),
      timestamp: Number.isFinite(message.timestamp) ? message.timestamp : Date.now(),
      responseStatus: message.responseStatus === 'error' || message.responseStatus === 'stopped'
        ? message.responseStatus
        : undefined,
      toolData: sanitizeToolData(message.toolData),
      memoryRefs: sanitizeMemoryRefs(message.memoryRefs),
      // Screenshots can be several MB. Keep them in the active runtime session but
      // do not embed base64 image data in the durable JSON conversation store.
      imageUrl: typeof message.imageUrl === 'string' && !message.imageUrl.startsWith('data:')
        ? message.imageUrl.slice(0, 4096)
        : undefined
    }))
}

function createSession(messages: Message[] = [], title?: string, now = Date.now()): ChatSession {
  return {
    id: randomUUID(),
    title: title ? normalizeSessionTitle(title) : deriveSessionTitle(messages),
    messages: sanitizeMessages(messages),
    createdAt: now,
    updatedAt: now
  }
}

function normalizeSessions(value: unknown): ChatSession[] {
  if (!Array.isArray(value)) return []
  const ids = new Set<string>()
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const input = item as Partial<ChatSession>
      const id = typeof input.id === 'string' && input.id && !ids.has(input.id) ? input.id.slice(0, 128) : randomUUID()
      ids.add(id)
      const messages = sanitizeMessages(input.messages)
      const createdAt = Number.isFinite(input.createdAt) ? Number(input.createdAt) : Date.now()
      const updatedAt = Number.isFinite(input.updatedAt) ? Number(input.updatedAt) : createdAt
      return {
        id,
        title: normalizeSessionTitle(typeof input.title === 'string' ? input.title : deriveSessionTitle(messages)),
        messages,
        createdAt,
        updatedAt
      }
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_SESSIONS)
}

function cloneSession(session: ChatSession): ChatSession {
  return { ...session, messages: session.messages.map((message) => ({ ...message })) }
}

function toSummary(session: ChatSession): ChatSessionSummary {
  return {
    id: session.id,
    title: session.title,
    preview: buildSessionPreview(session.messages),
    messageCount: session.messages.length,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt
  }
}

function getActiveSessionInternal(): ChatSession {
  let session = store.sessions.find((candidate) => candidate.id === store.activeSessionId)
  if (!session) {
    session = store.sessions[0] || createSession()
    if (!store.sessions.some((candidate) => candidate.id === session!.id)) store.sessions.push(session)
    store.activeSessionId = session.id
  }
  return session
}

function load(): StoreData {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8')
      const data = JSON.parse(raw) as PersistedStoreData
      const persistedConfig: Partial<AppConfig> = data.config && typeof data.config === 'object' ? data.config : {}
      const persistedState = data.state && typeof data.state === 'object' ? data.state : {}
      let sessions = normalizeSessions(data.sessions)

      // Version 2 stored one global messages array. Preserve it as the first session.
      if (sessions.length === 0) {
        const legacyMessages = sanitizeMessages(data.messages)
        sessions = [createSession(legacyMessages, legacyMessages.length ? undefined : DEFAULT_SESSION_TITLE)]
      }

      const requestedActiveId = typeof data.activeSessionId === 'string' ? data.activeSessionId : ''
      const activeSessionId = sessions.some((session) => session.id === requestedActiveId)
        ? requestedActiveId
        : sessions[0].id

      return {
        version: STORE_VERSION,
        config: normalizeConfig({
          ...persistedConfig,
          apiKey: unprotect(persistedConfig.apiKey),
          embeddingApiKey: unprotect(persistedConfig.embeddingApiKey)
        }),
        sessions,
        activeSessionId,
        state: Object.fromEntries(
          Object.entries(persistedState).map(([key, value]) => [key, isSecretStateKey(key) ? unprotect(value) : value])
        )
      }
    }
  } catch (error) {
    console.error('Failed to load data:', error)
  }

  const session = createSession()
  return {
    version: STORE_VERSION,
    config: { ...DEFAULT_APP_CONFIG },
    sessions: [session],
    activeSessionId: session.id,
    state: {}
  }
}

function serializeStore(): StoreData {
  return {
    version: STORE_VERSION,
    config: {
      ...store.config,
      apiKey: protect(store.config.apiKey),
      embeddingApiKey: protect(store.config.embeddingApiKey)
    },
    sessions: store.sessions,
    activeSessionId: store.activeSessionId,
    state: Object.fromEntries(
      Object.entries(store.state).map(([key, value]) => [key, isSecretStateKey(key) ? protect(value) : value])
    )
  }
}

function persist(): void {
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  try {
    const dir = path.dirname(filePath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const tempPath = `${filePath}.tmp`
    fs.writeFileSync(tempPath, JSON.stringify(serializeStore(), null, 2), 'utf-8')
    fs.renameSync(tempPath, filePath)
  } catch (error) {
    console.error('Failed to persist data:', error)
  }
}

function schedulePersist(): void {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(persist, 500)
}

export function initDatabase(): void {
  filePath = path.join(app.getPath('userData'), 'chouyu-data.json')
  store = load()
  persist()
}

export function getConfig(): AppConfig {
  return { ...store.config }
}

export function saveConfig(patch: Partial<AppConfig>): void {
  store.config = normalizeConfig({ ...store.config, ...patch })
  persist()
}

export function getSessions(): ChatSessionSummary[] {
  return store.sessions
    .map(toSummary)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export function getActiveSession(): ChatSession {
  return cloneSession(getActiveSessionInternal())
}

export function getSession(id: string): ChatSession | null {
  const session = store.sessions.find((candidate) => candidate.id === id)
  return session ? cloneSession(session) : null
}

export function getSessionWorkspace(): SessionWorkspace {
  return { sessions: getSessions(), activeSession: getActiveSession() }
}

export function createChatSession(title?: string): SessionWorkspace {
  const session = createSession([], title)
  store.sessions.unshift(session)
  store.sessions = store.sessions.slice(0, MAX_SESSIONS)
  store.activeSessionId = session.id
  persist()
  return getSessionWorkspace()
}

export function selectChatSession(id: string): SessionWorkspace {
  if (!store.sessions.some((session) => session.id === id)) throw new Error('会话不存在或已被删除。')
  store.activeSessionId = id
  persist()
  return getSessionWorkspace()
}

export function renameChatSession(id: string, title: string): ChatSessionSummary[] {
  const session = store.sessions.find((candidate) => candidate.id === id)
  if (!session) throw new Error('会话不存在或已被删除。')
  session.title = normalizeSessionTitle(title)
  session.updatedAt = Date.now()
  persist()
  return getSessions()
}

export function deleteChatSession(id: string): SessionWorkspace {
  const index = store.sessions.findIndex((candidate) => candidate.id === id)
  if (index < 0) throw new Error('会话不存在或已被删除。')
  const deletingActive = store.activeSessionId === id
  store.sessions.splice(index, 1)
  if (store.sessions.length === 0) store.sessions.push(createSession())
  if (deletingActive) store.activeSessionId = store.sessions[Math.min(index, store.sessions.length - 1)].id
  persist()
  return getSessionWorkspace()
}

export function saveSessionMessages(id: string, messages: Message[]): SessionWorkspace {
  const session = store.sessions.find((candidate) => candidate.id === id)
  if (!session) throw new Error('会话不存在或已被删除。')
  session.messages = sanitizeMessages(messages)
  session.updatedAt = Date.now()
  if (session.title === DEFAULT_SESSION_TITLE) session.title = deriveSessionTitle(session.messages)
  schedulePersist()
  return getSessionWorkspace()
}

export function clearActiveSessionMessages(): SessionWorkspace {
  const session = getActiveSessionInternal()
  session.messages = []
  session.title = DEFAULT_SESSION_TITLE
  session.updatedAt = Date.now()
  persist()
  return getSessionWorkspace()
}

// Compatibility wrappers for older renderer calls and plugins.
export function getMessages(): Message[] {
  return getActiveSession().messages
}

export function saveMessages(messages: Message[]): void {
  saveSessionMessages(store.activeSessionId, messages)
}

export function clearMessages(): void {
  clearActiveSessionMessages()
}

export function getState(key: string): string | null {
  return store.state[key] ?? null
}

export function setState(key: string, value: string): void {
  store.state[key] = value
  persist()
}

export function flushDatabase(): void {
  if (store && filePath) persist()
}
