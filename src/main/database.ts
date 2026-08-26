import { app, safeStorage } from 'electron'
import path from 'path'
import fs from 'fs'
import { AppConfig, DEFAULT_APP_CONFIG, normalizeConfig } from '../shared/config'

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  imageUrl?: string
  pluginData?: unknown
}

interface StoreData {
  version: number
  config: AppConfig
  messages: Message[]
  state: Record<string, string>
}

const STORE_VERSION = 2
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

function load(): StoreData {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8')
      const data = JSON.parse(raw) as Partial<StoreData>
      const persistedConfig: Partial<AppConfig> = data.config && typeof data.config === 'object' ? data.config : {}
      const persistedState = data.state && typeof data.state === 'object' ? data.state : {}
      return {
        version: STORE_VERSION,
        config: normalizeConfig({ ...persistedConfig, apiKey: unprotect(persistedConfig.apiKey) }),
        messages: Array.isArray(data.messages) ? data.messages.slice(-30) : [],
        state: Object.fromEntries(
          Object.entries(persistedState).map(([key, value]) => [key, isSecretStateKey(key) ? unprotect(value) : value])
        )
      }
    }
  } catch {}
  return { version: STORE_VERSION, config: { ...DEFAULT_APP_CONFIG }, messages: [], state: {} }
}

function serializeStore(): StoreData {
  return {
    version: STORE_VERSION,
    config: { ...store.config, apiKey: protect(store.config.apiKey) },
    messages: store.messages,
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
  } catch (e) {
    console.error('Failed to persist data:', e)
  }
}

function schedulePersist(): void {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(persist, 750)
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

export function getMessages(): Message[] {
  return store.messages
}

export function saveMessages(messages: Message[]): void {
  if (!Array.isArray(messages)) return
  store.messages = messages
    .slice(-30)
    .filter((message) => message && ['user', 'assistant', 'system'].includes(message.role))
    .map((message) => ({
      ...message,
      id: String(message.id).slice(0, 128),
      content: String(message.content ?? '').slice(0, 200_000),
      timestamp: Number.isFinite(message.timestamp) ? message.timestamp : Date.now(),
      // Screenshots can be several MB. Keep them in the active session but do not
      // embed base64 image data in the durable JSON conversation store.
      imageUrl: message.imageUrl?.startsWith('data:') ? undefined : message.imageUrl
    }))
  schedulePersist()
}

export function clearMessages(): void {
  store.messages = []
  persist()
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
