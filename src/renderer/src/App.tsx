import { useState, useEffect, useCallback, useRef } from 'react'
import Pet from './components/Pet/Pet'
import ChatPanel from './components/ChatPanel/ChatPanel'
import { PetState } from './shared/types'
import { PANEL_WIDTH, PANEL_COMPACT_HEIGHT, PANEL_GAP } from './shared/constants'

function App() {
  const [petPosition, setPetPosition] = useState(() => {
    const saved = localStorage.getItem('pet-position')
    if (saved) return JSON.parse(saved)
    return { x: window.innerWidth - 180, y: window.innerHeight - 180 }
  })
  const [panelVisible, setPanelVisible] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [petState, setPetState] = useState<PetState>('idle')
  const ignoreRef = useRef(true)

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY)
      const isOverUI = el && el.closest('[data-interactive]')
      if (isOverUI && ignoreRef.current) {
        ignoreRef.current = false
        window.electronAPI.setIgnoreMouseEvents(false)
      } else if (!isOverUI && !ignoreRef.current) {
        ignoreRef.current = true
        window.electronAPI.setIgnoreMouseEvents(true)
      }
    }
    document.addEventListener('mousemove', handleMouseMove)
    return () => document.removeEventListener('mousemove', handleMouseMove)
  }, [])

  const togglePanel = useCallback(() => {
    setPanelVisible((v) => !v)
  }, [])

  const openSettings = useCallback(() => {
    setPanelVisible(true)
    setShowSettings(true)
  }, [])

  useEffect(() => {
    const cleanup = window.electronAPI.onTogglePanel(togglePanel)
    return cleanup
  }, [togglePanel])

  useEffect(() => {
    const cleanup = window.electronAPI.onOpenSettings(openSettings)
    return cleanup
  }, [openSettings])

  useEffect(() => {
    localStorage.setItem('pet-position', JSON.stringify(petPosition))
  }, [petPosition])

  const getPanelPosition = () => {
    const screenW = window.innerWidth
    const screenH = window.innerHeight
    const petCenterX = petPosition.x + 40
    const isRight = petCenterX > screenW / 2

    let x = isRight
      ? petPosition.x - PANEL_WIDTH - PANEL_GAP
      : petPosition.x + 80 + PANEL_GAP

    let y = petPosition.y

    if (x < PANEL_GAP) x = PANEL_GAP
    if (x + PANEL_WIDTH > screenW - PANEL_GAP) x = screenW - PANEL_WIDTH - PANEL_GAP
    if (y + PANEL_COMPACT_HEIGHT > screenH - PANEL_GAP) y = screenH - PANEL_COMPACT_HEIGHT - PANEL_GAP
    if (y < PANEL_GAP) y = PANEL_GAP

    return { x, y }
  }

  const panelPos = getPanelPosition()

  return (
    <div className="app-container">
      <Pet
        position={petPosition}
        onPositionChange={setPetPosition}
        onClick={togglePanel}
        onOpenSettings={openSettings}
        state={petState}
      />
      {panelVisible && (
        <ChatPanel
          position={panelPos}
          petState={petState}
          onPetStateChange={setPetState}
          onClose={() => setPanelVisible(false)}
          initialShowSettings={showSettings}
          onSettingsClose={() => setShowSettings(false)}
        />
      )}
    </div>
  )
}

export default App
