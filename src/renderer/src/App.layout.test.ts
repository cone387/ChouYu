import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/App.tsx'), 'utf8')
const traySource = readFileSync(resolve(process.cwd(), 'src/main/tray.ts'), 'utf8')

describe('panel opening placement', () => {
  it('uses a centered default and restores a dragged panel position', () => {
    expect(source).toContain('getCenteredPanelPosition')
    expect(source).toContain("getState('panel-position')")
    expect(source).toContain("setState('panel-position'")
    expect(source).toContain('onOpenChatPanel(openChatPanel)')
    expect(source).toContain('getDefaultPanelHeight(window.innerHeight)')
    expect(source).not.toContain('const isTop = petCenterY < screenH / 3')
  })

  it('persists and listens for desktop pet visibility changes', () => {
    expect(source).toContain("getState('pet-visible')")
    expect(source).toContain("setState('pet-visible'")
    expect(source).toContain('onSetPetVisible(updatePetVisibility)')
    expect(source).toContain('{petVisible && (')
    expect(traySource).toContain("label: '显示桌面宠物'")
    expect(traySource).toContain("type: 'checkbox'")
    expect(traySource).toContain("send('set-pet-visible', item.checked)")
  })
})

describe('assistant message pipeline', () => {
  it('routes proactive messages into the assistant session instead of a standalone center', () => {
    expect(source).toContain('proactiveAppend')
    expect(source).toContain('restoreSnoozes')
    expect(source).toContain('onAssistantUnread(setAssistantUnread)')
    expect(source).toContain('hasUnread={assistantUnread > 0}')
    expect(source).toContain('onOpenAssistantChat(')
    expect(source).toContain('assistantFocusRequest={assistantFocusRequest}')
    expect(source).not.toContain('ProactiveCenter')
    expect(source).not.toContain('proactiveMsg')
    expect(source).not.toContain('proactive-bubble')
    expect(source).not.toContain('setProactiveUnread')
    expect(source).not.toContain('onOpenMessages')
  })
})
