import { PANEL_MIN_HEIGHT, SESSION_SIDEBAR_DEFAULT_WIDTH, SESSION_SIDEBAR_MAX_WIDTH, SESSION_SIDEBAR_MIN_WIDTH } from '../shared/constants'

export const PANEL_HEIGHT_STATE_KEY = 'chat-panel-height'
export const SESSION_SIDEBAR_STATE_KEY = 'chat-session-sidebar-visible'
export const SESSION_SIDEBAR_WIDTH_STATE_KEY = 'chat-session-sidebar-width'

export function getDefaultPanelHeight(viewportHeight: number): number {
  return Math.min(720, Math.max(PANEL_MIN_HEIGHT, Math.round(viewportHeight * 0.58)))
}

export function normalizePanelHeight(value: unknown, viewportHeight: number): number {
  const maximum = Math.max(PANEL_MIN_HEIGHT, viewportHeight - 8)
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  if (!Number.isFinite(parsed)) return Math.min(maximum, getDefaultPanelHeight(viewportHeight))
  return Math.min(maximum, Math.max(PANEL_MIN_HEIGHT, Math.round(parsed)))
}

export function parseStoredSidebarVisibility(value: string | null): boolean {
  return value === 'true'
}

export function normalizeSessionSidebarWidth(value: unknown): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  if (!Number.isFinite(parsed)) return SESSION_SIDEBAR_DEFAULT_WIDTH
  return Math.min(SESSION_SIDEBAR_MAX_WIDTH, Math.max(SESSION_SIDEBAR_MIN_WIDTH, Math.round(parsed)))
}
