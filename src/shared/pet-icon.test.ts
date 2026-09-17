import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { PET_ICON_PNG_BASE64, PET_ICON_SVG } from './pet-icon'

describe('pet icon consistency', () => {
  it('keeps the purple face for the tray while workspace navigation follows the accent palette', () => {
    const traySource = readFileSync(resolve(process.cwd(), 'src/main/tray.ts'), 'utf8')
    const navigationSource = readFileSync(resolve(process.cwd(), 'src/renderer/src/components/Workspace/WorkspaceNav.tsx'), 'utf8')

    expect(PET_ICON_SVG).toContain('fill="#6C5CE7"')
    expect(PET_ICON_SVG).toContain('M 32 52 Q 40 58 48 52')
    expect(Buffer.from(PET_ICON_PNG_BASE64, 'base64').subarray(1, 4).toString()).toBe('PNG')
    expect(traySource).toContain('PET_ICON_PNG_BASE64')
    expect(traySource).toContain('nativeImage.createFromBuffer')
    expect(traySource).toContain('icon.isEmpty()')
    expect(traySource).toContain("mainWindow.webContents.send('open-chat-panel')")
    expect(traySource).toContain('tray.on(\'click\', onTrayClick)')
    expect(traySource).toContain("mainWindow.webContents.send('open-messages-center')")
    expect(traySource).toContain('mainWindow.focus()')
    expect(traySource).toContain('mainWindow.moveTop()')
    // Data-URL images cannot inherit CSS variables, so the workspace logo inlines a themed svg.
    expect(navigationSource).toContain('fill="var(--accent)"')
    expect(navigationSource).not.toContain('PET_ICON_SVG')
  })
})
