import { CHAT_CONTENT_DEFAULT_WIDTH, CHAT_CONTENT_MIN_WIDTH, PANEL_MIN_HEIGHT, SESSION_SIDEBAR_DEFAULT_WIDTH, SESSION_SIDEBAR_MIN_WIDTH } from '../shared/constants'

export const PANEL_HEIGHT_STATE_KEY = 'chat-panel-height'
export const SESSION_SIDEBAR_STATE_KEY = 'chat-session-sidebar-visible'
export const SESSION_SIDEBAR_WIDTH_STATE_KEY = 'chat-session-sidebar-width'
export const CHAT_CONTENT_WIDTH_STATE_KEY = 'chat-content-width'

export function getDefaultPanelHeight(viewportHeight: number): number {
  return Math.min(720, Math.max(PANEL_MIN_HEIGHT, Math.round(viewportHeight * 0.58)))
}

export function normalizePanelHeight(value: unknown, viewportHeight: number): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  if (!Number.isFinite(parsed)) return getDefaultPanelHeight(viewportHeight)
  return Math.max(PANEL_MIN_HEIGHT, Math.round(parsed))
}

export function parseStoredSidebarVisibility(value: string | null): boolean {
  return value === 'true'
}

export function normalizeSessionSidebarWidth(value: unknown): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  if (!Number.isFinite(parsed)) return SESSION_SIDEBAR_DEFAULT_WIDTH
  return Math.max(SESSION_SIDEBAR_MIN_WIDTH, Math.round(parsed))
}

export function normalizeChatContentWidth(value: unknown): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  if (!Number.isFinite(parsed)) return CHAT_CONTENT_DEFAULT_WIDTH
  return Math.max(CHAT_CONTENT_MIN_WIDTH, Math.round(parsed))
}
