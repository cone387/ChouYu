import { app } from 'electron'
import path from 'path'
import fs from 'fs'

export interface AppConfig {
  provider: 'openai' | 'claude'
  baseUrl: string
  apiKey: string
  model: string
  hotkey: string
  autoStart: boolean
  petSize: number
}

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  imageUrl?: string
}

interface StoreData {
  config: AppConfig
  messages: Message[]
  state: Record<string, string>
}

const DEFAULT_CONFIG: AppConfig = {
  provider: 'openai',
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: 'sk-d7fdb9297d5542a896f3d119a090e188',
  model: 'qwen-plus',
  hotkey: 'Alt+Space',
  autoStart: false,
  petSize: 80
}

let store: StoreData
let filePath: string

function load(): StoreData {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8')
      const data = JSON.parse(raw)
      return {
        config: { ...DEFAULT_CONFIG, ...data.config },
        messages: data.messages || [],
        state: data.state || {}
      }
    }
  } catch {}
  return { config: { ...DEFAULT_CONFIG }, messages: [], state: {} }
}

function persist(): void {
  try {
    const dir = path.dirname(filePath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf-8')
  } catch (e) {
    console.error('Failed to persist data:', e)
  }
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
  store.config = { ...store.config, ...patch }
  persist()
}

export function getMessages(): Message[] {
  return store.messages
}

export function saveMessages(messages: Message[]): void {
  store.messages = messages.slice(-30)
  persist()
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
