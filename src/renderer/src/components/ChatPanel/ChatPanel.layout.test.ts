import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

const stylesheet = readFileSync(resolve(process.cwd(), 'src/renderer/src/components/ChatPanel/ChatPanel.css'), 'utf8')
const panelSource = readFileSync(resolve(process.cwd(), 'src/renderer/src/components/ChatPanel/ChatPanel.tsx'), 'utf8')
const sidebarSource = readFileSync(resolve(process.cwd(), 'src/renderer/src/components/ConversationSidebar/ConversationSidebar.tsx'), 'utf8')
const sidebarStylesheet = readFileSync(resolve(process.cwd(), 'src/renderer/src/components/ConversationSidebar/ConversationSidebar.css'), 'utf8')

describe('chat layout guardrails', () => {
  it('keeps the composer on one row and never enables horizontal scrolling', () => {
    expect(stylesheet).toMatch(/\.input-toolbar\s*\{[\s\S]*flex-wrap:\s*nowrap/)
    expect(stylesheet).not.toMatch(/overflow-x\s*:\s*(auto|scroll)/)
  })

  it('keeps upward menus visible while message content remains clipped safely', () => {
    expect(stylesheet).toMatch(/\.chat-panel-main\s*\{[\s\S]*overflow:\s*visible/)
    expect(stylesheet).toMatch(/\.message-bubble\s*\{[\s\S]*overflow-x:\s*hidden/)
  })

  it('keeps short session workspaces compact and anchors the composer', () => {
    expect(stylesheet).toMatch(/\.chat-panel-workspace\s*\{[\s\S]*height:\s*auto/)
    expect(stylesheet).toMatch(/\.chat-panel-main > \.input-area\s*\{\s*margin-top:\s*auto/)
    expect(stylesheet).toMatch(/\.workspace-resize-handle\s*\{[\s\S]*cursor:\s*ns-resize/)
    expect(panelSource).toContain('const rect = panelEl.getBoundingClientRect()')
    expect(panelSource).toContain('aria-label="调整会话工作区高度"')
  })

  it('uses the top-bar session toggle as the only close control', () => {
    expect(panelSource).not.toContain('onClose={() => setShowSessions(false)}')
    expect(sidebarSource).not.toContain('aria-label="关闭对话列表"')
  })

  it('aligns session actions with the card footer instead of the title corner', () => {
    expect(sidebarStylesheet).toMatch(/\.conversation-item-actions\s*\{[\s\S]*right:\s*9px[\s\S]*bottom:\s*6px/)
    expect(sidebarStylesheet).toMatch(/\.conversation-item-main\s*\{[\s\S]*padding:\s*8px 9px 30px/)
  })
})
