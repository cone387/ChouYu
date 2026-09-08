import { useCallback, useEffect, useRef, useState } from 'react'
import { parseWorkspaceMode, WORKSPACE_MODE_STATE_KEY, type WorkspaceMode } from '../../core/workspace-state'

export function useWorkspacePresentation() {
  const [mode, setMode] = useState<WorkspaceMode>('workspace')
  const [loaded, setLoaded] = useState(false)
  const [maximized, setMaximized] = useState(false)
  const changed = useRef(false)
  useEffect(() => {
    let active = true
    void window.electronAPI.db.getState(WORKSPACE_MODE_STATE_KEY).then(value => {
      if (active && !changed.current) setMode(parseWorkspaceMode(value))
    }).catch(() => {}).finally(() => { if (active) setLoaded(true) })
    return () => { active = false }
  }, [])
  const changeMode = useCallback((value: WorkspaceMode) => {
    changed.current = true
    setMode(value)
    void window.electronAPI.db.setState(WORKSPACE_MODE_STATE_KEY, value).catch(() => { /* Storage failures are reported globally. */ })
  }, [])
  return { mode, changeMode, loaded, maximized, toggleMaximized: () => setMaximized(value => !value) }
}
