import { normalizeAssistantMessageKind, type AssistantMessageKind } from '../shared/assistant-message'
import { app, safeStorage } from 'electron'
import { randomUUID } from 'crypto'
import path from 'path'
import fs from 'fs'
import { EventEmitter } from 'events'
import type { StorageStatus } from '../shared/storage'
import { AttachmentStore, isAttachmentReference } from './attachment-store'
import { readStoreFile, writeStoreFile } from './store-file'
import { findTextMatch, searchExcerpt, searchableMessageText } from '../shared/conversation-search'
import { AppConfig, DEFAULT_APP_CONFIG, DEFAULT_PROFILE_ID, getProviderProfiles, normalizeConfig } from '../shared/config'
import {
  ASSISTANT_CHARACTER_ID, Character, CharacterStats, DEFAULT_CHARACTER_ID, MAX_CHARACTER_COUNT, PRESET_CHARACTERS,
  isAssistantCharacter, normalizeCharacters, sanitizeCharacterDraft
} from '../shared/characters'
import {
  DEFAULT_SESSION_TITLE,
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
  assistantKind?: AssistantMessageKind
  responseStatus?: 'error' | 'stopped'
  toolData?: ToolActivityData
  memoryRefs?: Array<{ id: string; content: string; type: string; feedback?: MemoryFeedbackValue; sourceIds?: string[]; clusterId?: string; compressedCount?: number }>
  pluginData?: unknown
}

export interface ChatSession {
  id: string
  title: string
  messages: Message[]
  characterId: string
  createdAt: number
  updatedAt: number
  lastReadAt?: number
}

export interface ChatSessionSummary {
  id: string
  title: string
  preview: string
  messageCount: number
  characterId: string
  createdAt: number
  updatedAt: number
  unreadCount: number
}

export interface SessionWorkspace {
  sessions: ChatSessionSummary[]
  activeSession: ChatSession
}

interface StoreData {
  version: number
  config: AppConfig
  characters: Character[]
  sessions: ChatSession[]
  activeSessionId: string
  state: Record<string, string>
}

interface PersistedStoreData extends Partial<StoreData> {
  messages?: Message[]
}

const STORE_VERSION = 4
const ENCRYPTED_PREFIX = 'safe:v1:'

let store: StoreData
let filePath: string
let attachments: AttachmentStore
let writesBlocked = false
let storageStatus: StorageStatus = { error: null, notice: null, revision: 0 }
const storageEvents = new EventEmitter()

export function getStorageStatus(): StorageStatus { return { ...storageStatus } }

export function onStorageStatus(listener: (status: StorageStatus) => void): () => void {
  storageEvents.on('change', listener)
  return () => { storageEvents.off('change', listener) }
}

function updateStorageStatus(patch: Partial<Omit<StorageStatus, 'revision'>>): void {
  if (Object.entries(patch).every(([key, value]) => storageStatus[key as 'error' | 'notice'] === value)) return
  storageStatus = { ...storageStatus, ...patch, revision: storageStatus.revision + 1 }
  storageEvents.emit('change', getStorageStatus())
}

export function dismissStorageNotice(): StorageStatus {
  updateStorageStatus({ notice: null })
  return getStorageStatus()
}

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
      feedback: ref.feedback === 'helpful' || ref.feedback === 'unhelpful' ? ref.feedback : undefined,
      sourceIds: Array.isArray(ref.sourceIds) ? ref.sourceIds.filter((id): id is string => typeof id === 'string').slice(0, 12).map((id) => id.slice(0, 128)) : undefined,
      clusterId: typeof ref.clusterId === 'string' ? ref.clusterId.slice(0, 128) : undefined,
      compressedCount: typeof ref.compressedCount === 'number' && Number.isFinite(ref.compressedCount) ? Math.min(12, Math.max(2, Math.round(ref.compressedCount))) : undefined
    }]
  })
}

function sanitizeMessages(value: unknown): Message[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((message): message is Message => Boolean(
      message && typeof message === 'object' && ['user', 'assistant', 'system'].includes(message.role)
    ))
    .map((message) => ({
      ...message,
      id: String(message.id || randomUUID()).slice(0, 128),
      content: String(message.content ?? ''),
      timestamp: Number.isFinite(message.timestamp) ? message.timestamp : Date.now(),
      responseStatus: message.responseStatus === 'error' || message.responseStatus === 'stopped'
        ? message.responseStatus
        : undefined,
      assistantKind: message.role === 'assistant' ? normalizeAssistantMessageKind(message.assistantKind) : undefined,
      toolData: sanitizeToolData(message.toolData),
      memoryRefs: sanitizeMemoryRefs(message.memoryRefs),
      imageUrl: typeof message.imageUrl === 'string' ? message.imageUrl : undefined
    }))
}

function createSession(messages: Message[] = [], title?: string, now = Date.now(), characterId: string = DEFAULT_CHARACTER_ID): ChatSession {
  return {
    id: randomUUID(),
    title: title ? normalizeSessionTitle(title) : deriveSessionTitle(messages),
    messages: sanitizeMessages(messages),
    characterId,
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
      const lastReadAt = Number.isFinite(input.lastReadAt) ? Number(input.lastReadAt) : undefined
      return {
        id,
        title: normalizeSessionTitle(typeof input.title === 'string' ? input.title : deriveSessionTitle(messages)),
        messages,
        characterId: typeof input.characterId === 'string' && input.characterId.trim() ? input.characterId.trim().slice(0, 128) : DEFAULT_CHARACTER_ID,
        createdAt,
        updatedAt,
        ...(lastReadAt !== undefined ? { lastReadAt } : {})
      }
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

function cloneSession(session: ChatSession): ChatSession {
  return { ...session, messages: session.messages.map((message) => {
    try {
      return { ...message, imageUrl: attachments.read(message.imageUrl) }
    } catch {
      updateStorageStatus({ notice: '部分图片附件缺失或损坏，文字记录仍可使用。请从备份恢复 attachments 文件夹。' })
      return { ...message, imageUrl: undefined }
    }
  }) }
}

function toSummary(session: ChatSession): ChatSessionSummary {
  return {
    id: session.id,
    title: session.title,
    preview: buildSessionPreview(session.messages),
    messageCount: session.messages.length,
    characterId: session.characterId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    unreadCount: isAssistantCharacter(session.characterId)
      ? session.messages.filter((message) => message.timestamp > (session.lastReadAt ?? 0)).length
      : 0
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

function parseStore(text: string): PersistedStoreData {
  const data = JSON.parse(text) as PersistedStoreData
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid store')
  if (typeof data.version === 'number' && data.version > STORE_VERSION) throw new Error('NEWER_STORE_VERSION')
  if (!Array.isArray(data.sessions) && !Array.isArray(data.messages)) throw new Error('Invalid conversations')
  if (data.sessions !== undefined && (!Array.isArray(data.sessions) || data.sessions.some((session) =>
    !session || typeof session !== 'object' || !Array.isArray(session.messages)
  ))) throw new Error('Invalid session')
  return data
}

function load(): StoreData {
  const loaded = readStoreFile(filePath, parseStore)
  writesBlocked = loaded.blocked
  updateStorageStatus({
    notice: loaded.notice,
    error: loaded.blocked ? '无法安全读取聊天数据，已停止写入原文件。请检查数据目录权限或使用较新版本，然后重新启动。' : null
  })
  if (loaded.data) {
    const data = loaded.data
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

    const persistedProfiles: Partial<AppConfig> = {
      ...persistedConfig,
      providerProfiles: Array.isArray(persistedConfig.providerProfiles)
        ? persistedConfig.providerProfiles.map((profile) => ({ ...profile, apiKey: unprotect(profile.apiKey) }))
        : []
    }

    return {
      version: STORE_VERSION,
      config: normalizeConfig({
        ...persistedProfiles,
        apiKey: unprotect(persistedConfig.apiKey),
        embeddingApiKey: unprotect(persistedConfig.embeddingApiKey),
        memorySyncApiKey: unprotect(persistedConfig.memorySyncApiKey)
      }),
      characters: normalizeCharacters(data.characters),
      sessions,
      activeSessionId,
      state: Object.fromEntries(
        Object.entries(persistedState).map(([key, value]) => [key, isSecretStateKey(key) ? unprotect(value) : value])
      )
    }
  }

  const session = createSession()
  return {
    version: STORE_VERSION,
    config: { ...DEFAULT_APP_CONFIG },
    characters: normalizeCharacters(undefined),
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
      embeddingApiKey: protect(store.config.embeddingApiKey),
      memorySyncApiKey: protect(store.config.memorySyncApiKey),
      providerProfiles: store.config.providerProfiles.map((profile) => ({ ...profile, apiKey: protect(profile.apiKey) }))
    },
    characters: store.characters,
    sessions: store.sessions.map((session) => ({
      ...session,
      messages: session.messages.map((message) => ({ ...message, imageUrl: attachments.persist(message.imageUrl) }))
    })),
    activeSessionId: store.activeSessionId,
    state: Object.fromEntries(
      Object.entries(store.state).map(([key, value]) => [key, isSecretStateKey(key) ? protect(value) : value])
    )
  }
}

function persist(throwOnError = true): boolean {
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  try {
    if (writesBlocked) throw new Error('Protected store')
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    const serialized = serializeStore()
    writeStoreFile(filePath, JSON.stringify(serialized, null, 2), parseStore)
    // Retain file references in memory after a successful commit; UI receives data URLs on demand.
    store.sessions = serialized.sessions
    updateStorageStatus({ error: null })
    return true
  } catch {
    const message = writesBlocked
      ? '无法安全读取聊天数据，已停止写入原文件。请检查数据目录权限或使用较新版本，然后重新启动。'
      : '聊天数据保存失败，最新修改尚未写入磁盘。请检查剩余空间和目录权限后重试；恢复前请勿退出。'
    updateStorageStatus({ error: message })
    if (throwOnError) throw new Error(message)
    return false
  }
}

function schedulePersist(): void {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => persist(false), 500)
}

/** 首次启动播种各行业预设联系人：一次性 flag 保证删除后不会复活。 */
function seedPresetCharacters(): void {
  if (store.state['presetCharactersSeeded']) return
  const names = new Set(store.characters.map((item) => item.name.toLowerCase()))
  const model = store.config.model.trim() || 'gpt-4o'
  const now = Date.now()
  let seeded = 0
  for (const preset of PRESET_CHARACTERS) {
    if (store.characters.filter((item) => !item.builtIn).length >= MAX_CHARACTER_COUNT - 1) break
    if (store.characters.some((item) => item.id === preset.id) || names.has(preset.name.toLowerCase())) continue
    store.characters.push({
      id: preset.id, name: preset.name, avatar: preset.avatar, category: preset.category, soulMd: preset.soulMd,
      providerProfileId: DEFAULT_PROFILE_ID, model, builtIn: false, createdAt: now, updatedAt: now
    })
    names.add(preset.name.toLowerCase())
    seeded += 1
  }
  store.state['presetCharactersSeeded'] = String(Date.now())
  if (seeded > 0) persist(false)
}

/** 旧版本播种的预设没有行业分类：按 id 幂等补齐，已手动归类或已删除的不动。 */
function backfillPresetCategories(): void {
  const categoryById = new Map(PRESET_CHARACTERS.map((preset) => [preset.id, preset.category]))
  let changed = false
  for (const character of store.characters) {
    const category = categoryById.get(character.id)
    if (!category || character.category) continue
    character.category = category
    changed = true
  }
  if (changed) persist(false)
}

/** 旧版消息中心的 proactive-messages 历史一次性迁入助手会话，幂等。 */
function migrateProactiveMessages(): void {
  if (store.state['proactive-migrated']) return
  const raw = store.state['proactive-messages']
  store.state['proactive-migrated'] = String(Date.now())
  if (!raw) return
  let entries: unknown[] = []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) entries = parsed
  } catch { /* malformed legacy payload: drop it */ }
  const legacy = entries
    .flatMap((item): { message: string; createdAt: number }[] => {
      if (!item || typeof item !== 'object') return []
      const message = (item as Record<string, unknown>).message
      const createdAt = (item as Record<string, unknown>).createdAt
      if (typeof message !== 'string' || message.trim().length === 0 || !Number.isFinite(createdAt)) return []
      return [{ message, createdAt: Number(createdAt) }]
    })
    .sort((a, b) => a.createdAt - b.createdAt)
  // 迁移的历史消息保持未读：用户从未见过它们，升级后首次启动的未读爆发是预期行为。
  for (const item of legacy) appendAssistantMessage(item.message, item.createdAt)
}

export function initDatabase(): void {
  filePath = path.join(app.getPath('userData'), 'chouyu-data.json')
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = null
  attachments = new AttachmentStore(path.join(app.getPath('userData'), 'attachments'))
  store = load()
  seedPresetCharacters()
  backfillPresetCategories()
  migrateProactiveMessages()
  persist(false)
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

export function searchSessions(query: string): ChatSessionSummary[] {
  if (!query.trim()) return getSessions()
  return store.sessions.flatMap((session) => {
    const message = session.messages.find((item) => findTextMatch(searchableMessageText(item), query))
    if (!message && !findTextMatch(session.title, query)) return []
    return [{ ...toSummary(session), preview: message ? searchExcerpt(searchableMessageText(message), query) : buildSessionPreview(session.messages) }]
  }).sort((a, b) => b.updatedAt - a.updatedAt)
}

export function getSession(id: string): ChatSession | null {
  const session = store.sessions.find((candidate) => candidate.id === id)
  return session ? cloneSession(session) : null
}

export function getSessionWorkspace(): SessionWorkspace {
  return { sessions: getSessions(), activeSession: getActiveSession() }
}

export function createChatSession(title?: string, characterId: string = DEFAULT_CHARACTER_ID): SessionWorkspace {
  const owner = getCharacter(characterId) ? characterId : DEFAULT_CHARACTER_ID
  const session = createSession([], title, Date.now(), owner)
  store.sessions.unshift(session)
  store.activeSessionId = session.id
  persist()
  return getSessionWorkspace()
}

export function selectChatSession(id: string): SessionWorkspace {
  const session = store.sessions.find((candidate) => candidate.id === id)
  if (!session) throw new Error('会话不存在或已被删除。')
  store.activeSessionId = id
  if (isAssistantCharacter(session.characterId)) markSessionReadUpToNow(session)
  persist()
  return getSessionWorkspace()
}

/** 查看会话即标记已读：取当前时间与最新消息时间戳的较大者，避免未来时间戳消息卡住角标。 */
function markSessionReadUpToNow(session: ChatSession): void {
  const latest = session.messages.reduce((latest, message) => Math.max(latest, message.timestamp), 0)
  session.lastReadAt = Math.max(Date.now(), latest)
}

/** 主动提醒的唯一入口：写入助手会话并即时落盘，托盘角标据此更新。 */
export function appendAssistantMessage(content: string, timestamp?: number, kind?: AssistantMessageKind): SessionWorkspace {
  const at = Number.isFinite(timestamp) ? Number(timestamp) : Date.now()
  let session = store.sessions
    .filter((candidate) => isAssistantCharacter(candidate.characterId))
    .reduce<ChatSession | null>((latest, candidate) => (!latest || candidate.updatedAt > latest.updatedAt ? candidate : latest), null)
  if (!session) {
    session = createSession([], '助手消息', at, ASSISTANT_CHARACTER_ID)
    store.sessions.unshift(session)
  }
  session.messages.push({ id: randomUUID(), role: 'assistant', content: content.slice(0, 20_000), timestamp: at, assistantKind: normalizeAssistantMessageKind(kind) })
  session.updatedAt = at
  persist(false)
  return getSessionWorkspace()
}

export function markSessionRead(id: string): SessionWorkspace {
  const session = store.sessions.find((candidate) => candidate.id === id)
  if (!session) throw new Error('会话不存在或已被删除。')
  markSessionReadUpToNow(session)
  persist(false)
  return getSessionWorkspace()
}

export function getAssistantUnreadCount(): number {
  return store.sessions
    .filter((session) => isAssistantCharacter(session.characterId))
    .reduce((total, session) => total + session.messages.filter((message) => message.timestamp > (session.lastReadAt ?? 0)).length, 0)
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

export function listCharacters(): CharacterStats[] {
  return store.characters.map((character) => {
    const sessions = store.sessions.filter((session) => session.characterId === character.id)
    return {
      ...character,
      sessionCount: sessions.length,
      lastActiveAt: sessions.reduce((latest, session) => Math.max(latest, session.updatedAt), character.createdAt)
    }
  })
}

export function getCharacter(id: string): Character | null {
  const character = store.characters.find((item) => item.id === id)
  return character ? { ...character } : null
}

function findCharacterByIdOrThrow(id: string): Character {
  const character = store.characters.find((item) => item.id === id)
  if (!character) throw new Error('角色不存在或已被删除。')
  return character
}

export function createCharacter(draft: unknown): CharacterStats {
  const input = sanitizeCharacterDraft(draft)
  if (!input) throw new Error('角色名称和模型为必填项。')
  const customCount = store.characters.filter((item) => !item.builtIn).length
  if (customCount >= MAX_CHARACTER_COUNT - 1) throw new Error(`最多支持 ${MAX_CHARACTER_COUNT} 个角色。`)
  if (!getProviderProfiles(store.config).some((profile) => profile.id === input.providerProfileId)) {
    throw new Error('所选供应商档案不存在，请先到设置页创建。')
  }
  if (store.characters.some((character) => character.name.toLowerCase() === input.name.toLowerCase())) {
    throw new Error('已存在同名角色，请换一个名字。')
  }
  const now = Date.now()
  const character: Character = { id: randomUUID(), ...input, builtIn: false, createdAt: now, updatedAt: now }
  store.characters.push(character)
  persist()
  return listCharacters().find((item) => item.id === character.id)!
}

export function updateCharacter(id: string, draft: unknown): CharacterStats {
  const character = findCharacterByIdOrThrow(id)
  if (isAssistantCharacter(id)) throw new Error('内置助手不可编辑。')
  const input = sanitizeCharacterDraft(draft)
  if (!input) throw new Error('角色名称和模型为必填项。')
  if (character.builtIn && input.providerProfileId !== DEFAULT_PROFILE_ID) throw new Error('内置角色固定使用默认档案。')
  if (!getProviderProfiles(store.config).some((profile) => profile.id === input.providerProfileId)) {
    throw new Error('所选供应商档案不存在，请先到设置页创建。')
  }
  if (store.characters.some((item) => item.id !== id && item.name.toLowerCase() === input.name.toLowerCase())) {
    throw new Error('已存在同名角色，请换一个名字。')
  }
  if (character.builtIn) {
    character.name = input.name
    character.avatar = input.avatar
    character.updatedAt = Date.now()
    // 内置角色的人设与模型写入全局配置，保持单一数据源。
    saveConfig({ soulMd: input.soulMd, model: input.model })
    return listCharacters().find((item) => item.id === id)!
  }
  Object.assign(character, input, { updatedAt: Date.now() })
  persist()
  return listCharacters().find((item) => item.id === id)!
}

export function deleteCharacter(id: string): SessionWorkspace {
  const character = findCharacterByIdOrThrow(id)
  if (character.builtIn) throw new Error('内置角色不可删除。')
  const hadActive = store.sessions.some((session) => session.characterId === id && session.id === store.activeSessionId)
  store.sessions = store.sessions.filter((session) => session.characterId !== id)
  store.characters = store.characters.filter((item) => item.id !== id)
  if (store.sessions.length === 0) store.sessions.push(createSession())
  if (hadActive || !store.sessions.some((session) => session.id === store.activeSessionId)) {
    store.activeSessionId = store.sessions[0].id
  }
  persist()
  return getSessionWorkspace()
}

export function saveSessionMessages(id: string, messages: Message[]): SessionWorkspace {
  const session = store.sessions.find((candidate) => candidate.id === id)
  if (!session) throw new Error('会话不存在或已被删除。')
  const previousImages = new Map(session.messages.filter((message) => message.imageUrl && isAttachmentReference(message.imageUrl)).map((message) => [message.id, message.imageUrl]))
  let nextMessages: Message[] = sanitizeMessages(messages).map((message) => ({
    ...message,
    // A missing file must not erase its durable reference when the renderer saves text updates.
    imageUrl: message.imageUrl ?? previousImages.get(message.id)
  }))
  // 生成期间的主动追加可能尚未进入渲染层缓存（后台会话在流式中无法收到 sessions:changed 的消息合并）：
  // 只保留比 incoming 全部消息都新的缺失消息，避免旧回复在重试/编辑后被“复活”；空列表是显式清空，不合并。
  if (isAssistantCharacter(session.characterId) && nextMessages.length > 0) {
    const known = new Set(nextMessages.map((message) => message.id))
    const maxIncoming = nextMessages.reduce((latest, message) => Math.max(latest, message.timestamp), 0)
    const trailing = session.messages.filter((message) => !known.has(message.id) && message.timestamp > maxIncoming)
    if (trailing.length > 0) nextMessages = [...nextMessages, ...trailing]
  }
  session.messages = nextMessages
  session.updatedAt = Date.now()
  // 渲染层保存消息说明用户正在助手会话对话：AI 回复不当未读。
  if (isAssistantCharacter(session.characterId)) markSessionReadUpToNow(session)
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

export function flushDatabase(): StorageStatus {
  if (store && filePath) persist(false)
  return getStorageStatus()
}
