export interface ElectronAPI {
  setIgnoreMouseEvents: (ignore: boolean) => void
  log: (msg: string) => void
  onTogglePanel: (callback: () => void) => () => void
  onOpenSettings: (callback: () => void) => () => void
  db: {
    getConfig: () => Promise<AppConfig>
    saveConfig: (cfg: Partial<AppConfig>) => Promise<void>
    getMessages: () => Promise<Message[]>
    saveMessages: (msgs: Message[]) => Promise<void>
    clearMessages: () => Promise<void>
    getState: (key: string) => Promise<string | null>
    setState: (key: string, value: string) => Promise<void>
  }
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export type PetState = 'idle' | 'thinking' | 'talking' | 'sleeping' | 'happy'

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
}

export interface ChatSession {
  messages: Message[]
  createdAt: number
}

export interface AppConfig {
  provider: 'openai' | 'claude'
  baseUrl: string
  apiKey: string
  model: string
  hotkey: string
  autoStart: boolean
  petSize: number
}
