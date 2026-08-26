import type { AppConfig } from '../../../shared/config'
export type { AppConfig } from '../../../shared/config'

/** 插件执行结果 - 插件 execute() 返回此类型，无需 ok 字段 */
export interface ExecuteResult {
  message: string           // 状态文本: "发布成功 ✓" / "翻译完成"
  detail?: string           // 原始/详细信息（可折叠展示）
  actions?: ResultAction[]  // 可选操作按钮
}

/** 结果操作按钮 */
export interface ResultAction {
  label: string             // 按钮文本: "复制", "查看", "重试"
  action: 'copy' | 'open-url' | 'retry'
  payload?: string          // 复制内容 / 打开的 URL
}

/** 框架包装后传递给 Renderer 的完整消息数据 */
export interface PluginMessageData {
  pluginId: string
  pluginName: string
  pluginIcon?: string
  ok: boolean               // 框架判定：正常返回 = true，throw = false
  message: string
  inputContent: string      // 用户原始输入（框架填充）
  detail?: string
  actions?: ResultAction[]
}

/** 登录结果 - login() 仍需 ok 字段 */
export interface LoginResult {
  ok: boolean
  message: string
}

/** 认证字段声明 */
export interface AuthField {
  key: string
  label: string
  type: 'text' | 'password' | 'url'
  placeholder?: string
  required?: boolean
  persistent?: boolean
}

/** 认证方式 */
export interface AuthMethod {
  id: string        // 'credentials' | 'token' | 'apikey' | custom
  label: string     // "账号密码" | "Token" | "API Key"
  fields: AuthField[]
}

export interface PluginInfo {
  id: string
  command: string
  name: string
  description: string
  icon?: string
  inputPlaceholder?: string
  requiresContent?: boolean
  feedToPet?: boolean
  hasAuth: boolean
  authMethods?: AuthMethod[]
}

export interface ElectronAPI {
  getAppVersion: () => Promise<string>
  quitApp: () => Promise<void>
  setAutoStart: (enabled: boolean) => Promise<void>
  checkForUpdates: () => Promise<void>
  setIgnoreMouseEvents: (ignore: boolean) => void
  log: (msg: string) => void
  takeScreenshot: (hideWindow?: boolean) => Promise<string | null>
  openFileDialog: () => Promise<{ type: 'image' | 'text'; data: string; name: string } | null>
  fetchModels: () => Promise<string[]>
  onTogglePanel: (callback: () => void) => () => void
  onOpenSettings: (callback: () => void) => () => void
  onHidePanel: (callback: () => void) => () => void
  onPluginHotkey: (callback: (pluginId: string) => void) => () => void
  onClipboardChange: (callback: (text: string) => void) => () => void
  onConfigChanged: (callback: (config: AppConfig) => void) => () => void
  db: {
    getConfig: () => Promise<AppConfig>
    saveConfig: (cfg: Partial<AppConfig>) => Promise<AppConfig>
    getMessages: () => Promise<Message[]>
    saveMessages: (msgs: Message[]) => Promise<void>
    clearMessages: () => Promise<void>
    getState: (key: string) => Promise<string | null>
    setState: (key: string, value: string) => Promise<void>
  }
  plugin: {
    execute: (pluginId: string, content: string) => Promise<PluginMessageData>
    login: (pluginId: string, credentials: Record<string, string>) => Promise<LoginResult>
    logout: (pluginId: string) => Promise<void>
    isAuthenticated: (pluginId: string) => Promise<boolean>
    getPlugins: () => Promise<PluginInfo[]>
  }
  update: {
    onAvailable: (callback: (info: { version: string }) => void) => () => void
    onNotAvailable: (callback: () => void) => () => void
    onDownloading: (callback: () => void) => () => void
    onProgress: (callback: (progress: { percent: number; transferred: number; total: number }) => void) => () => void
    onDownloaded: (callback: (info: { version: string }) => void) => () => void
    onError: (callback: (message: string) => void) => () => void
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
  imageUrl?: string
  /** Plugin result data - if present, render as plugin card instead of markdown */
  pluginData?: PluginMessageData
}

export interface ChatSession {
  messages: Message[]
  createdAt: number
}
