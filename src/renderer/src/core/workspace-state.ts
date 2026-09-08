export type WorkspaceMode = 'workspace' | 'sessions' | 'chat'
export const WORKSPACE_MODE_STATE_KEY = 'workspace-display-mode'

export function parseWorkspaceMode(value: unknown): WorkspaceMode {
  return value === 'sessions' || value === 'chat' ? value : 'workspace'
}

export function getWorkspaceGeometry(mode: WorkspaceMode, maximized: boolean, viewport: { width: number; height: number }, contentWidth: number, sidebarWidth: number, panelHeight: number) {
  const chromeWidth = mode === 'workspace' ? 56 : 0
  const width = maximized ? viewport.width - 8 : Math.min(contentWidth + (mode === 'chat' ? 0 : sidebarWidth) + chromeWidth, viewport.width - 16)
  return {
    width: Math.max(1, width),
    height: maximized ? Math.max(1, viewport.height - 8) : panelHeight,
    chromeWidth,
    narrow: width < (mode === 'sessions' ? 600 : 700)
  }
}
