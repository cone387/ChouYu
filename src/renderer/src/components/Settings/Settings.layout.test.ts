import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

const stylesheet = readFileSync(resolve(process.cwd(), 'src/renderer/src/components/Settings/Settings.css'), 'utf8')
const panelStylesheet = readFileSync(resolve(process.cwd(), 'src/renderer/src/components/ChatPanel/ChatPanel.css'), 'utf8')
const memoryStylesheet = readFileSync(resolve(process.cwd(), 'src/renderer/src/components/Settings/MemorySettingsTab.css'), 'utf8')
const settingsSource = readFileSync(resolve(process.cwd(), 'src/renderer/src/components/Settings/Settings.tsx'), 'utf8')
const memorySource = readFileSync(resolve(process.cwd(), 'src/renderer/src/components/Settings/MemorySettingsTab.tsx'), 'utf8')
const toolsSource = readFileSync(resolve(process.cwd(), 'src/renderer/src/components/Settings/ToolsSettingsTab.tsx'), 'utf8')

describe('settings layout guardrails', () => {
  it('uses adaptive panel sizing instead of a fixed small canvas', () => {
    expect(panelStylesheet).toMatch(/\.chat-panel-settings\s*\{[\s\S]*width:\s*min\(760px,\s*calc\(100vw\s*-\s*16px\)\)/)
    expect(panelStylesheet).toMatch(/\.chat-panel-settings\s*\{[\s\S]*height:\s*min\(640px,\s*calc\(100vh\s*-\s*16px\)\)/)
    expect(stylesheet).toMatch(/\.settings-content\s*\{[\s\S]*overflow-y:\s*auto/)
    expect(stylesheet).toMatch(/\.settings-content\s*\{[\s\S]*overflow-x:\s*hidden/)
  })

  it('keeps dense settings content readable and touchable', () => {
    expect(stylesheet).toMatch(/\.settings-nav-item\s*\{[\s\S]*min-height:\s*40px/)
    expect(stylesheet).toMatch(/\.settings-diagnostic-item > small\s*\{\s*font-size:\s*11px/)
    expect(memoryStylesheet).toMatch(/\.memory-settings-pane p,[\s\S]*font-size:\s*12px/)
    expect(memoryStylesheet).toMatch(/\.memory-settings-pane button,[\s\S]*min-height:\s*34px/)
  })

  it('uses vector icons for plugin navigation', () => {
    expect(settingsSource).toContain('item.key.startsWith(\'plugin-\')')
    expect(settingsSource).not.toContain('settings-nav-icon-emoji')
  })

  it('provides searchable settings navigation with arrow-key traversal', () => {
    expect(settingsSource).toContain('aria-label="搜索设置"')
    expect(settingsSource).toContain('data-settings-nav')
    expect(settingsSource).toContain("event.key === 'ArrowDown'")
    expect(settingsSource).toContain("'ArrowUp'")
    expect(settingsSource).toContain("event.key === 'Home'")
    expect(settingsSource).toContain("event.key === 'End'")
    expect(settingsSource).toContain('handleNavSearchKeyDown')
    expect(settingsSource).toContain("event.key !== 'Escape'")
    expect(stylesheet).toMatch(/\.settings-nav-search\s*\{[\s\S]*border:/)
  })

  it('exposes configurable memory writing and tool permission modes', () => {
    expect(memorySource).toContain('记忆写入方式')
    expect(memorySource).toContain('自动写入（推荐）')
    expect(memorySource).toContain('每次确认')
    expect(memorySource).toContain('自动写入严格度')
    expect(memorySource).toContain('平衡（推荐）')
    expect(toolsSource).toContain('操作权限')
    expect(toolsSource).toContain('手动确认')
    expect(toolsSource).toContain('自动审核')
    expect(toolsSource).toContain('完全访问')
  })

  it('surfaces a dedicated identity profile backed by person memories', () => {
    expect(memorySource).toContain('memory.identity()')
    expect(memorySource).toContain('memory-identity-card')
    expect(memorySource).toContain("querySelector('.memory-library')")
    expect(memorySource).toContain('void refresh()')
    expect(memoryStylesheet).toContain('.memory-identity-card')
  })

  it('keeps the persona editor large with a thin, neutral scrollbar', () => {
    expect(stylesheet).toMatch(/\.settings-persona-pane\s*\{[\s\S]*display:\s*flex/)
    expect(stylesheet).toMatch(/\.settings-persona-card\s*\{[\s\S]*flex:\s*1/)
    expect(stylesheet).toMatch(/\.settings-soul-editor\s*\{[\s\S]*min-height:\s*340px/)
    expect(stylesheet).toMatch(/\.settings-soul-editor::-webkit-scrollbar\s*\{\s*width:\s*5px/)
    expect(stylesheet).toMatch(/\.settings-soul-editor:focus\s*\{[\s\S]*box-shadow:\s*none/)
  })

  it('renders a filled pet-size slider with visible bounds', () => {
    expect(settingsSource).toContain("'--range-progress'")
    expect(settingsSource).toContain('40px')
    expect(settingsSource).toContain('160px')
    expect(stylesheet).toMatch(/linear-gradient\(to right, var\(--accent\)/)
  })

  it('clips settings content with rounded lower corners', () => {
    expect(stylesheet).toMatch(/\.settings-panel\s*\{[\s\S]*border-radius:\s*inherit/)
    expect(stylesheet).toMatch(/\.settings-body\s*\{[\s\S]*border-radius:\s*0 0 12px 12px/)
    expect(stylesheet).toMatch(/\.settings-nav\s*\{[\s\S]*border-radius:\s*0 0 0 12px/)
  })
})
