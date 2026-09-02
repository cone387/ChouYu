import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

const globalStyles = readFileSync(resolve(process.cwd(), 'src/renderer/src/styles/index.css'), 'utf8')
const panelStyles = readFileSync(resolve(process.cwd(), 'src/renderer/src/components/ChatPanel/ChatPanel.css'), 'utf8')
const memoryStyles = readFileSync(resolve(process.cwd(), 'src/renderer/src/components/Settings/MemorySettingsTab.css'), 'utf8')

describe('UI regression guardrails', () => {
  it('keeps the memory workspace responsive without horizontal overflow', () => {
    expect(panelStyles).toMatch(/\.memory-workspace-content\s*\{[\s\S]*overflow-x:\s*hidden/)
    expect(panelStyles).toMatch(/\.chat-panel-memory\s*\{[\s\S]*width:\s*min\(920px,\s*calc\(100vw\s*-\s*16px\)\)/)
    expect(memoryStyles).toContain('@media (max-width: 520px)')
    expect(memoryStyles).toContain('@media (max-width: 640px)')
  })

  it('keeps dark mode and reduced-motion protections in the global stylesheet', () => {
    expect(globalStyles).toContain('@media (prefers-color-scheme: dark)')
    expect(globalStyles).toContain('@media (prefers-reduced-motion: reduce)')
    expect(globalStyles).toContain('outline: 2px solid var(--accent) !important')
  })

  it('keeps coarse-pointer controls touchable', () => {
    expect(globalStyles).toMatch(/@media \(pointer: coarse\)[\s\S]*min-width: 44px[\s\S]*min-height: 44px/)
  })
})
