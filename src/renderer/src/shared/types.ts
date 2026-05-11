export interface ElectronAPI {
  setIgnoreMouseEvents: (ignore: boolean) => void
  onTogglePanel: (callback: () => void) => () => void
  onOpenSettings: (callback: () => void) => () => void
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
