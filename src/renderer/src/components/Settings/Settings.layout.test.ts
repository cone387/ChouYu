import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

const stylesheet = readFileSync(resolve(process.cwd(), 'src/renderer/src/components/Settings/Settings.css'), 'utf8')
const panelStylesheet = readFileSync(resolve(process.cwd(), 'src/renderer/src/components/ChatPanel/ChatPanel.css'), 'utf8')

describe('settings layout guardrails', () => {
  it('uses adaptive panel sizing instead of a fixed small canvas', () => {
    expect(panelStylesheet).toMatch(/\.chat-panel-settings\s*\{[\s\S]*width:\s*min\(760px,\s*calc\(100vw\s*-\s*16px\)\)/)
    expect(panelStylesheet).toMatch(/\.chat-panel-settings\s*\{[\s\S]*height:\s*min\(640px,\s*calc\(100vh\s*-\s*16px\)\)/)
    expect(stylesheet).toMatch(/\.settings-content\s*\{[\s\S]*overflow-y:\s*auto/)
    expect(stylesheet).toMatch(/\.settings-content\s*\{[\s\S]*overflow-x:\s*hidden/)
  })
})
