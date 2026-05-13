import { PluginDefinition, ExecuteResult, LoginResult } from '../types'
import { getState, setState } from '../../database'

const PLUGIN_ID = 'bbtalk'
const DEFAULT_API_URL = 'https://bbtalk.cone387.top'

interface TokenResponse {
  access: string
  refresh: string
}

interface ErrorResponse {
  detail?: string
  error?: string
}

// 内存中的 access token（不落盘）
let accessToken: string | null = null
let refreshTimer: ReturnType<typeof setTimeout> | null = null

function pluginGetState(key: string): string | null {
  return getState(`plugin:${PLUGIN_ID}:${key}`)
}

function pluginSetState(key: string, value: string): void {
  setState(`plugin:${PLUGIN_ID}:${key}`, value)
}

function getApiUrl(): string {
  return pluginGetState('api_url') || DEFAULT_API_URL
}

function parseJwtExp(token: string): number | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
    return payload.exp ?? null
  } catch {
    return null
  }
}

function scheduleRefresh(token: string): void {
  if (refreshTimer) clearTimeout(refreshTimer)
  const exp = parseJwtExp(token)
  if (!exp) return
  const delay = exp * 1000 - Date.now() - 5 * 60 * 1000 // 提前5分钟刷新
  if (delay > 0) {
    refreshTimer = setTimeout(() => refreshAccessToken(), delay)
  } else {
    refreshAccessToken()
  }
}

async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = pluginGetState('refresh_token')
  if (!refreshToken) return false

  try {
    const res = await fetch(`${getApiUrl()}/api/v1/bbtalk/auth/token/refresh/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh: refreshToken })
    })
    if (!res.ok) {
      accessToken = null
      return false
    }
    const data = (await res.json()) as TokenResponse
    accessToken = data.access
    if (data.refresh) {
      pluginSetState('refresh_token', data.refresh)
    }
    scheduleRefresh(data.access)
    return true
  } catch {
    accessToken = null
    return false
  }
}

export const bbtalkPlugin: PluginDefinition = {
  id: PLUGIN_ID,
  command: 'bb',
  name: 'BBTalk',
  description: '发布内容到 BBTalk',
  icon: '📝',
  inputPlaceholder: '记点什么...',
  requiresContent: true,
  authMethods: [
    {
      id: 'credentials',
      label: '账号密码',
      fields: [
        {
          key: 'apiUrl',
          label: 'API 地址',
          type: 'url',
          placeholder: DEFAULT_API_URL,
          required: false,
          persistent: true
        },
        { key: 'username', label: '用户名', type: 'text', required: true },
        { key: 'password', label: '密码', type: 'password', required: true }
      ]
    },
    {
      id: 'token',
      label: 'Token',
      fields: [
        {
          key: 'apiUrl',
          label: 'API 地址',
          type: 'url',
          placeholder: DEFAULT_API_URL,
          required: false,
          persistent: true
        },
        { key: 'token', label: 'Refresh Token', type: 'password', required: true }
      ]
    }
  ],

  async init(): Promise<void> {
    // 启动时尝试恢复登录态
    const refreshToken = pluginGetState('refresh_token')
    if (refreshToken) {
      await refreshAccessToken()
    }
  },

  async login(credentials: Record<string, string>): Promise<LoginResult> {
    const authMethod = credentials._authMethod || 'credentials'
    const apiUrl = credentials.apiUrl || DEFAULT_API_URL

    // 保存 API URL（如果用户自定义了）
    if (credentials.apiUrl) {
      pluginSetState('api_url', credentials.apiUrl)
    }

    if (authMethod === 'token') {
      // Token 模式：直接使用用户提供的 refresh token
      const token = credentials.token
      if (!token) {
        return { ok: false, message: '请输入 Token' }
      }
      pluginSetState('refresh_token', token)
      const refreshed = await refreshAccessToken()
      if (!refreshed) {
        return { ok: false, message: 'Token 无效或已过期' }
      }
      return { ok: true, message: '登录成功' }
    }

    // credentials 模式：用户名密码登录
    const { username, password } = credentials
    const url = apiUrl

    try {
      const res = await fetch(`${url}/api/v1/bbtalk/auth/token/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      })

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as ErrorResponse
        return { ok: false, message: err.detail || err.error || `HTTP ${res.status}` }
      }

      const data = (await res.json()) as TokenResponse
      accessToken = data.access
      pluginSetState('refresh_token', data.refresh)
      pluginSetState('username', username)
      scheduleRefresh(data.access)

      return { ok: true, message: '登录成功' }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : '网络错误'
      return { ok: false, message }
    }
  },

  async logout(): Promise<void> {
    accessToken = null
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = null
    pluginSetState('refresh_token', '')
  },

  isAuthenticated(): boolean {
    return !!accessToken
  },

  async execute(content: string): Promise<ExecuteResult> {
    // 确保 token 有效
    if (!accessToken) {
      const refreshed = await refreshAccessToken()
      if (!refreshed) {
        throw new Error('登录已过期，请重新登录')
      }
    }

    try {
      const res = await fetch(`${getApiUrl()}/api/v1/bbtalk/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({ content, visibility: 'private' })
      })

      if (res.status === 401) {
        // Token 过期，尝试刷新后重试
        const refreshed = await refreshAccessToken()
        if (!refreshed) {
          throw new Error('登录已过期，请重新登录')
        }
        // 重试一次
        const retry = await fetch(`${getApiUrl()}/api/v1/bbtalk/`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`
          },
          body: JSON.stringify({ content, visibility: 'private' })
        })
        if (!retry.ok) {
          throw new Error(`发布失败：HTTP ${retry.status}`)
        }
        return { message: '发布成功 ✓' }
      }

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as ErrorResponse
        throw new Error(`发布失败：${err.detail || err.error || `HTTP ${res.status}`}`)
      }

      return { message: '发布成功 ✓' }
    } catch (e: unknown) {
      if (e instanceof Error) throw e
      throw new Error('网络错误')
    }
  }
}
