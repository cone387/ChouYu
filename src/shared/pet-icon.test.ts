import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { PET_ICON_PNG_BASE64, PET_ICON_SVG } from './pet-icon'

describe('pet icon consistency', () => {
  it('uses the same purple face geometry for the tray and top bar', () => {
    const traySource = readFileSync(resolve(process.cwd(), 'src/main/tray.ts'), 'utf8')
    const topBarSource = readFileSync(resolve(process.cwd(), 'src/renderer/src/components/ChatPanel/TopBar.tsx'), 'utf8')

    expect(PET_ICON_SVG).toContain('fill="#6C5CE7"')
    expect(PET_ICON_SVG).toContain('M 32 52 Q 40 58 48 52')
    expect(Buffer.from(PET_ICON_PNG_BASE64, 'base64').subarray(1, 4).toString()).toBe('PNG')
    expect(traySource).toContain('PET_ICON_PNG_BASE64')
    expect(traySource).toContain('nativeImage.createFromBuffer')
    expect(traySource).toContain('icon.isEmpty()')
    expect(traySource).toContain("mainWindow.webContents.send('open-chat-panel')")
    expect(traySource).toContain('tray.on(\'click\', openChatPanel)')
    expect(traySource).toContain('mainWindow.focus()')
    expect(traySource).toContain('mainWindow.moveTop()')
    expect(topBarSource).toContain('fill="#6C5CE7"')
    expect(topBarSource).toContain('rgba(255,100,100,0.3)')
  })
})
