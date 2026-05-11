import { useState, useEffect, useCallback } from 'react'
import Pet from './components/Pet/Pet'
import ChatPanel from './components/ChatPanel/ChatPanel'
import { PetState } from './shared/types'
import { PANEL_WIDTH, PANEL_HEIGHT, PANEL_GAP } from './shared/constants'

function App() {
  const [petPosition, setPetPosition] = useState(() => {
    const saved = localStorage.getItem('pet-position')
    if (saved) return JSON.parse(saved)
    return { x: window.innerWidth - 180, y: window.innerHeight - 180 }
  })
  const [panelVisible, setPanelVisible] = useState(false)
  const [petState, setPetState] = useState<PetState>('idle')

  const togglePanel = useCallback(() => {
    setPanelVisible((v) => !v)
  }, [])

  useEffect(() => {
    const cleanup = window.electronAPI.onTogglePanel(togglePanel)
    return cleanup
  }, [togglePanel])

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
    if (y + PANEL_HEIGHT > screenH - PANEL_GAP) y = screenH - PANEL_HEIGHT - PANEL_GAP
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
        state={petState}
      />
      {panelVisible && (
        <ChatPanel
          position={panelPos}
          petState={petState}
          onPetStateChange={setPetState}
          onClose={() => setPanelVisible(false)}
        />
      )}
    </div>
  )
}

export default App
