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
    expect(memorySource).toContain('memory-engine-connection-card')
    expect(memorySource).toContain('engineTest()')
    expect(memorySource).toContain('remote && syncDraft.memorySyncBaseUrl.trim()')
  })

  it('splits memory management into focused workspace views', () => {
    expect(memorySource).toContain("type MemoryWorkspaceView = 'overview' | 'review' | 'library' | 'organize' | 'connections'")
    expect(memorySource).toContain('className="memory-workspace-nav"')
    expect(memorySource).toContain('<span>待处理</span>')
    expect(memorySource).toContain('<span>记忆库</span>')
    expect(memorySource).toContain('<span>整理</span>')
    expect(memorySource).toContain('<span>连接</span>')
    expect(memorySource).toContain("event.key === 'ArrowRight'")
    expect(memorySource).toContain('workspaceNavRef')
    expect(memorySource).toContain('正在加载记忆工作区')
    expect(memorySource).toContain('setLoading(true); void refresh()')
    expect(memoryStylesheet).toContain('.memory-workspace-nav')
    expect(memoryStylesheet).toContain('.memory-toolbar input:focus-visible')
    expect(memoryStylesheet).toContain('.memory-library-view.is-review')
    expect(memoryStylesheet).toContain('@media (max-width: 640px)')
    expect(memorySource).toContain('待处理记忆')
    expect(memorySource).toContain('处理完成后会自动移出')
    expect(memorySource).toContain('来源与依据')
    expect(memorySource).toContain('远程边界')
    expect(memoryStylesheet).toContain('.memory-source-details')
    expect(memorySource).toContain('Mem0 正在管理记忆')
    expect(memorySource).toContain('!isRemoteEngine &&')
    expect(memorySource).toContain("memoryWriteMode: 'auto'")
    expect(memorySource).toContain('memory-remote-toggle')
    expect(memorySource).toContain("type MemoryReviewScope = 'pending' | 'all'")
    expect(memorySource).toContain('仅待确认与冲突')
    expect(memorySource).toContain('全部记忆')
    expect(memorySource).toContain('memory-review-scope')
  })

  it('surfaces a dedicated identity profile backed by person memories', () => {
    expect(memorySource).toContain('memory.identity()')
    expect(memorySource).toContain('memory-identity-card')
    expect(memorySource).toContain("querySelector('.memory-library')")
    expect(memorySource).toContain('void refresh()')
    expect(memorySource).toContain('编辑身份档案')
    expect(memorySource).toContain('saveIdentity')
    expect(memoryStylesheet).toContain('.memory-identity-card')
  })

  it('keeps the persona editor large with a thin, neutral scrollbar', () => {
    expect(stylesheet).toMatch(/\.settings-persona-pane\s*\{[\s\S]*display:\s*flex/)
    expect(stylesheet).toMatch(/\.settings-persona-card\s*\{[\s\S]*flex:\s*1/)
    expect(stylesheet).toMatch(/\.settings-soul-editor\s*\{[\s\S]*min-height:\s*340px/)
    expect(stylesheet).toMatch(/\.settings-soul-editor::-webkit-scrollbar\s*\{\s*width:\s*5px/)
    expect(stylesheet).toMatch(/\.settings-soul-editor:focus\s*\{[\s\S]*box-shadow:\s*none/)
  })

  it('provides local SOUL.md version history and line diffs', () => {
    expect(settingsSource).toContain("SOUL_HISTORY_STATE_KEY = 'soul-history'")
    expect(settingsSource).toContain('saveSoulVersion')
    expect(settingsSource).toContain('buildSoulDiff')
    expect(settingsSource).toContain('settings-soul-diff')
    expect(settingsSource).toContain('SOUL.md 版本历史')
    expect(settingsSource).not.toContain('隐藏版本历史')
    expect(stylesheet).toContain('.settings-soul-history-panel')
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
